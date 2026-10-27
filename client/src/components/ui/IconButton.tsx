// client/src/components/ui/IconButton.tsx — nút chỉ có icon: bắt buộc aria-label (ui_ux_spec.md §1.4)
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  icon: ReactNode;
}

export function IconButton({ label, icon, className = '', type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-pill text-text hover:bg-surface-3 disabled:opacity-50 ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
}
