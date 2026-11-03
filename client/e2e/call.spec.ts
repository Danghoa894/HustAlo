// client/e2e/call.spec.ts — M5: cuộc gọi thoại/video 1-1 qua thiết bị media giả (development_guide.md §6.6;
// FR-CALL-001, 002, 004, 009, 011; ui_ux_spec.md §3.5–§3.7, §4.4). Kiểm media bằng window.__hustaloCallStats().
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { vi as t } from '../src/i18n/vi';
import {
  clearRateLimits,
  expectMediaFlowing,
  framesDecoded,
  mockGetUserMediaError,
  statuses,
  twoUsers,
  type CallParty,
} from './fixtures';

const parties: CallParty[] = [];

test.beforeEach(async () => {
  await clearRateLimits();
});
test.afterEach(async () => {
  await Promise.all(parties.splice(0).map((p) => p.ctx.close()));
});

async function pair(...args: Parameters<typeof twoUsers>) {
  const r = await twoUsers(...args);
  parties.push(r.alice, r.bob);
  return r;
}

const incoming = (page: Page) => page.getByRole('alertdialog');
const inCall = (page: Page) => page.getByTestId('in-call');

async function startCall(caller: CallParty, callee: CallParty, type: 'VOICE' | 'VIDEO') {
  const name = callee.user.displayName;
  await caller.page
    .getByRole('button', { name: type === 'VIDEO' ? t.calls.callVideo(name) : t.calls.callVoice(name) })
    .click();
  await expect(incoming(callee.page)).toBeVisible();
}

async function answer(caller: CallParty, callee: CallParty) {
  await incoming(callee.page)
    .getByRole('button', { name: t.calls.acceptLabel(caller.user.displayName) })
    .click();
}

/** `expected` xuất hiện trong `actual` theo đúng thứ tự (có thể xen trạng thái khác / lặp). */
function inOrder(actual: string[], expected: string[]): boolean {
  let i = 0;
  for (const s of actual) if (s === expected[i]) i += 1;
  return i === expected.length;
}

async function expectConnected(...ps: CallParty[]) {
  for (const p of ps) {
    await expect.poll(() => statuses(p).includes('CONNECTED'), { timeout: 20_000 }).toBe(true);
    await expect(inCall(p.page)).toBeVisible();
  }
}

// Mọi test gắn @media: project webkit loại bằng grepInvert (playwright.config.ts, DG §6.6).
test.describe('cuộc gọi 1-1 @media', () => {
  test('TC-AC-070 gọi thoại thành công: INITIATED → RINGING → ACCEPTED → CONNECTING → CONNECTED, âm thanh 2 chiều, SYSTEM "Cuộc gọi thoại · mm:ss" @media', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const { alice, bob } = await pair(browser, request);
    await startCall(alice, bob, 'VOICE');
    await expect(alice.page.getByText(t.calls.ringing)).toBeVisible();
    await answer(alice, bob);
    await expectConnected(alice, bob);

    expect(statuses(alice)[0]).toBe('INITIATED'); // ACK call:invite
    for (const p of [alice, bob]) {
      expect(inOrder(statuses(p), ['RINGING', 'ACCEPTED', 'CONNECTING', 'CONNECTED']), statuses(p).join(',')).toBe(
        true,
      );
    }
    const connected = alice.frames.find((f) => f.source === 'state' && f.status === 'CONNECTED');
    expect(connected?.body.connectedAt).toEqual(expect.any(String));

    await expectMediaFlowing(alice.page, 'audio');
    await expectMediaFlowing(bob.page, 'audio');

    const { violations } = await new AxeBuilder({ page: bob.page }).analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

    await alice.page.getByRole('button', { name: t.calls.hangup }).click();
    await expect(alice.page.getByText(t.calls.ended.HANGUP)).toBeVisible();
    // SYSTEM CALL_ENDED chỉ được tạo khi callHistory có connectedAt (kiến trúc §8.2 (4)).
    const system = new RegExp(`${t.system.CALL_ENDED_VOICE('')}\\d{1,2}:\\d{2}`);
    for (const p of [alice, bob]) {
      await expect(p.page.getByRole('main').getByText(system)).toBeVisible({ timeout: 15_000 });
      expect(statuses(p).at(-1)).toBe('ENDED');
    }
  });

  test('TC-AC-071 gọi video: hai bên nhận video, PiP local hiển thị; tắt camera → bên kia thấy avatar ≤ 2 s @media', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const { alice, bob } = await pair(browser, request);
    await startCall(alice, bob, 'VIDEO');
    await answer(alice, bob);
    await expectConnected(alice, bob);

    for (const p of [alice, bob]) {
      await expect.poll(() => framesDecoded(p.page), { timeout: 15_000 }).toBeGreaterThan(0);
      await expect(p.page.getByTestId('pip')).toBeVisible();
      await expect(p.page.getByTestId('remote-video')).toBeVisible();
    }

    await alice.page.getByRole('button', { name: t.calls.camOff }).click();
    await expect(bob.page.getByText(t.calls.cameraPaused)).toBeVisible({ timeout: 2_000 });
    await alice.page.getByRole('button', { name: t.calls.camOn }).click();
    await expect(bob.page.getByTestId('remote-video')).toBeVisible({ timeout: 5_000 });

    await bob.page.getByRole('button', { name: t.calls.hangup }).click();
    await expect(alice.page.getByRole('main').getByText(new RegExp(t.system.CALL_ENDED_VIDEO('')))).toBeVisible({
      timeout: 15_000,
    });
  });

  test('TC-AC-071 p95 thời gian ACCEPTED → CONNECTED ≤ 5 s qua 20 lần gọi video @media', async ({
    browser,
    request,
  }) => {
    test.setTimeout(600_000);
    const { alice, bob } = await pair(browser, request);
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      await clearRateLimits(); // rl:callInvite giới hạn số lần mời / phút
      const from = alice.frames.length;
      await startCall(alice, bob, 'VIDEO');
      await answer(alice, bob);
      await expect
        .poll(() => alice.frames.slice(from).some((f) => f.source === 'state' && f.status === 'CONNECTED'), {
          timeout: 20_000,
        })
        .toBe(true);
      const mine = alice.frames.slice(from).filter((f) => f.source === 'state');
      const accepted = mine.find((f) => f.status === 'ACCEPTED');
      const connected = mine.find((f) => f.status === 'CONNECTED');
      if (!accepted || !connected) throw new Error(`thiếu ACCEPTED/CONNECTED: ${mine.map((f) => f.status).join(',')}`);
      samples.push(connected.at - accepted.at);
      await alice.page.getByRole('button', { name: t.calls.hangup }).click();
      await expect(alice.page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
      await expect(bob.page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1] ?? Infinity;
    test
      .info()
      .annotations.push({ type: 'p95 ACCEPTED→CONNECTED (ms)', description: `${p95} — mẫu: ${samples.join(', ')}` });
    expect(p95).toBeLessThanOrEqual(5_000);
  });

  test('TC-AC-075 alice hủy khi đang RINGING → CANCELLED; màn hình bob đóng, toast "Cuộc gọi nhỡ từ alice"; không có SYSTEM @media', async ({
    browser,
    request,
  }) => {
    const { alice, bob } = await pair(browser, request);
    await startCall(alice, bob, 'VOICE');
    await expect(alice.page.getByText(t.calls.ringing)).toBeVisible();
    await alice.page.getByRole('button', { name: t.calls.cancelLabel }).click();

    await expect(incoming(bob.page)).toBeHidden();
    await expect(bob.page.getByText(t.calls.missedFrom(alice.user.displayName))).toBeVisible();
    for (const p of [alice, bob]) await expect.poll(() => statuses(p).at(-1)).toBe('CANCELLED');

    await bob.page.waitForTimeout(2_000); // SYSTEM (nếu có) đến qua message:new ngay sau terminal
    for (const p of [alice, bob]) {
      const main = p.page.getByRole('main');
      await expect(main.getByText(t.system.CALL_MISSED_VOICE)).toHaveCount(0);
      await expect(main.getByText(new RegExp(t.system.CALL_ENDED_VOICE('')))).toHaveCount(0);
    }
  });

  test('TC-AC-079 alice có micro nhưng không có camera, gọi video → vẫn gọi được VIDEO; alice nhận video bob; bob thấy avatar alice @media', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const { alice, bob } = await pair(browser, request, {
      before: (page, who) =>
        who === 'alice' ? mockGetUserMediaError(page, 'NotFoundError', ['video']) : Promise.resolve(),
    });
    await startCall(alice, bob, 'VIDEO');
    await expect(alice.page.getByText(t.calls.media.CAMERA_NOT_FOUND)).toBeVisible();
    await expect(incoming(bob.page)).toContainText(t.calls.incomingVideo);
    await answer(alice, bob);
    await expectConnected(alice, bob);

    const invite = alice.frames.find((f) => f.source === 'ack' && f.status === 'INITIATED');
    expect(invite?.body.callType).toBe('VIDEO');
    await expect.poll(() => framesDecoded(alice.page), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(bob.page.getByText(t.calls.cameraPaused)).toBeVisible();
    await expect(bob.page.getByTestId('remote-video')).toHaveCount(0);
    await expect(alice.page.getByTestId('pip')).toHaveCount(0); // không có video local
  });
});

test.describe('autoplay bị chặn (FR-CALL-011, EC-CALL-MEDIA-010) @media', () => {
  // Không dựa được vào chính sách autoplay thật trong E2E: Chromium headless luôn cho phát (kể cả với
  // --autoplay-policy=user-gesture-required), Firefox cho phát khi trang đã có quyền micro/camera (pref của project),
  // và mọi lần Playwright đánh giá locator/evaluate đều được Chromium tính là "user activation". Vì vậy giả lập đúng quy
  // tắc của trình duyệt: play() có tiếng bị từ chối NotAllowedError cho tới khi có thao tác nhập thật (isTrusted).
  const emulateAutoplayPolicy = async (page: Page): Promise<void> => {
    await page.addInitScript(() => {
      let activated = false;
      for (const type of ['pointerdown', 'keydown', 'click'])
        window.addEventListener(
          type,
          (e) => {
            if (e.isTrusted) activated = true;
          },
          { capture: true },
        );
      const proto = HTMLMediaElement.prototype;
      const play = Object.getOwnPropertyDescriptor(proto, 'play')?.value as (this: HTMLMediaElement) => Promise<void>;
      proto.play = function (this: HTMLMediaElement) {
        if (!this.muted && !activated)
          return Promise.reject(new DOMException('autoplay bị chặn (giả lập)', 'NotAllowedError'));
        return play.call(this);
      };
    });
  };

  /** Ghi lại các lần play() thành công của phần tử media có src chứa `ringtone`. */
  const trackRingtone = async (page: Page): Promise<void> => {
    await page.addInitScript(() => {
      const w = window as unknown as { __ringtonePlays: number };
      w.__ringtonePlays = 0;
      const proto = HTMLMediaElement.prototype;
      const play = Object.getOwnPropertyDescriptor(proto, 'play')?.value as (this: HTMLMediaElement) => Promise<void>;
      proto.play = function (this: HTMLMediaElement) {
        const p = play.call(this);
        if (this.src.includes('ringtone')) {
          void p.then(() => {
            w.__ringtonePlays += 1;
          });
        }
        return p;
      };
    });
  };
  const ringtonePlays = (page: Page) =>
    page.evaluate(() => (window as unknown as { __ringtonePlays: number }).__ringtonePlays);

  test('TC-AC-093 bob chưa tương tác: màn hình cuộc gọi đến hiện kèm "Chạm để bật âm thanh"; trả lời được không cần bấm; bấm nút → nhạc chuông phát @media', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const { alice, bob } = await pair(browser, request, {
      before: async (page, who) => {
        if (who !== 'bob') return;
        await emulateAutoplayPolicy(page);
        await trackRingtone(page); // gắn sau → bọc ngoài bản giả lập, chỉ đếm lần phát thật sự thành công
      },
    });
    const unlock = incoming(bob.page).getByRole('button', { name: t.calls.tapToUnmute });

    // Lần 1: autoplay bị chặn → nút hiện; trả lời thẳng, không bấm nút.
    await startCall(alice, bob, 'VOICE');
    await expect(unlock).toBeVisible();
    expect(await ringtonePlays(bob.page)).toBe(0);
    await answer(alice, bob);
    await expectConnected(alice, bob);
    await alice.page.getByRole('button', { name: t.calls.hangup }).click();
    await expect(bob.page.getByTestId('in-call')).toBeHidden({ timeout: 10_000 });
    await expect(alice.page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });

    // Lần 2 (trang mới — chưa có cử chỉ người dùng): bấm nút → nhạc chuông phát, nút biến mất.
    await bob.page.reload();
    await expect(bob.page.getByRole('main')).toBeVisible();
    await clearRateLimits();
    await startCall(alice, bob, 'VOICE');
    await expect(unlock).toBeVisible();
    await unlock.click();
    await expect.poll(() => ringtonePlays(bob.page)).toBeGreaterThan(0);
    await expect(unlock).toBeHidden();
    await bob.page.getByRole('button', { name: t.calls.rejectLabel(alice.user.displayName) }).click();
  });
});
