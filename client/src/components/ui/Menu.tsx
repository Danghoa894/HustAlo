// client/src/components/ui/Menu.tsx — menu thả xuống (RoomMenu, MemberRow): role="menu", Esc/click ngoài để đóng,
// ↑/↓ di chuyển, focus mục đầu khi mở, trả focus về nút khi đóng (ui_ux_spec.md §6.3).
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { IconButton } from './IconButton';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const list = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    }
  };

  if (items.length === 0) return null;
  return (
    <div ref={rootRef} className="relative">
      <IconButton
        ref={triggerRef}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        icon={<MoreHorizontal size={20} aria-hidden="true" />}
        onClick={() => {
          setOpen((v) => !v);
        }}
      />
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="absolute right-0 top-full z-dropdown mt-1 min-w-[220px] rounded-md border border-border bg-surface py-1 shadow-md"
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={`flex min-h-[44px] w-full items-center px-4 text-left text-base hover:bg-surface-3 focus:bg-surface-3 ${item.danger ? 'text-danger' : 'text-text'}`}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
