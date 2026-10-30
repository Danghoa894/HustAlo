// client/src/features/chat/TypingIndicator.tsx — 3 chấm + chữ "đang soạn tin…" (ui_ux_spec.md §3.3, §6.2):
// GROUP kèm tên ("{A}, {B} đang soạn tin…" / "Nhiều người đang soạn tin…"); aria-live polite riêng.
import type { Conversation } from '@hustalo/shared';
import { useTypingStore } from '../../stores/typing.store';
import { typingText } from '../presence/presence-text';

const EMPTY: string[] = [];

export function useTypingText(
  conversationId: string,
  type: Conversation['type'],
  nameOf: (id: string) => string,
  meId: string,
) {
  const ids = useTypingStore((s) => s.byConversation[conversationId] ?? EMPTY);
  return typingText(type, ids.filter((id) => id !== meId).map(nameOf));
}

export function TypingIndicator({ conversation, meId }: { conversation: Conversation; meId: string }) {
  const nameOf = (id: string) => conversation.members.find((m) => m.userId === id)?.user.displayName ?? '';
  const text = useTypingText(conversation.id, conversation.type, nameOf, meId);
  return (
    <div aria-live="polite" className="min-h-[24px] px-4 pb-1 text-sm italic text-text-secondary">
      {text ? (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-typing-dot rounded-pill bg-text-secondary motion-reduce:animate-none"
                style={{ animationDelay: `${String(i * 200)}ms` }}
              />
            ))}
          </span>
          {text}
        </span>
      ) : null}
    </div>
  );
}
