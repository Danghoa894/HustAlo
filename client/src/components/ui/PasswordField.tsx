// client/src/components/ui/PasswordField.tsx — TextField + nút hiện/ẩn mật khẩu (ui_ux_spec.md §3.1)
import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { vi } from '../../i18n/vi';
import { IconButton } from './IconButton';
import { TextField, type TextFieldProps } from './TextField';

export type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'trailing'>;

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(props, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      ref={ref}
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <IconButton
          label={visible ? vi.common.hidePassword : vi.common.showPassword}
          aria-pressed={visible}
          icon={visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
          onClick={() => {
            setVisible((v) => !v);
          }}
        />
      }
    />
  );
});
