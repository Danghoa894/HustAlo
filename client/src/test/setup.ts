// client/src/test/setup.ts — Vitest jsdom: matcher jest-dom, IndexedDB giả (outbox, khóa E2EE)
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom không có Element.scrollTo / scrollIntoView (MessageList cuộn danh sách).
if (!('scrollTo' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollTo', { value: () => undefined, writable: true });
}
if (!('scrollIntoView' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => undefined, writable: true });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
