// client/e2e/message.spec.ts — M3: gửi/nhận realtime, receipt, sửa/thu hồi, reconnect + sync, outbox gặp USER_BLOCKED,
// read receipt khi tab ẩn, "Tin mới ↓", nội dung XSS/RTL (ui_ux_spec.md §3.3, §4.2; FR-CHAT-002..011, FR-SEC-006).
// Mất kết nối giả lập bằng cách đóng WebSocket Socket.IO và chặn mọi request /socket.io/ (navigator.onLine vẫn true →
// banner "Đang kết nối lại…", đúng AC-028), không dùng setOffline.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';
import { vi as t } from '../src/i18n/vi';
import { clearRateLimits, loginAs, newUser, registerViaApi, type E2eUser } from './fixtures';

const contexts: BrowserContext[] = [];

test.beforeEach(async () => {
  await clearRateLimits();
});
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

interface Session {
  page: Page;
  /** Chờ handshake Socket.IO kế tiếp (gói CONNECT "40…"). */
  nextConnect: () => Promise<void>;
  down: () => Promise<void>;
  up: () => Promise<void>;
}

const SOCKET_URL = /\/socket\.io\//;

async function openAs(browser: Browser, user: E2eUser): Promise<Session> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  let offline = false;
  const live = new Set<WebSocketRoute>();
  let waiters: (() => void)[] = [];
  await page.routeWebSocket(SOCKET_URL, (ws) => {
    if (offline) {
      void ws.close();
      return;
    }
    const server = ws.connectToServer();
    live.add(ws);
    ws.onClose(() => {
      live.delete(ws);
      void server.close();
    });
    server.onClose(() => {
      void ws.close();
    });
    ws.onMessage((m) => {
      server.send(m);
    });
    server.onMessage((m) => {
      ws.send(m);
      if (typeof m === 'string' && m.startsWith('40')) {
        const ready = waiters;
        waiters = [];
        for (const w of ready) w();
      }
    });
  });
  const nextConnect = () =>
    new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  const blockPolling = (route: { abort: () => Promise<void> }) => route.abort();
  const session: Session = {
    page,
    nextConnect,
    down: async () => {
      offline = true;
      await page.route(SOCKET_URL, blockPolling);
      await Promise.all([...live].map((ws) => ws.close()));
    },
    up: async () => {
      offline = false;
      await page.unroute(SOCKET_URL, blockPolling);
    },
  };
  const connected = nextConnect();
  await loginAs(page, user, '/chats');
  await connected;
  return session;
}

/** Mở DIRECT với `peer` qua ô tìm kiếm (FR-CHAT-001); trả id hội thoại. */
async function openDirect(page: Page, peer: E2eUser): Promise<string> {
  await page.getByLabel(t.conversations.search).fill(peer.username);
  await page
    .getByRole('region', { name: t.conversations.sectionUsers })
    .getByRole('button', { name: new RegExp(peer.displayName) })
    .click();
  await expect(page).toHaveURL(/\/chats\/[a-f0-9]{24}$/);
  await expect(page.getByRole('heading', { name: peer.displayName })).toBeVisible();
  return page.url().split('/').at(-1) ?? '';
}

const composer = (page: Page) => page.getByRole('textbox', { name: t.chat.composerLabel });
const log = (page: Page) => page.getByRole('log', { name: t.chat.messagesLog });

async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press('Enter');
}

/** Ghi đè visibilityState/hasFocus rồi phát visibilitychange (giả lập chuyển tab, AC-042). */
async function setTabVisible(page: Page, visible: boolean): Promise<void> {
  await page.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (v ? 'visible' : 'hidden') });
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => v });
    document.dispatchEvent(new Event('visibilitychange'));
    if (v) window.dispatchEvent(new Event('focus'));
  }, visible);
}

test('gửi/nhận realtime: badge chưa đọc, ✓ → ✓✓ xanh "Đã xem", sửa → "Đã chỉnh sửa", thu hồi → placeholder', async ({
  browser,
  request,
}) => {
  const [alice, bob] = [newUser(), newUser()];
  for (const u of [alice, bob]) await registerViaApi(request, u);
  const a = await openAs(browser, alice);
  const b = await openAs(browser, bob);
  const id = await openDirect(a.page, bob);

  await send(a.page, 'Chào Bob');
  await expect(log(a.page).getByText('Chào Bob')).toBeVisible();
  await expect(composer(a.page)).toHaveValue('');

  // bob chưa mở phòng: dòng danh sách có số chưa đọc
  await expect(
    b.page.getByRole('link', { name: new RegExp(`^${alice.displayName}, ${t.conversations.unread(1)}`) }),
  ).toBeVisible();
  await expect(a.page.getByRole('img', { name: t.chat.status.DELIVERED })).toBeVisible();

  await b.page.goto(`/chats/${id}`);
  await expect(log(b.page).getByText('Chào Bob')).toBeVisible();
  await expect(a.page.getByRole('img', { name: t.chat.status.READ })).toBeVisible();

  // sửa bằng ↑ khi ô trống (tin cuối của mình trong 15 phút)
  await composer(a.page).press('ArrowUp');
  await expect(a.page.getByText(t.chat.editing)).toBeVisible();
  await composer(a.page).fill('Chào Bob nhé');
  await composer(a.page).press('Enter');
  await expect(log(b.page).getByText('Chào Bob nhé')).toBeVisible();
  await expect(log(b.page).getByText(t.chat.edited)).toBeVisible();

  // thu hồi qua menu tin nhắn
  const bubble = log(a.page).getByRole('article').filter({ hasText: 'Chào Bob nhé' });
  await bubble.hover();
  await bubble.getByRole('button', { name: t.chat.messageActions }).click();
  await a.page.getByRole('menuitem', { name: t.chat.recall }).click();
  await a.page.getByRole('dialog', { name: t.chat.confirmRecall }).getByRole('button', { name: t.chat.recall }).click();
  await expect(log(b.page).getByText(t.chat.revoked)).toBeVisible();
  await expect(log(a.page).getByText(t.chat.revoked)).toBeVisible();

  const { violations } = await new AxeBuilder({ page: a.page }).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('TC-AC-028 mất kết nối 30 s, bob gửi 5 tin → banner "Đang kết nối lại…"; reconnect: 5 tin đúng thứ tự, không trùng; bob thấy ✓✓', async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const [alice, bob] = [newUser(), newUser()];
  for (const u of [alice, bob]) await registerViaApi(request, u);
  const a = await openAs(browser, alice);
  const b = await openAs(browser, bob);
  const id = await openDirect(a.page, bob);
  await b.page.goto(`/chats/${id}`);
  await expect(composer(b.page)).toBeVisible();

  await a.down();
  await expect(a.page.getByText(t.connection.reconnecting)).toBeVisible({ timeout: 10_000 });
  const texts = ['một', 'hai', 'ba', 'bốn', 'năm'];
  for (const text of texts) {
    await send(b.page, text);
    await expect(log(b.page).getByText(text, { exact: true })).toBeVisible();
  }
  await a.page.waitForTimeout(30_000);
  const reconnected = a.nextConnect();
  await a.up();
  await reconnected;

  await expect(log(a.page).getByText('năm', { exact: true })).toBeVisible({ timeout: 20_000 });
  const shown = await log(a.page)
    .getByRole('article')
    .evaluateAll((els) => els.map((e) => e.textContent));
  expect(texts.map((x) => shown.findIndex((s) => s.includes(x)))).toEqual([0, 1, 2, 3, 4]);
  expect(shown).toHaveLength(5);
  await expect(a.page.getByText(t.connection.reconnecting)).toBeHidden();
  await expect(
    log(b.page).getByRole('img', { name: new RegExp(`${t.chat.status.DELIVERED}|${t.chat.status.READ}`) }),
  ).toBeVisible();
});

test('TC-AC-033 tin PENDING trong outbox, bob chặn alice → online lại: ACK USER_BLOCKED → FAILED (chỉ "Xóa"), composer "Không thể gửi tin nhắn tới người này"', async ({
  browser,
  request,
}) => {
  const [alice, bob] = [newUser(), newUser()];
  for (const u of [alice, bob]) await registerViaApi(request, u);
  const a = await openAs(browser, alice);
  const b = await openAs(browser, bob);
  const id = await openDirect(a.page, bob);

  await a.down();
  await send(a.page, 'tin chờ gửi');
  await expect(log(a.page).getByRole('img', { name: t.chat.status.PENDING })).toBeVisible();

  await b.page.goto(`/chats/${id}`);
  await b.page.getByRole('button', { name: t.chat.roomOptions }).click();
  await b.page.getByRole('menuitem', { name: t.chat.block }).click();
  await expect(b.page.getByText(t.chat.youBlocked)).toBeVisible();

  const reconnected = a.nextConnect();
  await a.up();
  await reconnected;
  await expect(log(a.page).getByRole('button', { name: t.chat.remove })).toBeVisible({ timeout: 20_000 });
  await expect(log(a.page).getByRole('button', { name: t.chat.retry })).toHaveCount(0);
  await expect(a.page.getByRole('status').filter({ hasText: t.chat.cannotMessage })).toBeVisible();
  await expect(composer(a.page)).toHaveCount(0);
});

test('TC-AC-042 TC-MSG-009 bob mở phòng nhưng tab ẩn → chỉ ✓✓ "Đã nhận"; bob quay lại tab (visible + focus) → ✓✓ xanh "Đã xem"', async ({
  browser,
  request,
}) => {
  const [alice, bob] = [newUser(), newUser()];
  for (const u of [alice, bob]) await registerViaApi(request, u);
  const a = await openAs(browser, alice);
  const b = await openAs(browser, bob);
  const id = await openDirect(a.page, bob);
  await b.page.goto(`/chats/${id}`);
  await expect(composer(b.page)).toBeVisible();
  await setTabVisible(b.page, false);

  await send(a.page, 'bạn có đó không');
  await expect(log(b.page).getByText('bạn có đó không')).toBeVisible();
  await expect(a.page.getByRole('img', { name: t.chat.status.DELIVERED })).toBeVisible();
  await a.page.waitForTimeout(1500);
  await expect(a.page.getByRole('img', { name: t.chat.status.READ })).toHaveCount(0);

  await setTabVisible(b.page, true);
  await expect(a.page.getByRole('img', { name: t.chat.status.READ })).toBeVisible();
});

test('TC-MSG-013 bob đang cuộn lên khi có tin mới → không tự cuộn, nút "Tin mới ↓ (1)"; bấm → cuộn cuối, nút ẩn', async ({
  browser,
  request,
}) => {
  const [alice, bob] = [newUser(), newUser()];
  for (const u of [alice, bob]) await registerViaApi(request, u);
  const a = await openAs(browser, alice);
  const b = await openAs(browser, bob);
  const id = await openDirect(a.page, bob);
  const tall = (i: number) => Array.from({ length: 12 }, (_, k) => `tin ${String(i)} dòng ${String(k)}`).join('\n');
  for (let i = 1; i <= 6; i += 1) {
    await send(a.page, tall(i));
    await expect(log(a.page).getByText(`tin ${String(i)} dòng 0`)).toBeVisible();
  }
  await b.page.goto(`/chats/${id}`);
  await expect(log(b.page).getByText('tin 6 dòng 11')).toBeVisible();
  await log(b.page).evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
  });

  await send(a.page, 'tin mới nhất');
  const button = b.page.getByRole('button', { name: t.chat.newMessagesAria(1) });
  await expect(button).toBeVisible();
  expect(await log(b.page).evaluate((el) => el.scrollTop)).toBeLessThan(50);
  await button.click();
  await expect(button).toBeHidden();
  await expect(log(b.page).getByText('tin mới nhất')).toBeInViewport();
});

test('TC-AC-106 TC-MSG-004 nội dung <img onerror> và U+202E hiển thị nguyên văn, không chạy script, bubble không đảo chiều', async ({
  browser,
  request,
}) => {
  const [alice, bob] = [newUser(), newUser()];
  for (const u of [alice, bob]) await registerViaApi(request, u);
  const a = await openAs(browser, alice);
  const b = await openAs(browser, bob);
  const id = await openDirect(a.page, bob);
  const dialogs: string[] = [];
  b.page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await b.page.goto(`/chats/${id}`);

  const xss = '<img src=x onerror=alert(1)>';
  const rtl = 'abc‮def';
  await send(a.page, xss);
  await send(a.page, rtl);
  await expect(log(b.page).getByText(xss, { exact: true })).toBeVisible();
  const rtlText = log(b.page).getByText(rtl, { exact: true });
  await expect(rtlText).toBeVisible();
  expect(await log(b.page).locator('img[src="x"]').count()).toBe(0);
  expect(await rtlText.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  expect(dialogs).toEqual([]);
});
