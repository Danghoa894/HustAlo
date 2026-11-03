// client/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { scheduleInterFont } from './lib/fonts/fonts';
import './styles/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Thiếu phần tử #root trong index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// Font Inter nạp sau lần render đầu để không chặn/tranh băng thông với JS khởi tạo (NFR-05, ui_ux_spec.md §1.1).
scheduleInterFont();
