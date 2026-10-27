import { describe, expect, it } from 'vitest';
import { getDeviceId, getTabId } from './device-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('device-id', () => {
  it('deviceId là UUID v4, ổn định qua nhiều lần gọi, lưu ở localStorage hustalo.deviceId', () => {
    const id = getDeviceId();
    expect(id).toMatch(UUID_V4);
    expect(getDeviceId()).toBe(id);
    expect(localStorage.getItem('hustalo.deviceId')).toBe(id);
  });

  it('tabId lưu ở sessionStorage hustalo.tabId, khác deviceId', () => {
    const tab = getTabId();
    expect(tab).toMatch(UUID_V4);
    expect(sessionStorage.getItem('hustalo.tabId')).toBe(tab);
    expect(tab).not.toBe(getDeviceId());
  });

  it('giá trị hỏng trong storage bị thay bằng UUID mới', () => {
    localStorage.setItem('hustalo.deviceId', 'khong-phai-uuid');
    expect(getDeviceId()).toMatch(UUID_V4);
  });
});
