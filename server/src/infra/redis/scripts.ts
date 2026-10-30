// server/src/infra/redis/scripts.ts — nạp Lua (infra/redis/scripts/*.lua, DB Phụ lục A) qua defineCommand: ioredis tự
// EVALSHA và nạp lại khi Redis mất script cache (FLUSHALL / restart). Bản build: tsup chép thư mục scripts/ sang dist/.
import { readFileSync } from 'node:fs';
import type { Redis } from 'ioredis';

const read = (name: string) => readFileSync(new URL(`./scripts/${name}.lua`, import.meta.url), 'utf8');

export interface ScriptCommands {
  presenceTouch(
    conns: string,
    users: string,
    pending: string,
    connId: string,
    nowMs: number,
    leaseMs: number,
    userId: string,
  ): Promise<number>;
  presenceDrop(
    conns: string,
    pending: string,
    connId: string,
    nowMs: number,
    graceMs: number,
    userId: string,
  ): Promise<number>;
  claimDue(zset: string, nowMs: number, limit: number): Promise<string[]>;
}

const defined = new WeakSet<Redis>();

/** defineCommand một lần cho mỗi client; trả client đã có các lệnh Lua. */
export function withScripts(client: Redis): Redis & ScriptCommands {
  if (!defined.has(client)) {
    client.defineCommand('presenceTouch', { numberOfKeys: 3, lua: read('presence-touch') });
    client.defineCommand('presenceDrop', { numberOfKeys: 2, lua: read('presence-drop') });
    client.defineCommand('claimDue', { numberOfKeys: 1, lua: read('call-deadlines-claim') });
    defined.add(client);
  }
  return client as Redis & ScriptCommands;
}
