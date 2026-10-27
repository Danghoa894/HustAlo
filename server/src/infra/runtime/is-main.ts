// server/src/infra/runtime/is-main.ts
import { pathToFileURL } from 'node:url';

export function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && metaUrl === pathToFileURL(entry).href;
}
