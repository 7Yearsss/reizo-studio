import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const root = await realpath(process.argv[2] || 'dist');
const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const probe = `const out=document.createElement('output');out.setAttribute('aria-label','生产画布性能参考');out.style.cssText='position:fixed;top:48px;right:12px;z-index:1000;pointer-events:none;background:#fff;color:#222;font:11px sans-serif;padding:5px';out.textContent='采样中';document.body.append(out);out.dataset.gestureCount='0';let completed=0,last=0,start=performance.now(),frames=[],gesture=[],movingBefore=false,result='';function stats(a){const sorted=[...a].sort((x,y)=>x-y);return {fps:a.length*1000/a.reduce((x,y)=>x+y,0),p95:sorted[Math.floor((sorted.length-1)*.95)]||0};}function frame(t){if(document.hidden){last=0;frames=[];gesture=[];movingBefore=false;start=t;}else{const moving=document.querySelector('[data-dragging]')?.getAttribute('data-dragging')==='true';if(last){frames.push(t-last);if(moving&&movingBefore&&gesture.length<10000)gesture.push(t-last);}if(!moving&&movingBefore&&gesture.length>1){const s=stats(gesture);result=' · last gesture '+s.fps.toFixed(0)+' fps / p95 '+s.p95.toFixed(1)+' ms';out.dataset.gestureCount=String(++completed);out.textContent=result;}if(moving&&!movingBefore)gesture=[];movingBefore=moving;last=t;if(t-start>1000){const s=stats(frames);out.textContent='production rAF '+s.fps.toFixed(0)+' fps · p95 '+s.p95.toFixed(1)+' ms · '+document.querySelectorAll('.react-flow__node').length+' nodes'+result;frames=[];start=t;}}requestAnimationFrame(frame);}requestAnimationFrame(frame);`;
const bridge = `<script>window.reizo={getApiOrigin:async()=> 'http://127.0.0.1:47160'};</script>`;
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:47161');
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    if (url.pathname === '/_qa/probe.js') { response.setHeader('content-type', 'text/javascript'); response.end(probe); return; }
    if (url.pathname === '/_preview/capture') {
      const upstream = await fetch(`http://127.0.0.1:47160${url.pathname}${url.search}`);
      response.writeHead(upstream.status, { 'content-type': 'text/html; charset=utf-8' });
      const html = await upstream.text();
      response.end(html.replace('</html>', `<script>document.querySelector('form')?.addEventListener('submit',async(e)=>{e.preventDefault();const r=await fetch('http://127.0.0.1:47160/_preview/capture',{method:'POST',body:new FormData(e.currentTarget)});document.body.innerHTML=await r.text();});</script></html>`)); return;
    }
    const candidate = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (candidate !== root && !candidate.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    const file = url.pathname === '/' ? path.join(root, 'index.html') : await realpath(candidate);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    response.setHeader('content-type', contentTypes[path.extname(file)] || 'application/octet-stream');
    response.setHeader('cache-control', 'no-store');
    const bytes = await readFile(file);
    response.end(path.extname(file) === '.html' ? bytes.toString().replace('<head>', '<head>' + bridge).replace('</body>', '<script src="/_qa/probe.js"></script></body>') : bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(47161, '127.0.0.1', () => console.log(JSON.stringify({ origin: 'http://127.0.0.1:47161', root, pid: process.pid, mode: 'production-fixture' })));
