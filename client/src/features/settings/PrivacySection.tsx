// client/src/features/settings/PrivacySection.tsx — "Hiển thị lần truy cập gần nhất" (ui_ux_spec.md §3.8; FR-USER-004).
// Switch lưu ngay khi bật/tắt (PATCH /users/me {privacy}): thành công → toast + presence:subscribe lại (socket chuyển
// sang room presence/presence-nols đúng, kiến trúc §7(d)); lỗi → switch trở về giá trị cũ + toast lỗi.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { vi } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { ME_QUERY_KEY, authApi } from '../auth/auth.api';
import { formErrorMessage } from '../auth/form';
import { resubscribePresence } from '../presence/presence-runtime';

const s = vi.settings.privacy;

export function PrivacySection() {
  const saved = useAuthStore((st) => st.user?.privacy.showLastSeen ?? true);
  const [value, setValue] = useState(saved);
  const queryClient = useQueryClient();
  const pushToast = useUiStore((st) => st.pushToast);
  const hintId = useId();

  const save = useMutation({
    mutationFn: (showLastSeen: boolean) => authApi.updateMe({ privacy: { showLastSeen } }),
    onSuccess: (user) => {
      queryClient.setQueryData(ME_QUERY_KEY, user);
      useAuthStore.getState().setUser(user);
      pushToast('success', vi.settings.saved);
      resubscribePresence();
    },
    onError: (err, attempted) => {
      setValue(!attempted);
      pushToast('error', formErrorMessage(err));
    },
  });

  return (
    <section aria-labelledby="privacy-title" className="max-w-xl">
      <h2 id="privacy-title" className="mb-4 text-xl font-semibold">
        {vi.settings.sections.privacy}
      </h2>
      <label className="flex min-h-[44px] cursor-pointer items-start justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-base text-text">{s.showLastSeen}</span>
          <span id={hintId} className="text-sm text-text-secondary">
            {s.showLastSeenHint}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-describedby={hintId}
          checked={value}
          disabled={save.isPending}
          onChange={(e) => {
            setValue(e.target.checked);
            save.mutate(e.target.checked);
          }}
          className="mt-1 h-6 w-11 shrink-0 cursor-pointer accent-primary"
        />
      </label>
    </section>
  );
}
