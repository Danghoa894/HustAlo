// client/src/components/ui/ConfirmDialog.tsx — xác nhận hành động không hoàn tác: nút "Hủy" trước (được focus),
// nút nguy hiểm màu danger bên phải (ui_ux_spec.md §5.2, §6.3)
import { vi } from '../../i18n/vi';
import { Button } from './Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmDialog({ open, title, confirmLabel, onConfirm, onCancel, loading = false }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {vi.common.cancel}
          </Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}
