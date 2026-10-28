// client/src/features/auth/RegisterPage.tsx — đăng ký (ui_ux_spec.md §3.1; FR-AUTH-001, EC-AUTH-001, EC-SEC-005)
import { DISPLAY_NAME_MAX, RegisterRequestSchema, countCodePoints } from '@hustalo/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/PasswordField';
import { TextField } from '../../components/ui/TextField';
import { vi } from '../../i18n/vi';
import { ApiError } from '../../lib/api/http';
import { getDeviceId } from '../../lib/device/device-id';
import { authApi } from './auth.api';
import { AuthCard } from './AuthCard';
import { FormError } from './FormError';
import { errorFields, formErrorMessage, useForm, zodFieldErrors } from './form';
import { useCompleteAuth } from './useCompleteAuth';
import { useRetryAfter } from './useRetryAfter';

/** Bộ đếm displayName chỉ hiện khi còn ≤ 20 ký tự (ui_ux_spec.md §3.1). */
export const COUNTER_THRESHOLD = 20;

const INITIAL = { email: '', username: '', displayName: '', password: '', confirm: '' };
type Field = keyof typeof INITIAL;
const FALLBACK: Record<Field, string> = {
  email: vi.auth.invalidEmail,
  username: vi.auth.invalidUsername,
  displayName: vi.common.required,
  password: vi.auth.invalidPassword,
  confirm: vi.auth.passwordMismatch,
};

const toRequest = (v: Record<Field, string>) => ({
  email: v.email,
  username: v.username,
  displayName: v.displayName,
  password: v.password,
  deviceId: getDeviceId(),
});

const validate = (v: Record<Field, string>) => {
  const errors = zodFieldErrors(RegisterRequestSchema, toRequest(v), v, FALLBACK);
  if (v.confirm === '') errors.confirm = vi.common.required;
  else if (v.confirm !== v.password) errors.confirm = vi.auth.passwordMismatch;
  return errors;
};

export function DisplayNameCounter({ value }: { value: string }) {
  const n = countCodePoints(value);
  if (DISPLAY_NAME_MAX - n > COUNTER_THRESHOLD) return null;
  return <span className={n > DISPLAY_NAME_MAX ? 'text-danger' : undefined}>{vi.settings.profile.counter(n)}</span>;
}

export function RegisterPage() {
  const form = useForm(INITIAL, validate);
  const complete = useCompleteAuth();
  const location = useLocation();
  const retry = useRetryAfter();
  const [formError, setFormError] = useState<string | null>(null);

  const register = useMutation({
    mutationFn: authApi.register,
    onSuccess: complete,
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
        setFormError(null);
        retry.start(err.retryAfterSec);
        return;
      }
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        const field = errorFields(err)[0];
        if (field === 'email' || field === 'username') {
          form.setServerError(field, field === 'email' ? vi.auth.emailTaken : vi.auth.usernameTaken);
          return;
        }
      }
      setFormError(formErrorMessage(err));
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (register.isPending || retry.remaining > 0) return;
    setFormError(null);
    if (!form.checkAll()) return;
    register.mutate(toRequest(form.values));
  };

  const username = form.field('username');
  const message = retry.remaining > 0 ? vi.auth.rateLimited(retry.remaining) : formError;

  return (
    <AuthCard title={vi.auth.registerTitle}>
      <form
        aria-label={vi.auth.registerTitle}
        aria-busy={register.isPending || undefined}
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <TextField label={vi.auth.email} type="email" autoComplete="email" inputMode="email" {...form.field('email')} />
        <TextField
          label={vi.auth.username}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          hint={vi.auth.usernameHint}
          {...username}
          onChange={(e) => {
            username.onChange({ target: { value: e.target.value.toLowerCase() } });
          }}
        />
        <TextField
          label={vi.auth.displayName}
          autoComplete="name"
          hint={<DisplayNameCounter value={form.values.displayName} />}
          {...form.field('displayName')}
        />
        <PasswordField
          label={vi.auth.password}
          autoComplete="new-password"
          hint={vi.auth.passwordHint}
          {...form.field('password')}
        />
        <PasswordField label={vi.auth.confirmPassword} autoComplete="new-password" {...form.field('confirm')} />
        <FormError message={message} />
        <Button type="submit" fullWidth loading={register.isPending} disabled={retry.remaining > 0}>
          {register.isPending ? vi.auth.submittingRegister : vi.auth.submitRegister}
        </Button>
      </form>
      <p className="mt-6 text-sm text-text-secondary">
        {vi.auth.haveAccount}{' '}
        <Link to={{ pathname: '/login', search: location.search }} className="font-medium text-primary underline">
          {vi.auth.goLogin}
        </Link>
      </p>
    </AuthCard>
  );
}
