// client/src/features/auth/LoginPage.tsx — đăng nhập (ui_ux_spec.md §3.1; FR-AUTH-002, AC-003, EC-SEC-005)
import { LoginRequestSchema } from '@hustalo/shared';
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
import { formErrorMessage, useForm, zodFieldErrors } from './form';
import { useCompleteAuth } from './useCompleteAuth';
import { useRetryAfter } from './useRetryAfter';

const INITIAL = { email: '', password: '' };
const FALLBACK = { email: vi.auth.invalidEmail, password: vi.common.required };
type Field = keyof typeof INITIAL;

const validate = (v: Record<Field, string>) =>
  zodFieldErrors(LoginRequestSchema, { ...v, deviceId: getDeviceId() }, v, FALLBACK);

export function LoginPage() {
  const form = useForm(INITIAL, validate);
  const complete = useCompleteAuth();
  const location = useLocation();
  const retry = useRetryAfter();
  const [formError, setFormError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: complete,
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
        setFormError(null);
        retry.start(err.retryAfterSec);
      } else if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
        setFormError(vi.auth.invalidCredentials);
      } else {
        setFormError(formErrorMessage(err));
      }
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (login.isPending || retry.remaining > 0) return;
    setFormError(null);
    if (!form.checkAll()) return;
    login.mutate({ email: form.values.email, password: form.values.password, deviceId: getDeviceId() });
  };

  const message = retry.remaining > 0 ? vi.auth.rateLimited(retry.remaining) : formError;

  return (
    <AuthCard title={vi.auth.loginTitle}>
      <form
        aria-label={vi.auth.loginTitle}
        aria-busy={login.isPending || undefined}
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <TextField label={vi.auth.email} type="email" autoComplete="email" inputMode="email" {...form.field('email')} />
        <PasswordField label={vi.auth.password} autoComplete="current-password" {...form.field('password')} />
        <FormError message={message} />
        <Button type="submit" fullWidth loading={login.isPending} disabled={retry.remaining > 0}>
          {login.isPending ? vi.auth.submittingLogin : vi.auth.submitLogin}
        </Button>
      </form>
      <p className="mt-6 text-sm text-text-secondary">
        {vi.auth.noAccount}{' '}
        <Link to={{ pathname: '/register', search: location.search }} className="font-medium text-primary underline">
          {vi.auth.goRegister}
        </Link>
      </p>
    </AuthCard>
  );
}
