// client/src/routes/NotFoundPage.tsx — route * (ui_ux_spec.md §2)
import { Link } from 'react-router-dom';
import { vi } from '../i18n/vi';

export function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">{vi.notFound.title}</h1>
      <Link
        to="/chats"
        className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 font-medium text-primary-on hover:bg-primary-hover"
      >
        {vi.notFound.backHome}
      </Link>
    </div>
  );
}
