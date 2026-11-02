// client/src/features/calls/CallStatusText.tsx — dòng trạng thái cuộc gọi, đọc to cho trình đọc màn hình (§3.6, §3.7)
export function CallStatusText({ text }: { text: string }) {
  return (
    <p aria-live="assertive" className="text-md text-white/80">
      {text}
    </p>
  );
}
