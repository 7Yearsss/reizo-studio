import { createServer } from 'vite';
import path from 'node:path';

// Stable QA surface: source changes apply on explicit reload instead of interrupting a gesture.
process.env.VITE_DEV_API_ORIGIN = 'http://127.0.0.1:47160';
const server = await createServer({
  configFile: path.resolve('vite.renderer.config.mts'),
  server: { host: '127.0.0.1', port: 47161, strictPort: true, hmr: false },
  plugins: [{ name: 'local-qa-capture', configureServer(preview) {
    // This uses the authorized renderer origin. The API guard and nonce remain required.
    preview.middlewares.use(async (request, response, next) => {
      if (request.method !== 'GET' || !request.url?.startsWith('/_preview/capture?')) return next();
      try {
        const upstream = await fetch(`http://127.0.0.1:47160${request.url}`);
        response.statusCode = upstream.status;
        response.setHeader('content-type', 'text/html; charset=utf-8');
        const html = await upstream.text();
        response.end(html.replace('</html>', `<script>document.querySelector('form')?.addEventListener('submit',async(event)=>{event.preventDefault();try{const result=await fetch('http://127.0.0.1:47160/_preview/capture',{method:'POST',body:new FormData(event.currentTarget)});const text=await result.text();document.body.innerHTML=text;}catch{document.body.textContent='截图保存失败';}});</script></html>`));
      } catch { response.statusCode = 503; response.end('Preview API unavailable'); }
    });
  } }],
});
await server.listen();
server.printUrls();
