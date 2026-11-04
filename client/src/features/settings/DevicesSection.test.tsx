// DevicesSection (ui_ux_spec.md §3.8; FR-E2EE-001, FR-E2EE-007): danh sách thiết bị, thu hồi có xác nhận, banner đủ 5.
import type { DeviceList } from '@hustalo/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { useE2eeStore } from '../../stores/e2ee.store';
import { jsonResponse, urlOf, userMe } from '../../test/fixtures';
import { renderPage } from '../../test/render';
import { deviceName } from './device-name';
import { DevicesSection } from './DevicesSection';

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const list: DeviceList = {
  items: [
    {
      deviceId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      signalDeviceId: 1,
      status: 'ACTIVE',
      isCurrent: true,
      userAgent: CHROME_WIN,
      oneTimePreKeyCount: 97,
      createdAt: '2026-10-20T08:00:00.000Z',
      revokedAt: null,
    },
    {
      deviceId: '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d',
      signalDeviceId: 2,
      status: 'ACTIVE',
      isCurrent: false,
      userAgent: SAFARI_IPHONE,
      oneTimePreKeyCount: 40,
      createdAt: '2026-10-22T08:00:00.000Z',
      revokedAt: null,
    },
  ],
};

describe('deviceName', () => {
  it('dựng "{trình duyệt} trên {hệ điều hành}"', () => {
    expect(deviceName(CHROME_WIN)).toBe('Chrome trên Windows');
    expect(deviceName(SAFARI_IPHONE)).toBe('Safari trên iPhone');
    expect(deviceName('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe(
      'Firefox trên Linux',
    );
    expect(deviceName('')).toBe(t.e2ee.unknownDevice);
  });
});

describe('DevicesSection', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: 'tok', user: userMe(), bootstrapped: true, sessionEnded: null });
    useE2eeStore.getState().reset();
    fetchMock.mockImplementation((input, init) =>
      Promise.resolve(init?.method === 'DELETE' ? new Response(null, { status: 204 }) : jsonResponse(200, list)),
    );
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('thiết bị này "Đang dùng" + "Sẵn sàng trò chuyện bí mật"; thiết bị khác có "Thu hồi"', async () => {
    renderPage(<DevicesSection />, { path: '/' });
    const rows = await screen.findAllByTestId('device-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Chrome trên Windows');
    expect(rows[0]).toHaveTextContent(t.e2ee.inUse);
    expect(rows[0]).toHaveTextContent(t.e2ee.ready);
    expect(rows[1]).toHaveTextContent('Safari trên iPhone');
  });

  it('TC-AC-117 "Thu hồi" → modal xác nhận → DELETE /e2ee/devices/{id}', async () => {
    renderPage(<DevicesSection />, { path: '/' });
    const rows = await screen.findAllByTestId('device-row');
    const other = rows[1];
    if (!other) throw new Error('thiếu dòng');
    fireEvent.click(within(other).getByRole('button', { name: t.e2ee.revoke }));
    const dialog = await screen.findByRole('dialog', { name: t.e2ee.confirmRevoke });
    fireEvent.click(within(dialog).getByRole('button', { name: t.e2ee.revoke }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([u, init]) =>
            urlOf(u).endsWith(`/e2ee/devices/${list.items[1]?.deviceId ?? ''}`) && init?.method === 'DELETE',
        ),
      ).toBe(true);
    });
  });

  it('device này đủ 5 (409) → banner yêu cầu thu hồi thiết bị khác', async () => {
    useE2eeStore.getState().setDevice('LIMIT');
    renderPage(<DevicesSection />, { path: '/' });
    expect(await screen.findByText(t.e2ee.deviceLimit)).toBeInTheDocument();
  });
});
