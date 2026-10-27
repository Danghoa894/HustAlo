// client/src/lib/device/device-id.ts — deviceId bền theo trình duyệt (localStorage), tabId theo tab (sessionStorage).
// deviceId phải khớp claim `did` của access token (kiến trúc §6.3); không sửa tay (troubleshooting T-06).
const DEVICE_KEY = 'hustalo.deviceId';
const TAB_KEY = 'hustalo.tabId';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let memoryDeviceId: string | undefined;
let memoryTabId: string | undefined;

function readOrCreate(storage: Storage | undefined, key: string, fallback: () => string): string {
  try {
    const existing = storage?.getItem(key);
    if (existing && UUID_V4.test(existing)) return existing;
    const id = crypto.randomUUID();
    storage?.setItem(key, id);
    return id;
  } catch {
    // Storage bị chặn (chế độ riêng tư nghiêm ngặt) → giữ trong RAM cho phiên hiện tại.
    return fallback();
  }
}

export function getDeviceId(): string {
  return readOrCreate(globalThis.localStorage, DEVICE_KEY, () => (memoryDeviceId ??= crypto.randomUUID()));
}

export function getTabId(): string {
  return readOrCreate(globalThis.sessionStorage, TAB_KEY, () => (memoryTabId ??= crypto.randomUUID()));
}
