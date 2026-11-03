// client/e2e/call-network.spec.ts — M5: mạng của cuộc gọi (FR-CALL-006, FR-CALL-007; DG §6.6). Chạy trên stack riêng
// (setIcePolicyRelay: server :4100 với ICE_TRANSPORT_POLICY=relay + Vite :5174) nên mọi media đi qua coturn local:
// - `docker compose pause coturn` = cắt đường media thật. context.setOffline của Playwright chỉ giả lập mất mạng cho
//   HTTP/WebSocket, không chặn lưu lượng WebRTC, nên không dùng được để gây RECONNECTING.
// - restart process server giữa cuộc gọi mà không đụng server dev chính (AC-092).
// Chỉ chạy trên project chromium (playwright.config.ts: firefox testIgnore spec này, webkit loại @media).
import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser } from '@playwright/test';
import { vi as t } from '../src/i18n/vi';
import {
  clearRateLimits,
  dockerCompose,
  expectMediaFlowing,
  inboundBytes,
  selectedLocalCandidate,
  setIcePolicyRelay,
  statuses,
  twoUsers,
  waitForSocketReconnected,
  type CallParty,
  type RelayStack,
} from './fixtures';

test.describe.configure({ mode: 'serial' });

/** UDP + TCP như server/.env dev, bỏ turns: (chứng chỉ mkcert không được trình duyệt headless tin). */
const TURN_ALL = 'turn:localhost:3478?transport=udp,turn:localhost:3478?transport=tcp';
/** UDP bị chặn: chỉ cấp TURN qua TCP (EC-CALL-NET-004). */
const TURN_TCP_ONLY = 'turn:localhost:3478?transport=tcp';

let stack: RelayStack | null = null;
let api: APIRequestContext | null = null;
const parties: CallParty[] = [];

test.beforeAll(async () => {
  test.setTimeout(180_000);
  stack = await setIcePolicyRelay({ TURN_FALLBACK_URLS: TURN_ALL });
  api = await playwrightRequest.newContext({ baseURL: stack.baseURL });
});
test.afterAll(async () => {
  await api?.dispose();
  await stack?.stop();
});
test.beforeEach(async () => {
  await clearRateLimits();
});
test.afterEach(async () => {
  await Promise.all(parties.splice(0).map((p) => p.ctx.close()));
  try {
    dockerCompose('unpause', 'coturn'); // phòng test fail giữa chừng khi coturn đang pause
  } catch {
    // coturn không bị pause
  }
});

function relayStack(): { stack: RelayStack; api: APIRequestContext } {
  if (!stack || !api) throw new Error('stack mạng chưa khởi động');
  return { stack, api };
}

/** alice gọi bob trên stack mạng, bob trả lời, chờ CONNECTED ở cả hai. */
async function connectedCall(browser: Browser, callType: 'VOICE' | 'VIDEO') {
  const s = relayStack();
  const r = await twoUsers(browser, s.api, { contextOptions: { baseURL: s.stack.baseURL } });
  parties.push(r.alice, r.bob);
  const name = r.bob.user.displayName;
  await r.alice.page
    .getByRole('button', { name: callType === 'VIDEO' ? t.calls.callVideo(name) : t.calls.callVoice(name) })
    .click();
  await r.bob.page
    .getByRole('alertdialog')
    .getByRole('button', { name: t.calls.acceptLabel(r.alice.user.displayName) })
    .click();
  for (const p of [r.alice, r.bob]) {
    await expect.poll(() => statuses(p).includes('CONNECTED'), { timeout: 30_000 }).toBe(true);
  }
  return r;
}

const relayOf = async (p: CallParty) => {
  const c = await selectedLocalCandidate(p.page);
  return { type: c?.candidateType, protocol: c?.relayProtocol };
};

const callIds = (p: CallParty) => new Set(p.frames.map((f) => f.body.callId).filter((id) => typeof id === 'string'));

test.describe('mạng cuộc gọi @media', () => {
  test('TC-AC-085 TC-CALL-NET-003 ICE_TRANSPORT_POLICY=relay: cuộc gọi video CONNECTED qua cặp candidate relay (coturn local) @media', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { alice, bob } = await connectedCall(browser, 'VIDEO');
    await expectMediaFlowing(alice.page, 'video');
    await expectMediaFlowing(bob.page, 'video');
    const types = [await relayOf(alice), await relayOf(bob)].map((c) => c.type);
    expect(types).toContain('relay');
    await alice.page.getByRole('button', { name: t.calls.hangup }).click();
    await expect.poll(() => statuses(bob).at(-1)).toBe('ENDED');
  });

  test('TC-AC-081 TC-CALL-NET-001 mất đường mạng 8 s giữa cuộc gọi → cả hai "Đang kết nối lại…"; mạng về → ICE restart attempt 1, offer revision 2, CONNECTED ≤ 10 s, cùng một cuộc gọi @media', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const { alice, bob } = await connectedCall(browser, 'VOICE');
    await expectMediaFlowing(bob.page, 'audio');

    await alice.ctx.setOffline(true); // alice mất mạng (HTTP/WebSocket)…
    dockerCompose('pause', 'coturn'); // …và đường media relay cũng mất (setOffline không chặn WebRTC)
    for (const p of [alice, bob]) {
      await expect(p.page.getByText(t.calls.reconnecting)).toBeVisible({ timeout: 15_000 });
    }
    await alice.page.waitForTimeout(8_000);
    const restored = Date.now();
    dockerCompose('unpause', 'coturn');
    await alice.ctx.setOffline(false);

    for (const p of [alice, bob]) {
      await expect.poll(() => statuses(p).at(-1), { timeout: 10_000 }).toBe('CONNECTED');
      await expect(p.page.getByText(t.calls.reconnecting)).toBeHidden();
    }
    expect(Date.now() - restored).toBeLessThanOrEqual(10_000);
    for (const p of [alice, bob]) {
      expect(statuses(p)).toContain('RECONNECTING');
      expect(callIds(p).size).toBe(1); // không tạo cuộc gọi mới
    }
    const restarts = [...alice.sent, ...bob.sent].filter((f) => f.event === 'call:ice-restart');
    expect(restarts.length).toBeGreaterThanOrEqual(1);
    expect(restarts.map((f) => f.payload.attempt)).toContain(1);
    expect(Math.max(...restarts.map((f) => Number(f.payload.attempt)))).toBeLessThanOrEqual(2); // ≤ 2 lần (FR-CALL-006)
    const offers = alice.sent.filter((f) => f.event === 'call:offer').map((f) => f.payload.revision);
    // Offer ICE restart của caller: revision tăng (> 1). Số chính xác (AC ghi "revision 2") phụ thuộc thời điểm — offer
    // tạo khi đang offline không gửi được nên lượt sau có thể là revision 3.
    expect(Math.max(...offers.map(Number))).toBeGreaterThanOrEqual(2);
    await expectMediaFlowing(alice.page, 'audio');
    await expectMediaFlowing(bob.page, 'audio');
  });

  test('TC-AC-092 restart process server giữa cuộc gọi (Redis giữ nguyên) → media không gián đoạn; socket nối lại, vẫn CONNECTED; kết thúc bình thường @media', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const s = relayStack();
    const { alice, bob } = await connectedCall(browser, 'VOICE');
    await expectMediaFlowing(bob.page, 'audio');

    const before = await inboundBytes(bob.page, 'audio');
    const reconnected = [alice, bob].map((p) => waitForSocketReconnected(p.page));
    const restart = s.stack.restartServer();
    await bob.page.waitForTimeout(1_500); // server đang chết: media P2P/relay vẫn chạy
    expect(await inboundBytes(bob.page, 'audio')).toBeGreaterThan(before);
    await restart;
    await Promise.all(reconnected); // handshake socket mới tới server vừa khởi động lại
    await alice.page.waitForTimeout(2_000); // client gửi call:state sau reconnect, server trả trạng thái hiện tại

    for (const p of [alice, bob]) {
      await expect(p.page.getByTestId('in-call')).toBeVisible();
      expect(statuses(p)).not.toContain('ENDED');
      expect(statuses(p)).not.toContain('FAILED');
    }
    await expectMediaFlowing(alice.page, 'audio');
    await expectMediaFlowing(bob.page, 'audio');

    await alice.page.getByRole('button', { name: t.calls.hangup }).click();
    for (const p of [alice, bob]) await expect.poll(() => statuses(p).at(-1), { timeout: 15_000 }).toBe('ENDED');
    await expect(bob.page.getByRole('main').getByText(new RegExp(t.system.CALL_ENDED_VOICE('')))).toBeVisible({
      timeout: 15_000,
    });
  });

  test('TC-CALL-NET-004 UDP bị chặn: chỉ cấp turn:?transport=tcp → ICE chọn relay qua TCP, cuộc gọi bình thường @media', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    await relayStack().stack.restartServer({ TURN_FALLBACK_URLS: TURN_TCP_ONLY });
    try {
      const { alice, bob } = await connectedCall(browser, 'VOICE');
      await expectMediaFlowing(alice.page, 'audio');
      await expectMediaFlowing(bob.page, 'audio');
      for (const p of [alice, bob]) {
        const c = await relayOf(p);
        expect(c.type).toBe('relay');
        expect(['tcp', 'tls']).toContain(c.protocol);
      }
    } finally {
      await relayStack().stack.restartServer({ TURN_FALLBACK_URLS: TURN_ALL });
    }
  });
});
