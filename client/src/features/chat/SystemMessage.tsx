// client/src/features/chat/SystemMessage.tsx — dòng SYSTEM giữa danh sách tin (ui_ux_spec.md §3.3; dùng trong MessageList ở M3)
import { useAuthStore } from '../../stores/auth.store';
import { systemText, type SystemView } from './system-text';

export function SystemMessage({ system }: { system: SystemView }) {
  const meId = useAuthStore((s) => s.user?.id ?? '');
  return (
    <p className="my-3 px-4 text-center text-xs text-text-secondary" role="note">
      {systemText(system, meId)}
    </p>
  );
}
