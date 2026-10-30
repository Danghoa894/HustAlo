// client/src/features/chat/DateDivider.tsx — "──── Hôm nay ────" (ui_ux_spec.md §3.3)
export function DateDivider({ label }: { label: string }) {
  return (
    <div role="separator" aria-label={label} className="my-3 flex items-center gap-3 px-4 text-xs text-text-secondary">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span aria-hidden="true">{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
