// client/src/features/auth/SessionModal.tsx — phiên bị thu hồi/hết hạn (ui_ux_spec.md §3.9): không đóng bằng Esc/nền;
// một nút "Đăng nhập lại" → xóa dữ liệu phiên → /login. Token đã bị xóa khi mở modal (auth.store.endSession).
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { vi } from '../../i18n/vi';
import { queryClient } from '../../lib/api/queryClient';
import { useAuthStore } from '../../stores/auth.store';

const noop = () => undefined;

export function SessionModal() {
  const reason = useAuthStore((s) => s.sessionEnded);
  const navigate = useNavigate();
  if (!reason) return null;

  const relogin = () => {
    useAuthStore.getState().clearSession();
    useAuthStore.getState().dismissSessionEnded();
    queryClient.clear();
    navigate('/login', { replace: true });
  };

  return (
    <Modal
      open
      title={vi.session[reason]}
      onClose={noop}
      dismissible={false}
      footer={<Button onClick={relogin}>{vi.session.relogin}</Button>}
    >
      {null}
    </Modal>
  );
}
