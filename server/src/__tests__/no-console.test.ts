// EC-SEC-007 (client): không console.log token/nội dung ở production — ESLint `no-console: error` áp cho mã client
// (không tính file test), kiểm bằng cấu hình ESLint thật của repo (calculateConfigForFile, không cần parse).
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('no-console cho mã client (EC-SEC-007)', () => {
  it.each(['client/src/main.tsx', 'client/src/lib/api/http.ts', 'client/src/features/chat/ChatRoomPane.tsx'])(
    'TC-SEC-007 %s → no-console ở mức error',
    async (file) => {
      const eslint = new ESLint({ cwd: repoRoot });
      const config = (await eslint.calculateConfigForFile(file)) as { rules?: Record<string, unknown> };
      const rule = config.rules?.['no-console'];
      const level = Array.isArray(rule) ? rule[0] : rule;
      expect([2, 'error']).toContain(level);
    },
  );
});
