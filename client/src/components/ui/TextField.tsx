// client/src/components/ui/TextField.tsx — ô nhập có nhãn, lỗi inline gắn aria-describedby (ui_ux_spec.md §5.2)
import { useId, type InputHTMLAttributes } from 'react';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

export function TextField({ label, error, hint, id, className = '', ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={inputId} className="text-sm font-medium text-text">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`min-h-[44px] rounded-md border bg-surface px-3 text-base text-text placeholder:text-text-secondary ${error ? 'border-danger' : 'border-border-strong'}`}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-sm text-text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
