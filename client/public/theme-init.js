// client/public/theme-init.js — đặt data-theme trước khi React render, tránh nhấp nháy (ui_ux_spec.md §1.5).
// Nạp đồng bộ trong <head>; không inline vì CSP script-src 'self'.
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('hustalo.theme') || 'system';
  } catch {
    // localStorage bị chặn → dùng theo hệ thống
  }
  var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#1E293B' : '#F7F8FA'); // surface-2 theo theme
})();
