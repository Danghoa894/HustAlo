// client/e2e/smoke.spec.ts — TC-ARCH-017 (development_guide.md §9.7): smoke chạy được trên môi trường đã deploy
// (E2E_BASE_URL=https://<domain>): không dùng dockerCompose/clearRateLimits, không seed ngoài 2 tài khoản smoke.
// Có E2E_BASE_URL → tài khoản SMOKE_A_* / SMOKE_B_* (GitHub Secrets), tự tạo nếu chưa có (ensureSmokeUser, §9.6);
// local → đăng ký 2 user mới.
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { vi as t } from '../src/i18n/vi';
import { newUser, openParty, registerViaApi, type CallParty, type E2eUser } from './fixtures';

const deployed = !!process.env.E2E_BASE_URL;
const parties: CallParty[] = [];

test.afterEach(async () => {
  await Promise.all(parties.splice(0).map((p) => p.ctx.close()));
});

function fromEnv(prefix: 'SMOKE_A' | 'SMOKE_B'): E2eUser {
  const get = (k: string) => {
    const v = process.env[`${prefix}_${k}`];
    if (!v) throw new Error(`Thiếu biến ${prefix}_${k} cho smoke trên môi trường đã deploy`);
    return v;
  };
  return {
    email: get('EMAIL'),
    password: get('PASSWORD'),
    username: get('USERNAME'),
    displayName: get('DISPLAYNAME'),
  };
}

/** Mã lỗi trong body lỗi (`{ error: { code } }`); không in body vì phản hồi 201/200 chứa access token. */
async function errorCode(res: { json(): Promise<unknown> }): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === 'string' ? body.error.code : '';
  } catch {
    return '';
  }
}

/**
 * Môi trường đã deploy: tạo tài khoản smoke nếu chưa có — idempotent, không cần đăng ký tay (§9.6).
 * 201 = vừa tạo. 409 = đã có (lần deploy trước). 429 = vượt rate limit register 3/phút/IP (CI retry trong cùng phút).
 * Với 409/429 xác nhận bằng đăng nhập API: 401 nghĩa là email/username đã thuộc tài khoản khác hoặc mật khẩu trong
 * secret đã đổi — báo rõ thay vì để luồng UI hết timeout.
 */
async function ensureSmokeUser(request: APIRequestContext, prefix: string, u: E2eUser): Promise<E2eUser> {
  const reg = await request.post('/api/v1/auth/register', {
    data: {
      email: u.email,
      username: u.username,
      displayName: u.displayName,
      password: u.password,
      deviceId: randomUUID(),
    },
  });
  if (reg.status() === 201) return u;
  if (reg.status() !== 409 && reg.status() !== 429) {
    throw new Error(
      `${prefix}: đăng ký trả ${String(reg.status())} ${await errorCode(reg)} — kiểm tra giá trị ${prefix}_*`,
    );
  }
  const login = await request.post('/api/v1/auth/login', {
    data: { email: u.email, password: u.password, deviceId: randomUUID() },
  });
  if (login.status() !== 200) {
    const why =
      reg.status() === 409
        ? 'email/username trong ' + prefix + '_* thuộc tài khoản khác hoặc mật khẩu đã đổi'
        : 'đăng ký bị rate limit nên chưa biết tài khoản đã có chưa — chạy lại sau 1 phút, hoặc kiểm tra mật khẩu ' +
          prefix +
          '_PASSWORD';
    throw new Error(
      `${prefix}: đăng ký trả ${String(reg.status())}, đăng nhập trả ${String(login.status())} ` +
        `${await errorCode(login)} — ${why}`,
    );
  }
  return u;
}

async function smokeUsers(request: APIRequestContext): Promise<[E2eUser, E2eUser]> {
  if (deployed) {
    return [
      await ensureSmokeUser(request, 'SMOKE_A', fromEnv('SMOKE_A')),
      await ensureSmokeUser(request, 'SMOKE_B', fromEnv('SMOKE_B')),
    ];
  }
  const users: [E2eUser, E2eUser] = [newUser(), newUser()];
  for (const u of users) await registerViaApi(request, u);
  return users;
}

const composer = (page: Page) => page.getByRole('textbox', { name: t.chat.composerLabel });
const log = (page: Page) => page.getByRole('log', { name: t.chat.messagesLog });

test('TC-ARCH-017 đăng nhập 2 user, gửi/nhận tin realtime; socket qua WebSocket (wss:// khi HTTPS) @smoke', async ({
  browser,
  request,
  baseURL,
}) => {
  const [a, b] = await smokeUsers(request);
  const transports: string[] = [];
  const watch = async (page: Page) => {
    page.on('websocket', (ws) => {
      if (ws.url().includes('/socket.io/')) transports.push(ws.url());
    });
    return Promise.resolve();
  };
  const alice = await openParty(browser, a, '/chats', { before: watch });
  parties.push(alice);

  await alice.page.getByLabel(t.conversations.search).fill(b.username);
  await alice.page
    .getByRole('region', { name: t.conversations.sectionUsers })
    .getByRole('button', { name: new RegExp(b.displayName) })
    .click();
  await expect(alice.page).toHaveURL(/\/chats\/[a-f0-9]{24}$/);
  const conversationId = alice.page.url().split('/').at(-1) ?? '';
  const bob = await openParty(browser, b, `/chats/${conversationId}`, { before: watch });
  parties.push(bob);

  const text = `smoke ${Date.now().toString(36)}`;
  await composer(alice.page).fill(text);
  await composer(alice.page).press('Enter');
  await expect(log(bob.page).getByText(text, { exact: true })).toBeVisible();

  const wsScheme = (baseURL ?? '').startsWith('https://') ? 'wss://' : 'ws://';
  expect(transports.length).toBeGreaterThanOrEqual(2);
  for (const url of transports) {
    expect(url.startsWith(wsScheme)).toBe(true);
    expect(url).toContain('transport=websocket');
  }
});
