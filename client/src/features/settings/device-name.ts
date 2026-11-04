// client/src/features/settings/device-name.ts — tên thiết bị dựng từ User-Agent của phiên gần nhất ("Chrome trên
// Windows", ui_ux_spec.md §3.8). Chỉ nhận diện các trình duyệt/hệ điều hành phổ biến; còn lại "Trình duyệt không xác định".
import { vi } from '../../i18n/vi';

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

export function deviceName(userAgent: string): string {
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const os = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  if (!browser && !os) return vi.e2ee.unknownDevice;
  if (!os) return browser ?? vi.e2ee.unknownDevice;
  return vi.e2ee.deviceName(browser ?? vi.e2ee.unknownDevice, os);
}
