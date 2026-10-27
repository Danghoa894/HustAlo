// client/src/routes/guards/safe-next.ts — chỉ nhận đường dẫn nội bộ cho ?next= (chống open redirect, ui_ux_spec.md §2)
export const DEFAULT_AUTHED_PATH = '/chats';

export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  return next;
}
