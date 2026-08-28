import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

function showBootError(err: unknown): void {
  const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  console.error('[renderer boot]', err);
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `<pre style="white-space:pre-wrap;padding:24px;color:#f2ece0;font:13px/1.5 ui-monospace,monospace">${message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</pre>`;
}

window.addEventListener('error', (event) => {
  console.error('[window.error]', event.message, event.filename, event.lineno, event.error);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason);
});

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

try {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (err) {
  showBootError(err);
}
