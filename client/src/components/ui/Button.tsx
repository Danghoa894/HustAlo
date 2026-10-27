// client/src/components/ui/Button.tsx — nút chuẩn, vùng chạm ≥ 44 px (ui_ux_spec.md §1.3)
import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-on hover:bg-primary-hover',
  secondary: 'bg-surface-2 text-text border border-border-strong hover:bg-surface-3',
  danger: 'bg-danger text-danger-on hover:opacity-90',
  ghost: 'bg-transparent text-text hover:bg-surface-3',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  fullWidth = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-4 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : null}
      {children}
    </button>
  );
}
