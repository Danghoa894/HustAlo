// client/src/routes/PagePlaceholder.tsx — chỗ giữ trang chưa hiện thực ở M0 (LoginPage/RegisterPage: M1, SettingsPage: M1+)
export function PagePlaceholder({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
    </div>
  );
}
