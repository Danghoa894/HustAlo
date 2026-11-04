// E2eeBadge + placeholder bubble SECRET (ui_ux_spec.md §3.3, §4.5): "Mã hóa đầu-cuối" chỉ khi đã có session (AC-122).
import type { Message } from '@hustalo/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useE2eeStore } from '../../stores/e2ee.store';
import { E2eeBadge } from './E2eeBadge';
import { MessageBubble } from './MessageBubble';

describe('E2eeBadge', () => {
  it('TC-AC-122 chưa có session → "Đang thiết lập mã hóa…", không có "Mã hóa đầu-cuối"', () => {
    render(<E2eeBadge status="SETTING_UP" onOpen={() => undefined} />);
    expect(screen.getByTestId('e2ee-badge')).toHaveTextContent(t.e2ee.settingUp);
    expect(screen.queryByText(t.e2ee.encrypted)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('có session → nút "Mã hóa đầu-cuối" mở safety number; mọi device đã xác minh → "Đã xác minh"', () => {
    const onOpen = vi.fn();
    const { rerender } = render(<E2eeBadge status="ENCRYPTED" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: t.e2ee.encrypted }));
    expect(onOpen).toHaveBeenCalled();
    rerender(<E2eeBadge status="VERIFIED" onOpen={onOpen} />);
    expect(screen.getByTestId('e2ee-badge')).toHaveTextContent(t.e2ee.verified);
  });
});

const secretMessage = (id: string): Message => ({
  id,
  conversationId: '6720b1b2c3d4e5f601234501',
  senderId: '6720a1b2c3d4e5f601234562',
  sender: { id: '6720a1b2c3d4e5f601234562', displayName: 'Bob' },
  senderDeviceId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  clientMessageId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  type: 'TEXT',
  content: null,
  ciphertext: { v: 1, senderDeviceId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', recipients: [] },
  system: null,
  receipt: null,
  createdAt: '2026-11-04T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
});

describe('bubble SECRET không có bản rõ', () => {
  beforeEach(() => {
    useE2eeStore.getState().reset();
  });

  it.each([
    ['TC-E2EE-007', 'NOT_FOR_DEVICE', t.e2ee.notForDevice],
    ['TC-E2EE-004', 'DECRYPT_FAILED', t.e2ee.decryptFailed],
    ['TC-E2EE-005', 'REVOKED_DEVICE', t.e2ee.fromRevokedDevice],
  ] as const)('%s %s → "%s"', (_id, state, text) => {
    const m = secretMessage(`6720f1b2c3d4e5f60123${state.length.toString().padStart(4, '0')}`);
    useE2eeStore.getState().setPlaceholder(m.id, state);
    render(
      <MessageBubble
        message={m}
        meId="6720a1b2c3d4e5f601234561"
        mine={false}
        first
        last
        showName={false}
        status={null}
        editing={false}
        onEdit={() => undefined}
        onRecall={() => Promise.resolve(true)}
      />,
    );
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
