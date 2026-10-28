// client/src/features/settings/SecuritySection.tsx — đổi mật khẩu POST /auth/change-password (ui_ux_spec.md §3.8;
// FR-AUTH-005, EC-AUTH-006, EC-AUTH-008, AC-018). 422 currentPassword chỉ báo lỗi inline: không refresh, không đăng xuất.
import { ChangePasswordRequestSchema } from '@hustalo/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/PasswordField';
import { vi } from '../../i18n/vi';
import { ApiError } from '../../lib/api/http';
import { useUiStore } from '../../stores/ui.store';
import { authApi } from '../auth/auth.api';
import { FormError } from '../auth/FormError';
import { errorFields, formErrorMessage, useForm, zodFieldErrors } from '../auth/form';
import { useRetryAfter } from '../auth/useRetryAfter';

const s = vi.settings.security;
const INITIAL = { currentPassword: '', newPassword: '', confirm: '' };
type Field = keyof typeof INITIAL;
const FALLBACK: Record<Field, string> = {
  currentPassword: vi.common.required,
  newPassword: vi.auth.invalidPassword,
  confirm: vi.auth.passwordMismatch,
};

const validate = (v: Record<Field, string>) => {
  const errors = zodFieldErrors(
    ChangePasswordRequestSchema,
    { currentPassword: v.currentPassword, newPassword: v.newPassword },
    v,
    FALLBACK,
  );
  if (v.confirm === '') errors.confirm = vi.common.required;
  else if (v.confirm !== v.newPassword) errors.confirm = vi.auth.passwordMismatch;
  return errors;
};

export function SecuritySection() {
  const form = useForm(INITIAL, validate);
  const retry = useRetryAfter();
  const pushToast = useUiStore((st) => st.pushToast);
  const [formError, setFormError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: () => {
      form.reset();
      pushToast('success', s.changed, s.othersLoggedOut);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
        setFormError(null);
        retry.start(err.retryAfterSec);
        return;
      }
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        if (errorFields(err).includes('currentPassword')) {
          form.setServerError('currentPassword', s.wrongCurrentPassword);
          return;
        }
        if (errorFields(err).includes('newPassword')) {
          form.setServerError('newPassword', vi.auth.invalidPassword);
          return;
        }
      }
      setFormError(formErrorMessage(err));
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (change.isPending || retry.remaining > 0) return;
    setFormError(null);
    if (!form.checkAll()) return;
    change.mutate({ currentPassword: form.values.currentPassword, newPassword: form.values.newPassword });
  };

  const message = retry.remaining > 0 ? vi.auth.rateLimited(retry.remaining) : formError;

  return (
    <section aria-labelledby="settings-security-title" className="flex max-w-xl flex-col gap-4">
      <h2 id="settings-security-title" className="text-lg font-semibold">
        {s.changePassword}
      </h2>
      <form
        aria-label={s.changePassword}
        aria-busy={change.isPending || undefined}
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <PasswordField label={s.currentPassword} autoComplete="current-password" {...form.field('currentPassword')} />
        <PasswordField
          label={s.newPassword}
          autoComplete="new-password"
          hint={vi.auth.passwordHint}
          {...form.field('newPassword')}
        />
        <PasswordField label={s.confirmNewPassword} autoComplete="new-password" {...form.field('confirm')} />
        <FormError message={message} />
        <div>
          <Button type="submit" loading={change.isPending} disabled={retry.remaining > 0}>
            {s.changePassword}
          </Button>
        </div>
      </form>
    </section>
  );
}
