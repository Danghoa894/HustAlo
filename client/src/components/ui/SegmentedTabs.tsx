// client/src/components/ui/SegmentedTabs.tsx — tab dạng nút liền nhau (role="tablist"); ←/→ chuyển tab (ui_ux_spec.md §3.2)
import type { KeyboardEvent } from 'react';

export function SegmentedTabs<T extends string>(props: {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = props.tabs.findIndex((t) => t.id === props.value);
    const next = props.tabs[(i + (e.key === 'ArrowRight' ? 1 : props.tabs.length - 1)) % props.tabs.length];
    if (next) props.onChange(next.id);
  };
  return (
    <div
      role="tablist"
      aria-label={props.label}
      onKeyDown={onKey}
      className="mx-4 my-2 flex rounded-md bg-surface-3 p-1"
    >
      {props.tabs.map((t) => {
        const selected = t.id === props.value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              props.onChange(t.id);
            }}
            className={`flex-1 rounded-sm py-1.5 text-sm font-medium ${selected ? 'bg-surface-2 text-text shadow-sm' : 'text-text-secondary'}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
