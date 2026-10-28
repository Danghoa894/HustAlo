// client/e2e/auth.spec.ts — M1: đăng ký, đăng nhập, refresh khi reload, hồ sơ, đổi mật khẩu, đăng xuất
// (ui_ux_spec.md §2, §3.1, §3.8, §3.9; FR-AUTH-001..005, FR-USER-002). Chạy trên http://localhost:5173 (DG-01).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { vi as t } from '../src/i18n/vi';
import { clearRateLimits, loginAs, newUser, registerViaApi, waitForSocketConnected } from './fixtures';

const s = t.settings.security;

test.beforeEach(async () => {
  await clearRateLimits();
});

async function expectNoSeriousA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test('TC-AUTH-001 đăng ký qua UI → /chats; đăng ký lại cùng email → "Email này đã được sử dụng"', async ({
  page,
  browser,
}) => {
  const user = newUser();
  await page.goto('/register');
  await page.getByLabel(t.auth.email, { exact: true }).fill(user.email);
  await page.getByLabel(t.auth.username, { exact: true }).fill(user.username.toUpperCase());
  await expect(page.getByLabel(t.auth.username, { exact: true })).toHaveValue(user.username);
  await page.getByLabel(t.auth.displayName, { exact: true }).fill(user.displayName);
  await page.getByLabel(t.auth.password, { exact: true }).fill(user.password);
  await page.getByLabel(t.auth.confirmPassword, { exact: true }).fill(user.password);
  await page.getByRole('button', { name: t.auth.submitRegister }).click();
  await expect(page).toHaveURL(/\/chats$/);
  await expect(page.getByText(t.chat.emptyRoom)).toBeVisible();

  const other = await browser.newContext();
  try {
    const p2 = await other.newPage();
    await p2.goto('/register');
    await p2.getByLabel(t.auth.email, { exact: true }).fill(user.email);
    await p2.getByLabel(t.auth.username, { exact: true }).fill(`${user.username}x`);
    await p2.getByLabel(t.auth.displayName, { exact: true }).fill(user.displayName);
    await p2.getByLabel(t.auth.password, { exact: true }).fill(user.password);
    await p2.getByLabel(t.auth.confirmPassword, { exact: true }).fill(user.password);
    await p2.getByRole('button', { name: t.auth.submitRegister }).click();
    await expect(p2.getByText(t.auth.emailTaken)).toBeVisible();
    await expect(p2.getByLabel(t.auth.email, { exact: true })).toBeFocused();
  } finally {
    await other.close();
  }
});

test('TC-AC-003 đăng nhập sai → "Email hoặc mật khẩu không đúng"; đúng → quay lại trang ?next=', async ({
  page,
  request,
}) => {
  const user = newUser();
  await registerViaApi(request, user);

  await page.goto('/settings/security');
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fsecurity$/);

  await page.getByLabel(t.auth.email, { exact: true }).fill(user.email);
  await page.getByLabel(t.auth.password, { exact: true }).fill(`${user.password}x`);
  await page.getByRole('button', { name: t.auth.submitLogin }).click();
  await expect(page.getByRole('alert')).toHaveText(t.auth.invalidCredentials);

  await page.getByLabel(t.auth.password, { exact: true }).fill(user.password);
  await page.getByRole('button', { name: t.auth.submitLogin }).click();
  await expect(page).toHaveURL(/\/settings\/security$/);
  await expect(page.getByRole('heading', { name: s.changePassword })).toBeVisible();
});

test('TC-AC-007 hai tab cùng reload đồng thời → cả hai vẫn đăng nhập, family không bị thu hồi', async ({
  page,
  request,
}) => {
  const user = newUser();
  await registerViaApi(request, user);
  await loginAs(page, user, '/settings/profile');
  await expect(page.getByLabel(t.settings.profile.username, { exact: true })).toHaveValue(user.username);

  const tab2 = await page.context().newPage();
  await tab2.goto('/settings/profile');
  await expect(tab2.getByLabel(t.settings.profile.username, { exact: true })).toHaveValue(user.username);

  await Promise.all([page.reload(), tab2.reload()]);
  for (const p of [page, tab2]) {
    await expect(p).toHaveURL(/\/settings\/profile$/);
    await expect(p.getByLabel(t.settings.profile.username, { exact: true })).toHaveValue(user.username);
  }
  // Family còn hiệu lực: reload thêm lần nữa vẫn đăng nhập.
  await page.reload();
  await expect(page.getByLabel(t.settings.profile.username, { exact: true })).toHaveValue(user.username);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('TC-AC-013 sửa tên hiển thị → "Đã lưu thay đổi", reload vẫn giữ tên mới', async ({ page, request }) => {
  const user = newUser();
  await registerViaApi(request, user);
  await loginAs(page, user, '/settings/profile');

  const name = page.getByLabel(t.settings.profile.displayName, { exact: true });
  await expect(name).toHaveValue(user.displayName);
  await name.fill('a'.repeat(81));
  await page.getByRole('button', { name: t.common.save }).click();
  await expect(page.getByText('Tên hiển thị tối đa 80 ký tự')).toBeVisible();

  await name.fill('Tên Mới E2E');
  await page.getByRole('button', { name: t.common.save }).click();
  await expect(page.getByText(t.settings.saved)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(t.settings.profile.displayName, { exact: true })).toHaveValue('Tên Mới E2E');
});

test('TC-AUTH-008 đổi mật khẩu với mật khẩu hiện tại sai → lỗi inline, vẫn đăng nhập', async ({ page, request }) => {
  const user = newUser();
  await registerViaApi(request, user);
  await loginAs(page, user, '/settings/security');

  await page.getByLabel(s.currentPassword, { exact: true }).fill('WrongOld123');
  await page.getByLabel(s.newPassword, { exact: true }).fill('BrandNew123');
  await page.getByLabel(s.confirmNewPassword, { exact: true }).fill('BrandNew123');
  await page.getByRole('button', { name: s.changePassword }).click();
  await expect(page.getByText(s.wrongCurrentPassword)).toBeVisible();
  await expect(page.getByLabel(s.currentPassword, { exact: true })).toBeFocused();

  await page.reload();
  await expect(page).toHaveURL(/\/settings\/security$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('TC-AUTH-006 đổi mật khẩu → thiết bị khác thấy SessionModal, thiết bị hiện tại thấy toast và vẫn dùng được', async ({
  browser,
  request,
}) => {
  const user = newUser();
  await registerViaApi(request, user);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await loginAs(a, user, '/settings/security');
    const bConnected = waitForSocketConnected(b);
    await loginAs(b, user, '/chats');
    await bConnected;

    const next = `${user.password}N`;
    await a.getByLabel(s.currentPassword, { exact: true }).fill(user.password);
    await a.getByLabel(s.newPassword, { exact: true }).fill(next);
    await a.getByLabel(s.confirmNewPassword, { exact: true }).fill(next);
    await a.getByRole('button', { name: s.changePassword }).click();
    await expect(a.getByText(s.changed)).toBeVisible();
    await expect(a.getByText(s.othersLoggedOut)).toBeVisible();

    const modal = b.getByRole('dialog');
    await expect(modal).toContainText(t.session.PASSWORD_CHANGED);
    await b.keyboard.press('Escape');
    await expect(modal).toBeVisible();
    await b.getByRole('button', { name: t.session.relogin }).click();
    await expect(b).toHaveURL(/\/login$/);

    await a.reload();
    await expect(a).toHaveURL(/\/settings\/security$/);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('FR-AUTH-004 đăng xuất → /login; reload không khôi phục phiên', async ({ page, request }) => {
  const user = newUser();
  await registerViaApi(request, user);
  await loginAs(page, user, '/settings/profile');
  await page.getByRole('button', { name: t.settings.logout }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/chats');
  await expect(page).toHaveURL(/\/login\?next=%2Fchats$/);
});

test('accessibility: Đăng nhập, Đăng ký, Cài đặt không có vi phạm serious/critical (NFR-11)', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: t.auth.loginTitle })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: t.auth.registerTitle })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const user = newUser();
  await registerViaApi(request, user);
  await loginAs(page, user, '/settings/profile');
  await expect(page.getByLabel(t.settings.profile.username, { exact: true })).toHaveValue(user.username);
  await expectNoSeriousA11yViolations(page);
  await page.goto('/settings/security');
  await expectNoSeriousA11yViolations(page);
});
