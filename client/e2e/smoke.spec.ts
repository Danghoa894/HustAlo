// client/e2e/smoke.spec.ts — TC-ARCH-017 (development_guide.md §9.7): smoke chạy được trên môi trường đã deploy
// (E2E_BASE_URL=https://<domain>): không dùng dockerCompose/clearRateLimits, không seed ngoài 2 tài khoản smoke.
// Có E2E_BASE_URL → dùng tài khoản SMOKE_A_* / SMOKE_B_* (GitHub Secrets); local → đăng ký 2 user mới.
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

async function smokeUsers(request: APIRequestContext): Promise<[E2eUser, E2eUser]> {
  if (deployed) return [fromEnv('SMOKE_A'), fromEnv('SMOKE_B')];
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
