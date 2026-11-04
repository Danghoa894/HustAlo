// client/src/features/e2ee/e2ee.api.ts — REST /e2ee/* (api_spec tag E2EE). Query key Q['e2ee','devices']
// (ui_ux_spec.md §3).
import type {
  DeviceIdentitiesResponse,
  DeviceIdentity,
  DeviceKeysResponse,
  DeviceList,
  OneTimePreKey,
  PreKeyBundle,
  PreKeyBundlesResponse,
  PreKeyCountResponse,
  RegisterDeviceKeysRequest,
} from '@hustalo/shared';
import { ApiError, http } from '../../lib/api/http';

export const devicesKey = ['e2ee', 'devices'] as const;

const device = (deviceId: string) => `/e2ee/devices/${encodeURIComponent(deviceId)}`;

export const e2eeApi = {
  registerKeys: (deviceId: string, body: RegisterDeviceKeysRequest) =>
    http<DeviceKeysResponse>(`${device(deviceId)}/keys`, { method: 'PUT', body }),
  uploadPreKeys: (deviceId: string, oneTimePreKeys: OneTimePreKey[]) =>
    http<PreKeyCountResponse>(`${device(deviceId)}/prekeys`, { method: 'POST', body: { oneTimePreKeys } }),
  devices: () => http<DeviceList>('/e2ee/devices'),
  revoke: (deviceId: string) => http<undefined>(device(deviceId), { method: 'DELETE' }),
  /** Identity key của các device ACTIVE — chỉ đọc, không tiêu thụ prekey (FR-E2EE-006, KI-10). */
  identities: async (userId: string): Promise<DeviceIdentity[]> =>
    (await http<DeviceIdentitiesResponse>(`/e2ee/users/${encodeURIComponent(userId)}/identities`)).items,
  /** Bundle cho mọi device ACTIVE; user không có device (422 E2EE_KEYS_UNAVAILABLE) → [] (FR-E2EE-002). */
  async bundles(userId: string): Promise<PreKeyBundle[]> {
    try {
      return (await http<PreKeyBundlesResponse>(`/e2ee/users/${encodeURIComponent(userId)}/bundles`)).bundles;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'E2EE_KEYS_UNAVAILABLE') return [];
      throw err;
    }
  },
};
