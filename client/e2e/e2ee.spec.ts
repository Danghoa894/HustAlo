// client/e2e/e2ee.spec.ts — M7 Secret Chat (PRD FR-E2EE-001..008, AC-110..122; ui_ux_spec.md §3.3, §3.8, §4.5).
// Mỗi "device" là một browser context riêng (IndexedDB và localStorage hustalo.deviceId riêng). Thư viện Signal chạy thật
// trong trình duyệt; server chỉ thấy bản mã. Bắt gói Socket.IO: "42[…]" event, "43<id>[…]" ACK.
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { vi as t } from '../src/i18n/vi';
import { clearRateLimits, newUser, registerViaApi, waitForSocketConnected, type E2eUser } from './fixtures';

const contexts: BrowserContext[] = [];

test.beforeEach(async () => {
  await clearRateLimits();
});
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

interface SentEnvelope {
  clientMessageId: string;
  recipients: { deviceId: string; type: number; body: string }[];
}

interface Device {
  user: E2eUser;
  userId: string;
  deviceId: string;
  page: Page;
  /** message:send kind E2EE trang đã gửi (envelope), theo thứ tự. */
  sent: SentEnvelope[];
  /** Mã lỗi ACK nhận được, theo thứ tự. */
  ackErrors: string[];
  /** Body PUT /e2ee/devices/{id}/keys gần nhất. */
  registered: Record<string, unknown>;
}

function record(page: Page, sent: SentEnvelope[], ackErrors: string[]) {
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/socket.io/')) return;
    ws.on('framesent', (f) => {
      if (typeof f.payload !== 'string' || !f.payload.startsWith('42')) return;
      try {
        const [name, env] = JSON.parse(f.payload.slice(2).replace(/^\d+/, '')) as [
          string,
          { payload?: { kind?: string; clientMessageId?: string; ciphertext?: SentEnvelope } },
        ];
        const p = env.payload;
        if (name === 'message:send' && p?.kind === 'E2EE' && p.ciphertext && p.clientMessageId) {
          sent.push({ clientMessageId: p.clientMessageId, recipients: p.ciphertext.recipients });
        }
      } catch {
        // không phải event JSON
      }
    });
    ws.on('framereceived', (f) => {
      if (typeof f.payload !== 'string' || !f.payload.startsWith('43')) return;
      try {
        const [res] = JSON.parse(f.payload.slice(2).replace(/^\d+/, '')) as [
          { ok?: boolean; error?: { code?: string } },
        ];
        if (res.ok === false && res.error?.code) ackErrors.push(res.error.code);
      } catch {
        // bỏ qua
      }
    });
  });
}

const isKeysPut = (url: string, method: string) =>
  method === 'PUT' && /\/api\/v1\/e2ee\/devices\/[^/]+\/keys$/.test(url);

/** Mở app cho `user` trên một device mới (context mới) và chờ đăng ký khóa xong (FR-E2EE-001). */
async function openDevice(
  browser: Browser,
  user: E2eUser,
  path = '/chats',
  opts: { register?: boolean; deviceId?: string } = {},
): Promise<Device> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  const sent: SentEnvelope[] = [];
  const ackErrors: string[] = [];
  record(page, sent, ackErrors);
  const deviceId = opts.deviceId ?? randomUUID();
  await page.addInitScript((id) => {
    localStorage.setItem('hustalo.deviceId', id);
  }, deviceId);
  const res = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password, deviceId },
  });
  expect(res.status(), await res.text()).toBe(200);
  const userId = ((await res.json()) as { user: { id: string } }).user.id;
  const device: Device = { user, userId, deviceId, page, sent, ackErrors, registered: {} };
  const keys = opts.register === false ? null : waitForKeys(device);
  const connected = waitForSocketConnected(page);
  await page.goto(path);
  await connected;
  await keys;
  return device;
}

/** Chờ lần PUT keys kế tiếp của device (mỗi lần tải trang client PUT lại để biết số prekey còn lại). */
async function waitForKeys(d: Device): Promise<void> {
  const res = await d.page.waitForResponse((r) => isKeysPut(r.url(), r.request().method()), { timeout: 30_000 });
  expect(res.status()).toBe(200);
  d.registered = (res.request().postDataJSON() as Record<string, unknown> | null) ?? {};
}

async function reload(d: Device, path?: string): Promise<void> {
  const keys = waitForKeys(d);
  const connected = waitForSocketConnected(d.page);
  if (path) await d.page.goto(path);
  else await d.page.reload();
  await connected;
  await keys;
}

async function users(request: Parameters<typeof registerViaApi>[0], n: number): Promise<E2eUser[]> {
  const out: E2eUser[] = [];
  for (let i = 0; i < n; i += 1) {
    const u = newUser();
    await registerViaApi(request, u);
    out.push(u);
  }
  return out;
}

/** NewChatDialog → tìm → "Trò chuyện bí mật" (FR-E2EE-004). Trả conversationId. */
async function startSecret(page: Page, peer: E2eUser): Promise<string> {
  await page.getByRole('button', { name: t.conversations.newChat }).first().click();
  const dialog = page.getByRole('dialog', { name: t.conversations.newChat });
  await dialog.getByLabel(t.groups.searchUsers).fill(peer.username);
  await dialog.getByRole('button', { name: t.conversations.secretChatWith(peer.displayName) }).click();
  await expect(page).toHaveURL(/\/chats\/[a-f0-9]{24}$/);
  return page.url().split('/').at(-1) ?? '';
}

async function send(page: Page, text: string): Promise<void> {
  const box = page.getByLabel(t.chat.composerLabel);
  await box.fill(text);
  await box.press('Enter');
}

const log = (page: Page) => page.getByRole('log', { name: t.chat.messagesLog });
const badge = (page: Page) => page.getByTestId('e2ee-badge');

test.describe('M7 Secret Chat (E2EE)', () => {
  test('TC-AC-110 đăng nhập lần đầu: PUT keys 100 one-time prekey, không có trường khóa riêng; IndexedDB có khóa riêng', async ({
    browser,
    request,
  }) => {
    const [alice] = await users(request, 1);
    if (!alice) throw new Error('thiếu user');
    const x = await openDevice(browser, alice);
    const body = x.registered as { oneTimePreKeys?: unknown[]; signedPreKey?: Record<string, unknown> };
    expect(body.oneTimePreKeys).toHaveLength(100);
    expect(Object.keys(x.registered).sort()).toEqual([
      'identityKey',
      'oneTimePreKeys',
      'registrationId',
      'signedPreKey',
    ]);
    expect(Object.keys(body.signedPreKey ?? {}).sort()).toEqual(['keyId', 'publicKey', 'signature']);
    expect(JSON.stringify(x.registered)).not.toMatch(/priv/i);

    const local = await x.page.evaluate(async (userId) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(`hustalo-signal-${userId}`);
        req.onsuccess = () => {
          resolve(req.result);
        };
        req.onerror = () => {
          reject(req.error ?? new Error('open'));
        };
      });
      const read = <T>(store: string, key?: IDBValidKey) =>
        new Promise<T>((resolve) => {
          const tx = db.transaction(store, 'readonly');
          const req = key === undefined ? tx.objectStore(store).count() : tx.objectStore(store).get(key);
          req.onsuccess = () => {
            resolve(req.result as T);
          };
        });
      const meta = await read<{ identityKeyPair?: { priv?: string } } | undefined>('meta', 'local');
      const preKeys = await read<number>('preKeys');
      db.close();
      return { hasPrivateIdentity: typeof meta?.identityKeyPair?.priv === 'string', preKeys };
    }, x.userId);
    expect(local).toEqual({ hasPrivateIdentity: true, preKeys: 100 });
  });

  test('TC-AC-112 TC-E2EE-001 tạo SECRET với người chưa có thiết bị → "Người nhận chưa bật trò chuyện bí mật"', async ({
    browser,
    request,
  }) => {
    const [alice, frank] = await users(request, 2);
    if (!alice || !frank) throw new Error('thiếu user');
    const x = await openDevice(browser, alice);
    await x.page.getByRole('button', { name: t.conversations.newChat }).first().click();
    const dialog = x.page.getByRole('dialog', { name: t.conversations.newChat });
    await dialog.getByLabel(t.groups.searchUsers).fill(frank.username);
    await dialog.getByRole('button', { name: t.conversations.secretChatWith(frank.displayName) }).click();
    await expect(dialog.getByText(t.e2ee.keysUnavailable)).toBeVisible();
    await expect(x.page).toHaveURL(/\/chats$/);
  });

  test('TC-AC-111 TC-AC-122 alice X → bob Y, Z: "Đang thiết lập mã hóa…" rồi "Mã hóa đầu-cuối"; 2 recipient type 3; Y, Z đọc "chào"; trả lời type 1; reload vẫn đọc được', async ({
    browser,
    request,
  }) => {
    const [alice, bob] = await users(request, 2);
    if (!alice || !bob) throw new Error('thiếu user');
    const y = await openDevice(browser, bob);
    const z = await openDevice(browser, bob);
    const x = await openDevice(browser, alice);
    const conv = await startSecret(x.page, bob);

    // AC-122: chưa gửi tin nào → không được hiển thị "Mã hóa đầu-cuối".
    await expect(badge(x.page)).toHaveText(t.e2ee.settingUp);
    await expect(x.page.getByText(t.e2ee.encrypted)).toHaveCount(0);

    await Promise.all([reload(y, `/chats/${conv}`), reload(z, `/chats/${conv}`)]);
    await send(x.page, 'chào');
    await expect(log(y.page).getByText('chào', { exact: true })).toBeVisible();
    await expect(log(z.page).getByText('chào', { exact: true })).toBeVisible();
    const first = x.sent.at(-1);
    expect(first?.recipients.map((r) => [r.deviceId, r.type]).sort()).toEqual(
      [
        [y.deviceId, 3],
        [z.deviceId, 3],
      ].sort(),
    );
    await expect(badge(x.page)).toHaveText(t.e2ee.encrypted);
    await expect(badge(y.page)).toHaveText(t.e2ee.encrypted);

    await send(y.page, 'chào alice');
    await expect(log(x.page).getByText('chào alice', { exact: true })).toBeVisible();
    await expect(log(z.page).getByText('chào alice', { exact: true })).toBeVisible(); // device khác của bob
    expect(y.sent.at(-1)?.recipients.find((r) => r.deviceId === x.deviceId)?.type).toBe(1);

    // Bản rõ cục bộ: reload không giải mã lại (Double Ratchet chỉ giải mã một lần) mà vẫn hiển thị.
    await reload(x);
    await expect(log(x.page).getByText('chào', { exact: true })).toBeVisible();
    await expect(log(x.page).getByText('chào alice', { exact: true })).toBeVisible();
    await reload(y);
    await expect(log(y.page).getByText('chào', { exact: true })).toBeVisible();
  });

  test('TC-AC-114 TC-E2EE-004 bản mã bị sửa 1 byte trên đường tới bob → "Không thể giải mã tin nhắn này"; tin khác vẫn đọc được', async ({
    browser,
    request,
  }) => {
    const [alice, bob] = await users(request, 2);
    if (!alice || !bob) throw new Error('thiếu user');
    const y = await openDevice(browser, bob);
    const x = await openDevice(browser, alice);
    const conv = await startSecret(x.page, bob);
    let tamper = false;
    // Test hook: đổi một ký tự base64 trong body recipient của message:new tới Y.
    await y.page.routeWebSocket(/\/socket\.io\//, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => {
        server.send(m);
      });
      server.onMessage((m) => {
        if (tamper && typeof m === 'string' && m.startsWith('42["message:new"')) {
          ws.send(
            // Ký tự thứ 12 từ cuối: nằm trong 8 byte MAC của WhisperMessage (các trường header của PreKey message
            // không được MAC bảo vệ nên sửa ở đầu có thể vẫn giải mã được).
            m.replace(
              /("body":"[A-Za-z0-9+/]*?)([A-Za-z0-9+/])([A-Za-z0-9+/]{11}={0,2}")/,
              (_all, a: string, c: string, b: string) => `${a}${c === 'A' ? 'B' : 'A'}${b}`,
            ),
          );
          tamper = false;
          return;
        }
        ws.send(m);
      });
    });
    await reload(y, `/chats/${conv}`);
    await send(x.page, 'một');
    await expect(log(y.page).getByText('một', { exact: true })).toBeVisible();
    tamper = true;
    await send(x.page, 'hai');
    await expect(log(y.page).getByText(t.e2ee.decryptFailed)).toBeVisible();
    await send(x.page, 'ba');
    await expect(log(y.page).getByText('ba', { exact: true })).toBeVisible();
    await expect(log(y.page).getByText('một', { exact: true })).toBeVisible();
  });

  test('TC-AC-120 TC-AC-113 TC-E2EE-003 safety number trùng hai phía; bob xóa IndexedDB → alice thấy banner, composer khóa tới khi "Chấp nhận"', async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);
    const [alice, bob] = await users(request, 2);
    if (!alice || !bob) throw new Error('thiếu user');
    const y = await openDevice(browser, bob);
    const x = await openDevice(browser, alice);
    const conv = await startSecret(x.page, bob);
    await reload(y, `/chats/${conv}`);
    await send(x.page, 'thiết lập');
    await expect(log(y.page).getByText('thiết lập', { exact: true })).toBeVisible();
    await send(y.page, 'đã nhận');
    await expect(log(x.page).getByText('đã nhận', { exact: true })).toBeVisible();

    // AC-120: hai bên cùng 60 chữ số (12 nhóm 5).
    const digits = async (d: Device) => {
      await expect(badge(d.page)).toHaveText(t.e2ee.encrypted);
      await badge(d.page).click();
      const dialog = d.page.getByRole('dialog', {
        name: t.e2ee.safetyTitle(d === x ? bob.displayName : alice.displayName),
      });
      const text = (await dialog.getByTestId('safety-number').first().innerText()).replace(/\s+/g, '');
      return { dialog, text };
    };
    const a = await digits(x);
    const b = await digits(y);
    expect(a.text).toMatch(/^\d{60}$/);
    expect(a.text).toBe(b.text);
    expect((await a.dialog.getByTestId('safety-number').first().innerText()).trim().split(/\s+/)).toHaveLength(12);
    await a.dialog.getByRole('button', { name: t.e2ee.markVerified }).click();
    await expect(a.dialog.getByText(t.e2ee.verified)).toBeVisible();
    await a.dialog.getByRole('button', { name: t.common.close }).first().click();
    await expect(badge(x.page)).toContainText(t.e2ee.verified);

    // AC-113: bob xóa IndexedDB trên Y (trang tĩnh cùng origin, app không giữ kết nối DB) rồi mở lại → identity mới.
    await y.page.goto('/fonts/OFL.txt');
    await y.page.evaluate(
      (userId) =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.deleteDatabase(`hustalo-signal-${userId}`);
          req.onsuccess = () => {
            resolve();
          };
          req.onerror = () => {
            reject(req.error ?? new Error('delete'));
          };
        }),
      y.userId,
    );
    await reload(y, `/chats/${conv}`);
    expect((y.registered as { oneTimePreKeys?: unknown[] }).oneTimePreKeys).toHaveLength(100);
    // TC-E2EE-006: tin cũ trên Y không đọc được nữa — hành vi thiết kế.
    await expect(log(y.page).getByText(t.e2ee.notForDevice).first()).toBeVisible();

    await reload(x);
    await expect(x.page.getByText(t.e2ee.identityChanged(bob.displayName)).first()).toBeVisible();
    const box = x.page.getByLabel(t.chat.composerLabel);
    await expect(box).toBeDisabled();
    await expect(box).toHaveAttribute('placeholder', t.e2ee.confirmNewSafetyNumber);
    await x.page.getByRole('button', { name: t.e2ee.accept }).click();
    await expect(box).toBeEnabled();
    await expect(badge(x.page)).not.toContainText(t.e2ee.verified); // verified bị xóa
    await send(x.page, 'sau khi chấp nhận');
    await expect(log(y.page).getByText('sau khi chấp nhận', { exact: true })).toBeVisible();
  });

  test('TC-AC-117 TC-E2EE-005 bob thu hồi Z từ Y: Z bị đăng xuất; tin kế tiếp của alice CONFLICT rồi tự gửi lại chỉ cho Y', async ({
    browser,
    request,
  }) => {
    const [alice, bob] = await users(request, 2);
    if (!alice || !bob) throw new Error('thiếu user');
    const y = await openDevice(browser, bob);
    const z = await openDevice(browser, bob);
    const x = await openDevice(browser, alice);
    const conv = await startSecret(x.page, bob);
    await reload(y, `/chats/${conv}`);
    await send(x.page, 'trước khi thu hồi');
    await expect(log(y.page).getByText('trước khi thu hồi', { exact: true })).toBeVisible();

    await y.page.goto('/settings/devices');
    const rows = y.page.getByTestId('device-row');
    await expect(rows).toHaveCount(2);
    await rows.filter({ hasNotText: t.e2ee.inUse }).getByRole('button', { name: t.e2ee.revoke }).click();
    await y.page
      .getByRole('dialog', { name: t.e2ee.confirmRevoke })
      .getByRole('button', { name: t.e2ee.revoke })
      .click();
    await expect(z.page.getByText(t.session.DEVICE_REVOKED)).toBeVisible();
    await expect(rows.filter({ hasText: t.e2ee.revokedStatus })).toHaveCount(1);

    await y.page.goto(`/chats/${conv}`);
    const before = x.sent.length;
    await send(x.page, 'sau khi thu hồi');
    await expect(log(y.page).getByText('sau khi thu hồi', { exact: true })).toBeVisible();
    expect(x.ackErrors).toContain('CONFLICT');
    const attempts = x.sent.slice(before);
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts.at(-1)?.recipients.map((r) => r.deviceId)).toEqual([y.deviceId]);
    await expect(log(x.page).getByText('sau khi thu hồi', { exact: true })).toBeVisible();
  });

  test('TC-AC-118 TC-AC-121 TC-E2EE-007 TC-E2EE-008 bob đăng nhập device W mới: 10 tin cũ là placeholder; tin mới (CONFLICT → gửi lại có W) đọc được', async ({
    browser,
    request,
  }) => {
    const [alice, bob] = await users(request, 2);
    if (!alice || !bob) throw new Error('thiếu user');
    const y = await openDevice(browser, bob);
    const x = await openDevice(browser, alice);
    const conv = await startSecret(x.page, bob);
    await reload(y, `/chats/${conv}`);
    for (let i = 1; i <= 10; i += 1) await send(x.page, `tin ${String(i)}`);
    await expect(log(y.page).getByText('tin 10', { exact: true })).toBeVisible();

    const w = await openDevice(browser, bob, `/chats/${conv}`);
    await expect(log(w.page).getByText(t.e2ee.notForDevice)).toHaveCount(10);

    const before = x.sent.length;
    await send(x.page, 'tin mới');
    await expect(log(w.page).getByText('tin mới', { exact: true })).toBeVisible();
    await expect(log(y.page).getByText('tin mới', { exact: true })).toBeVisible();
    expect(x.ackErrors).toContain('CONFLICT'); // envelope thiếu W (AC-121)
    expect(
      x.sent
        .slice(before)
        .at(-1)
        ?.recipients.map((r) => r.deviceId)
        .sort(),
    ).toEqual([y.deviceId, w.deviceId].sort());
  });
});
