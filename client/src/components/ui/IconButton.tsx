// client/src/components/ui/IconButton.tsx — nút chỉ có icon: bắt buộc aria-label (ui_ux_spec.md §1.4)
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-pill text-text hover:bg-surface-3 disabled:opacity-50 ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
});
