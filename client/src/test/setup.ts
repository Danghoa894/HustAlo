// client/src/test/setup.ts — Vitest jsdom: matcher jest-dom, IndexedDB giả (outbox, khóa E2EE)
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
