// client/src/components/ui/Avatar.tsx — chữ cái đầu của tên; tên là dữ liệu người dùng → chỉ render dạng text
export interface AvatarProps {
  name: string;
  size?: number;
  className?: string;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  return (Array.from(first)[0] ?? '?').toUpperCase() + (Array.from(last)[0] ?? '').toUpperCase();
}

export function Avatar({ name, size = 40, className = '' }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-pill bg-surface-3 font-semibold text-text ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials(name)}
    </span>
  );
}
