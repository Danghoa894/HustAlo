// client/src/features/settings/ProfileSection.tsx — hồ sơ: displayName (đếm /80), avatarUrl, username/email chỉ đọc
// (ui_ux_spec.md §3.8; FR-USER-002, AC-013). Dữ liệu Q['me'] = GET /auth/me; lưu = PATCH /users/me các trường đã đổi.
import { UpdateMeRequestSchema, type UpdateMeRequest, type UserMe } from '@hustalo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { vi } from '../../i18n/vi';
import { ApiError } from '../../lib/api/http';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { ME_QUERY_KEY, authApi } from '../auth/auth.api';
import { errorFields, formErrorMessage, useForm, zodFieldErrors } from '../auth/form';
import { DisplayNameCounter } from '../auth/RegisterPage';
import { SectionSkeleton } from './SectionSkeleton';

type Field = 'displayName' | 'avatarUrl';
const FALLBACK: Record<Field, string> = {
  displayName: vi.common.required,
  avatarUrl: vi.settings.profile.invalidAvatarUrl,
};

const toPatch = (v: Record<Field, string>, base: UserMe): UpdateMeRequest => {
  const patch: UpdateMeRequest = {};
  if (v.displayName !== base.displayName) patch.displayName = v.displayName;
  const avatarUrl = v.avatarUrl.trim() === '' ? null : v.avatarUrl.trim();
  if (avatarUrl !== base.avatarUrl) patch.avatarUrl = avatarUrl;
  return patch;
};

const validate = (v: Record<Field, string>) =>
  zodFieldErrors(
    UpdateMeRequestSchema,
    { displayName: v.displayName, avatarUrl: v.avatarUrl.trim() === '' ? null : v.avatarUrl.trim() },
    v,
    FALLBACK,
  );

function ProfileForm({ me }: { me: UserMe }) {
  const initial = useMemo(() => ({ displayName: me.displayName, avatarUrl: me.avatarUrl ?? '' }), [me]);
  const form = useForm<Field>(initial, validate);
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const save = useMutation({
    mutationFn: authApi.updateMe,
    onSuccess: (user) => {
      queryClient.setQueryData(ME_QUERY_KEY, user);
      useAuthStore.getState().setUser(user);
      pushToast('success', vi.settings.saved);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        const fields = errorFields(err).filter((f): f is Field => f in FALLBACK);
        if (fields.length > 0) {
          for (const f of fields) form.setServerError(f, FALLBACK[f]);
          return;
        }
      }
      pushToast('error', formErrorMessage(err));
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending || !form.checkAll()) return;
    const patch = toPatch(form.values, me);
    if (Object.keys(patch).length === 0) return;
    save.mutate(patch);
  };

  return (
    <form aria-label={vi.settings.sections.profile} noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <TextField
        label={vi.settings.profile.displayName}
        autoComplete="name"
        hint={<DisplayNameCounter value={form.values.displayName} />}
        {...form.field('displayName')}
      />
      <TextField
        label={vi.settings.profile.avatarUrl}
        type="url"
        inputMode="url"
        placeholder="https://"
        {...form.field('avatarUrl')}
      />
      <TextField label={vi.settings.profile.username} value={me.username} readOnly />
      <TextField label={vi.settings.profile.email} value={me.email} readOnly />
      <div>
        <Button type="submit" loading={save.isPending}>
          {vi.common.save}
        </Button>
      </div>
    </form>
  );
}

export function ProfileSection() {
  const cached = useAuthStore((s) => s.user);
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: authApi.me });
  const data = me.data ?? cached;
  return (
    <section aria-labelledby="settings-profile-title" className="flex max-w-xl flex-col gap-4">
      <h2 id="settings-profile-title" className="text-lg font-semibold">
        {vi.settings.sections.profile}
      </h2>
      {data ? <ProfileForm key={data.id} me={data} /> : <SectionSkeleton />}
    </section>
  );
}
