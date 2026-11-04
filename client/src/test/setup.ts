// client/src/test/setup.ts — Vitest jsdom: matcher jest-dom, IndexedDB giả (outbox, khóa E2EE). Test mật mã chạy
// `@vitest-environment node` (WebCrypto của Node không nhận ArrayBuffer của jsdom) → bỏ qua phần DOM khi không có.
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

const hasDom = typeof Element !== 'undefined';

// jsdom không có Element.scrollTo / scrollIntoView (MessageList cuộn danh sách).
if (hasDom && !('scrollTo' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollTo', { value: () => undefined, writable: true });
}
if (hasDom && !('scrollIntoView' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => undefined, writable: true });
}

afterEach(() => {
  if (!hasDom) return;
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
