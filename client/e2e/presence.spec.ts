// client/e2e/presence.spec.ts — M4: online/offline đa tab, lastSeen, typing trong phòng và preview danh sách
// (ui_ux_spec.md §3.2, §3.3, §4.2; FR-PRES-001..003, FR-CHAT-005).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { vi as t } from '../src/i18n/vi';
import { clearRateLimits, loginAs, newUser, registerViaApi, waitForSocketConnected, type E2eUser } from './fixtures';

const contexts: BrowserContext[] = [];

test.beforeEach(async () => {
  await clearRateLimits();
});
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

async function newContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  return ctx;
}

async function openPage(ctx: BrowserContext, user: E2eUser, path = '/chats'): Promise<Page> {
  const page = await ctx.newPage();
  const connected = waitForSocketConnected(page);
  await loginAs(page, user, path);
  await connected;
  return page;
}

async function openDirect(page: Page, peer: E2eUser): Promise<string> {
  await page.getByLabel(t.conversations.search).fill(peer.username);
  await page
    .getByRole('region', { name: t.conversations.sectionUsers })
    .getByRole('button', { name: new RegExp(peer.displayName) })
    .click();
  await expect(page).toHaveURL(/\/chats\/[a-f0-9]{24}$/);
  return page.url().split('/').at(-1) ?? '';
}

const composer = (page: Page) => page.getByRole('textbox', { name: t.chat.composerLabel });
const headerOnline = (page: Page) => page.getByRole('main').getByRole('img', { name: t.presence.online });

test('TC-AC-027 alice mở 2 tab, đóng tab 1 → bob vẫn thấy "Đang hoạt động"; đóng nốt → OFFLINE + "Vừa mới truy cập"', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const [alice, bob] = [newUser(), newUser()];
  for (const u of [alice, bob]) await registerViaApi(request, u);
  const aliceCtx = await newContext(browser);
  const tab1 = await openPage(aliceCtx, alice);
  const id = await openDirect(tab1, bob);
  const tab2 = await openPage(aliceCtx, alice, `/chats/${id}`);
  const b = await openPage(await newContext(browser), bob, `/chats/${id}`);

  await expect(headerOnline(b)).toBeVisible();
  await expect(b.getByRole('main').locator('header')).toContainText(t.presence.online);

  await tab1.close();
  await b.waitForTimeout(12_000); // quá PRESENCE_OFFLINE_GRACE_MS (10 s)
  await expect(headerOnline(b)).toBeVisible();

  await tab2.close();
  await expect(headerOnline(b)).toBeHidden({ timeout: 20_000 });
  await expect(b.getByRole('main').locator('header')).toContainText(t.presence.justNow);
});

test('TC-AC-026 alice gõ liên tục → bob thấy "đang soạn tin…" trong phòng và preview danh sách; dừng → ẩn ≤ 5 s; gửi → ẩn ngay', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const [alice, bob] = [newUser(), newUser()];
  for (const u of [alice, bob]) await registerViaApi(request, u);
  const a = await openPage(await newContext(browser), alice);
  const id = await openDirect(a, bob);
  await composer(a).fill('chào');
  await composer(a).press('Enter');

  const b = await openPage(await newContext(browser), bob, `/chats/${id}`);
  const roomTyping = b.getByRole('main').getByText(t.typing.direct, { exact: true });
  const listTyping = b.getByTestId('typing-preview');

  // gõ liên tục 10 s (mỗi 500 ms một ký tự)
  for (let i = 0; i < 20; i += 1) {
    await composer(a).pressSequentially('a');
    if (i === 2) {
      await expect(roomTyping).toBeVisible();
      await expect(listTyping).toHaveText(t.typing.direct);
    }
    await a.waitForTimeout(500);
  }
  await expect(roomTyping).toBeVisible();
  // dừng gõ: chỉ báo ẩn ≤ 5 s sau typing:start cuối
  await expect(roomTyping).toBeHidden({ timeout: 6_000 });

  await composer(a).pressSequentially('b');
  await expect(roomTyping).toBeVisible();
  await composer(a).press('Enter');
  await expect(roomTyping).toBeHidden({ timeout: 1_500 });

  const { violations } = await new AxeBuilder({ page: b }).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('Quyền riêng tư: tắt "Hiển thị lần truy cập gần nhất" → "Đã lưu thay đổi"; tải lại vẫn tắt', async ({
  page,
  request,
}) => {
  const u = newUser();
  await registerViaApi(request, u);
  await loginAs(page, u, '/settings/privacy');
  const sw = page.getByRole('switch', { name: new RegExp(t.settings.privacy.showLastSeen) });
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(page.getByText(t.settings.saved)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('switch', { name: new RegExp(t.settings.privacy.showLastSeen) })).not.toBeChecked();
});
