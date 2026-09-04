import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

function showBootError(err: unknown): void {
  const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  console.error('[renderer boot]', err);
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `
    <div style="min-height:100vh;background:#0d0d0d;color:#f2ece0;padding:32px;font-family:system-ui,-apple-system,sans-serif;box-sizing:border-box;">
      <h2 style="color:#fb7185;margin-top:0;font-size:18px;">应用启动 / 渲染异常</h2>
      <pre style="white-space:pre-wrap;background:#161616;border:1px solid #2a2a2a;padding:16px;border-radius:8px;font:12px/1.6 ui-monospace,monospace;overflow:auto;max-height:400px;">${message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</pre>
      <div style="margin-top:16px;display:flex;gap:12px;">
        <button onclick="window.location.reload()" style="background:#e07a3f;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;">刷新页面</button>
        <button onclick="localStorage.clear();window.location.reload()" style="background:#222;color:#eee;border:1px solid #333;padding:8px 16px;border-radius:6px;cursor:pointer;">清除缓存并刷新</button>
      </div>
    </div>
  `;
}

window.addEventListener('error', (event) => {
  console.error('[window.error]', event.message, event.filename, event.lineno, event.error);
  const root = document.getElementById('root');
  if (root && (!root.firstElementChild || root.innerHTML.trim() === '')) {
    showBootError(event.error || event.message);
  }
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason);
  const root = document.getElementById('root');
  if (root && (!root.firstElementChild || root.innerHTML.trim() === '')) {
    showBootError(event.reason);
  }
});

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

try {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
} catch (err) {
  showBootError(err);
}
