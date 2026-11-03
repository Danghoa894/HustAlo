// TC-ARCH-016 — kiểm tra sau deploy (development_guide.md §9.7) trên môi trường thật: chỉ chạy khi đặt
// E2E_BASE_URL=https://<domain> (workflow cicd-docker job verify); không đặt → cả describe không chạy (runIf).
import { describe, expect, it } from 'vitest';

const base = process.env.E2E_BASE_URL ?? '';
const host = base ? new URL(base).host : '';

describe.runIf(base.startsWith('https://'))(`sau deploy ${host} (§9.7)`, () => {
  it('TC-ARCH-016 health qua nginx → 200 {status: ok, mongo: up, redis: up}', async () => {
    const res = await fetch(`${base}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', mongo: 'up', redis: 'up' });
  });

  it('TC-ARCH-016 http:// → 301 Location https://<domain>/', async () => {
    const res = await fetch(`http://${host}/`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`https://${host}/`);
  });

  it('TC-ARCH-016 HSTS max-age=31536000; includeSubDomains + header bảo mật (kiến trúc §9.6)', async () => {
    const res = await fetch(`${base}/`);
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('SPA fallback: /chats/abc → 200 index.html (no-cache)', async () => {
    const res = await fetch(`${base}/chats/abc`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root"');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});
