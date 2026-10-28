// client/src/features/settings/SettingsPage.tsx — /settings và /settings/:section (ui_ux_spec.md §2, §3.8).
// Mobile: /settings chỉ hiện menu, /settings/:section chỉ hiện nội dung (nút ← về /settings).
// Tablet/desktop: 2 cột menu 280 px + nội dung; /settings hiện Hồ sơ. Section chưa có ở M1 → /settings/profile.
import { ArrowLeft } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { vi } from '../../i18n/vi';
import { ProfileSection } from './ProfileSection';
import { SecuritySection } from './SecuritySection';
import { SETTINGS_SECTIONS, SettingsNav, type SettingsSection } from './SettingsNav';

const isSection = (s: string): s is SettingsSection => (SETTINGS_SECTIONS as readonly string[]).includes(s);

export function SettingsPage() {
  const { section } = useParams();
  if (section !== undefined && !isSection(section)) return <Navigate to="/settings/profile" replace />;
  const active: SettingsSection = section ?? 'profile';

  return (
    <div className="flex h-full">
      <div
        className={`${section ? 'hidden md:block' : 'block'} w-full shrink-0 border-r border-border bg-surface-2 md:w-[280px]`}
      >
        <SettingsNav />
      </div>
      <div className={`${section ? 'block' : 'hidden md:block'} min-w-0 flex-1 overflow-y-auto p-4 md:p-6`}>
        {section ? (
          <Link
            to="/settings"
            aria-label={vi.common.back}
            className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-pill hover:bg-surface-3 md:hidden"
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </Link>
        ) : null}
        {active === 'profile' ? <ProfileSection /> : <SecuritySection />}
      </div>
    </div>
  );
}
