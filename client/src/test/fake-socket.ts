// client/src/test/fake-socket.ts — socket giả tối thiểu (on/off/emit, connect/disconnect) cho unit test
import { vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

export class FakeSocket {
  connected = false;
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return this;
  }

  off(event: string, fn: Listener): this {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  /** Giả lập server/manager phát event tới client. */
  emit(event: string, ...args: unknown[]): boolean {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn(...args);
    return true;
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  connect = vi.fn(() => this);
  disconnect = vi.fn(() => this);
}
