// client/e2e/group.spec.ts — M2: danh sách chat, DIRECT qua tìm kiếm, tạo/đổi tên/quản lý nhóm, rời nhóm, RoomNotFound
// (ui_ux_spec.md §2, §3.2–§3.4; FR-CHAT-001, FR-CHAT-009, FR-GROUP-001..006, FR-SEC-008).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { vi as t } from '../src/i18n/vi';
import { clearRateLimits, loginAs, newUser, registerViaApi, waitForSocketConnected, type E2eUser } from './fixtures';

const contexts: BrowserContext[] = [];

test.beforeEach(async () => {
  await clearRateLimits();
});
// Đóng mọi context mở thêm: để lại sẽ dồn tài nguyên và làm các test sau chậm dần (thấy rõ trên WebKit).
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

/** Mở context mới đã đăng nhập ở /chats và chờ socket kết nối (để nhận event realtime). */
async function openAs(browser: Browser, user: E2eUser): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  const connected = waitForSocketConnected(page);
  await loginAs(page, user, '/chats');
  await connected;
  return page;
}

async function createGroupVia(page: Page, title: string, members: E2eUser[]) {
  await page.getByRole('button', { name: t.conversations.newChat }).click();
  await page
    .getByRole('dialog', { name: t.conversations.newChat })
    .getByRole('button', { name: t.conversations.createGroup })
    .click();
  const dialog = page.getByRole('dialog', { name: t.groups.create });
  await dialog.getByLabel(t.groups.title, { exact: true }).fill(title);
  for (const m of members) {
    await dialog.getByPlaceholder(t.groups.searchUsers).fill(m.username);
    await dialog.getByRole('checkbox', { name: new RegExp(`@${m.username}`) }).check();
  }
  await expect(dialog.getByText(t.groups.selected(members.length, 99))).toBeVisible();
  await dialog.getByRole('button', { name: t.groups.create }).click();
  await expect(page).toHaveURL(/\/chats\/[a-f0-9]{24}$/);
}

const roomMenu = (page: Page) => page.getByRole('button', { name: t.chat.roomOptions });

test('TC-AC-050 tạo nhóm qua UI → header + preview SYSTEM; thành viên khác thấy nhóm realtime', async ({
  browser,
  request,
}) => {
  const [alice, bob, carol] = [newUser(), newUser(), newUser()];
  for (const u of [alice, bob, carol]) await registerViaApi(request, u);
  const a = await openAs(browser, alice);
  const b = await openAs(browser, bob);

  await createGroupVia(a, 'Dự án E2E', [bob, carol]);
  await expect(a.getByRole('heading', { name: 'Dự án E2E' })).toBeVisible();
  await expect(a.getByText(t.chat.memberCount(3))).toBeVisible();
  await expect(a.getByRole('link', { name: /^Dự án E2E, Bạn đã thêm / })).toBeVisible();

  // bob nhận conversation:updated CREATED → danh sách có nhóm với preview "{alice} đã thêm Bạn, {carol}"
  await expect(
    b.getByRole('link', { name: `Dự án E2E, ${alice.displayName} đã thêm Bạn, ${carol.displayName}` }),
  ).toBeVisible();

  const { violations } = await new AxeBuilder({ page: a }).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('TC-AC-056 đổi tên nhóm → header đổi; thành viên khác thấy tên mới realtime', async ({ browser, request }) => {
  const [alice, bob] = [newUser(), newUser()];
  for (const u of [alice, bob]) await registerViaApi(request, u);
  const a = await openAs(browser, alice);
  const b = await openAs(browser, bob);
  await createGroupVia(a, 'Tên cũ', [bob]);

  await roomMenu(a).click();
  await a.getByRole('menuitem', { name: t.groups.rename }).click();
  const dialog = a.getByRole('dialog', { name: t.groups.rename });
  await dialog.getByLabel(t.groups.title, { exact: true }).fill('Tên mới');
  await dialog.getByRole('button', { name: t.common.save }).click();
  await expect(a.getByRole('heading', { name: 'Tên mới' })).toBeVisible();
  await expect(
    b.getByRole('link', { name: `Tên mới, ${alice.displayName} đã đổi tên nhóm thành “Tên mới”` }),
  ).toBeVisible();
});

test('TC-AC-055 quản lý thành viên: đặt quản trị viên, xóa thành viên đang mở phòng → modal "Bạn đã bị xóa khỏi nhóm"', async ({
  browser,
  request,
}) => {
  const [alice, bob, carol] = [newUser(), newUser(), newUser()];
  for (const u of [alice, bob, carol]) await registerViaApi(request, u);
  const a = await openAs(browser, alice);
  const b = await openAs(browser, bob);
  await createGroupVia(a, 'Nhóm QL', [bob, carol]);
  const roomUrl = a.url();

  await b.goto(new URL(roomUrl).pathname);
  await expect(b.getByRole('heading', { name: 'Nhóm QL' })).toBeVisible();

  await roomMenu(a).click();
  await a.getByRole('menuitem', { name: t.groups.manageMembers }).click();
  const manager = a.getByRole('dialog', { name: t.groups.members(3) });
  await manager.getByRole('button', { name: t.groups.memberActions(carol.displayName) }).click();
  await a.getByRole('menuitem', { name: t.groups.makeAdmin }).click();
  await expect(manager.getByRole('listitem').filter({ hasText: carol.displayName })).toContainText(
    t.groups.roles.ADMIN,
  );

  await manager.getByRole('button', { name: t.groups.memberActions(bob.displayName) }).click();
  await a.getByRole('menuitem', { name: t.groups.removeMember }).click();
  await a
    .getByRole('dialog', { name: t.groups.confirmRemove(bob.displayName) })
    .getByRole('button', { name: t.groups.remove })
    .click();

  const removed = b.getByRole('dialog', { name: t.chat.removedFromGroup('Nhóm QL') });
  await expect(removed).toBeVisible();
  await removed.getByRole('button', { name: t.common.close }).click();
  await expect(b).toHaveURL(/\/chats$/);
  await expect(b.getByRole('link', { name: /^Nhóm QL,/ })).toHaveCount(0);
});

test('TC-AC-054 OWNER rời nhóm → phải chọn trưởng nhóm mới; người mới thấy mình là Trưởng nhóm', async ({
  browser,
  request,
}) => {
  const [alice, bob] = [newUser(), newUser()];
  for (const u of [alice, bob]) await registerViaApi(request, u);
  const a = await openAs(browser, alice);
  const b = await openAs(browser, bob);
  await createGroupVia(a, 'Nhóm rời', [bob]);

  await roomMenu(a).click();
  await a.getByRole('menuitem', { name: t.groups.leave }).click();
  const transfer = a.getByRole('dialog', { name: t.groups.ownerMustTransfer });
  await transfer.getByRole('radio', { name: new RegExp(bob.displayName) }).check();
  await transfer.getByRole('button', { name: t.groups.transfer }).click();
  await expect(a).toHaveURL(/\/chats$/);
  await expect(a.getByRole('link', { name: /^Nhóm rời,/ })).toHaveCount(0);

  await b.getByRole('link', { name: /^Nhóm rời,/ }).click();
  await roomMenu(b).click();
  await b.getByRole('menuitem', { name: t.groups.manageMembers }).click();
  await expect(
    b
      .getByRole('dialog', { name: t.groups.members(1) })
      .getByRole('listitem')
      .filter({ hasText: bob.displayName }),
  ).toContainText(t.groups.roles.OWNER);
});

test('TC-AC-017 tìm người dùng → mở DIRECT; tìm lại cùng người → cùng phòng', async ({ browser, request }) => {
  const [alice, bob] = [newUser(), newUser()];
  for (const u of [alice, bob]) await registerViaApi(request, u);
  const a = await openAs(browser, alice);

  const search = a.getByLabel(t.conversations.search);
  await search.fill(bob.username);
  await a
    .getByRole('region', { name: t.conversations.sectionUsers })
    .getByRole('button', { name: new RegExp(bob.displayName) })
    .click();
  await expect(a).toHaveURL(/\/chats\/[a-f0-9]{24}$/);
  const first = a.url();
  await expect(a.getByRole('heading', { name: bob.displayName })).toBeVisible();

  await a.goto('/chats');
  await a.getByLabel(t.conversations.search).fill(bob.username);
  await a
    .getByRole('region', { name: t.conversations.sectionUsers })
    .getByRole('button', { name: new RegExp(bob.displayName) })
    .click();
  await expect(a).toHaveURL(first);
});

test('TC-SEC-001 /chats/<id sai> và id không tồn tại → "Không tìm thấy cuộc trò chuyện"', async ({ page, request }) => {
  const u = newUser();
  await registerViaApi(request, u);
  await loginAs(page, u, '/chats/abc');
  await expect(page.getByRole('heading', { name: t.chat.roomNotFound })).toBeVisible();
  await page.goto('/chats/6720a1b2c3d4e5f601234598');
  await expect(page.getByRole('heading', { name: t.chat.roomNotFound })).toBeVisible();
});
