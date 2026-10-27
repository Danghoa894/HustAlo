// client/src/components/ui/Spinner.tsx
export interface SpinnerProps {
  label?: string;
  size?: number;
  className?: string;
}

export function Spinner({ label, size = 20, className = '' }: SpinnerProps) {
  return (
    <span role="status" className={`inline-flex items-center gap-2 ${className}`}>
      <span
        aria-hidden="true"
        className="inline-block animate-spin rounded-pill border-2 border-border-strong border-t-primary"
        style={{ width: size, height: size }}
      />
      {label ? <span className="text-sm text-text-secondary">{label}</span> : null}
    </span>
  );
}
