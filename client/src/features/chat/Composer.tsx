// client/src/features/chat/Composer.tsx — ô soạn tin (ui_ux_spec.md §3.3 bảng Composer):
// - Enter gửi (trừ khi đang IME composition — bộ gõ tiếng Việt), Shift+Enter xuống dòng, Esc hủy sửa / bỏ focus.
// - ↑ khi ô trống → sửa tin cuối của mình còn trong 15 phút (không áp dụng SECRET).
// - Nút Gửi disabled khi rỗng sau chuẩn hóa (EC-MSG-001) hoặc > MESSAGE_MAX_LENGTH code point (EC-MSG-002);
//   bộ đếm hiện khi còn ≤ 200 ký tự, vượt → màu danger.
// - Nháp lưu sessionStorage['hustalo.draft.{conversationId}'].
// - Typing (M4): typing:start throttle 3 s khi gõ; typing:stop khi gửi, xóa hết hoặc blur (không gửi khi đang sửa).
import { MESSAGE_MAX_LENGTH, countCodePoints, normalizeMessageText, type Message } from '@hustalo/shared';
import { SendHorizontal, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import { vi } from '../../i18n/vi';
import { useTypingEmitter } from './useTypingEmitter';

export const COUNTER_THRESHOLD = 200;
const MAX_ROWS = 6;
const draftKey = (id: string) => `hustalo.draft.${id}`;

function readDraft(id: string): string {
  try {
    return sessionStorage.getItem(draftKey(id)) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(id: string, text: string): void {
  try {
    if (text) sessionStorage.setItem(draftKey(id), text);
    else sessionStorage.removeItem(draftKey(id));
  } catch {
    // sessionStorage bị chặn: bỏ qua nháp.
  }
}

export interface ComposerProps {
  conversationId: string;
  editing: Message | null;
  /** Tin cuối của mình còn sửa được (↑ khi ô trống). */
  lastEditable: Message | null;
  onSend: (text: string) => Promise<boolean>;
  onStartEdit: (m: Message) => void;
  onSaveEdit: (m: Message, text: string) => Promise<boolean>;
  onCancelEdit: () => void;
}

export function Composer({
  conversationId,
  editing,
  lastEditable,
  onSend,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}: ComposerProps) {
  const [text, setText] = useState(() => readDraft(conversationId));
  const ref = useRef<HTMLTextAreaElement>(null);
  const typing = useTypingEmitter(conversationId);

  useEffect(() => {
    if (editing) {
      setText(editing.content ?? '');
      ref.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) writeDraft(conversationId, text);
  }, [conversationId, text, editing]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
    el.style.height = `${String(Math.min(el.scrollHeight, line * MAX_ROWS + 16))}px`;
  }, [text]);

  const length = countCodePoints(normalizeMessageText(text));
  const remaining = MESSAGE_MAX_LENGTH - length;
  const canSend = length > 0 && remaining >= 0;

  const cancelEdit = () => {
    setText(readDraft(conversationId));
    onCancelEdit();
  };

  const submit = async () => {
    if (!canSend) return;
    if (editing) {
      const ok = await onSaveEdit(editing, text);
      if (ok) cancelEdit();
      return;
    }
    const value = text;
    setText('');
    typing.stop();
    const ok = await onSend(value);
    if (!ok) setText(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      if (editing) cancelEdit();
      else e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' && text === '' && !editing && lastEditable) {
      e.preventDefault();
      onStartEdit(lastEditable);
    }
  };

  return (
    <div className="border-t border-border bg-surface-2 px-2 pt-2 pb-[max(8px,var(--safe-bottom))] md:px-4">
      {editing ? (
        <div className="mb-1 flex items-center justify-between rounded-md bg-surface-3 px-3 py-1 text-sm">
          <span>{vi.chat.editing}</span>
          <IconButton label={vi.common.cancel} icon={<X size={16} aria-hidden="true" />} onClick={cancelEdit} />
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          dir="auto"
          aria-label={vi.chat.composerLabel}
          placeholder={vi.chat.composerPlaceholder}
          onChange={(e) => {
            setText(e.target.value);
            if (!editing) typing.onInput(e.target.value);
          }}
          onBlur={typing.stop}
          onKeyDown={onKeyDown}
          className="min-h-[44px] flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-base text-text outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <IconButton
          label={vi.chat.send}
          icon={<SendHorizontal size={20} aria-hidden="true" />}
          disabled={!canSend}
          onClick={() => void submit()}
        />
      </div>
      {remaining <= COUNTER_THRESHOLD ? (
        <p className={`mt-1 text-right text-xs ${remaining < 0 ? 'text-danger' : 'text-text-secondary'}`}>
          {vi.chat.counter(length)}
        </p>
      ) : null}
    </div>
  );
}
