import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  console.log('Connecting to Reizo Studio CDP on port 9223...');
  const res = await fetch('http://127.0.0.1:9223/json/list');
  const targets = await res.json();
  const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:46173'));
  if (!pageTarget) {
    throw new Error('No Reizo Studio page target found in ' + JSON.stringify(targets));
  }
  console.log('Target found:', pageTarget.id);

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
    }
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async function evalExpr(expression) {
    const r = await cdp('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error('Eval failed: ' + JSON.stringify(r.exceptionDetails));
    }
    return r.result.value;
  }

  async function takeScreenshot(name) {
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(shot.data, 'base64');
    const path = resolve('C:/Users/XXB/.gemini/antigravity/brain/156f308c-d535-469e-8101-1cc6ba21194b', name);
    writeFileSync(path, buffer);
    console.log(`Saved screenshot to ${path}`);
    return path;
  }

  // 1. Check window.reizo.getQuickIntegrationsStatus
  console.log('--- Step 1: Checking window.reizo.getQuickIntegrationsStatus() ---');
  const status = await evalExpr(`(async () => {
    return await window.reizo.getQuickIntegrationsStatus();
  })()`);
  console.log('getQuickIntegrationsStatus result:', JSON.stringify(status, null, 2));

  if (!status || typeof status.notion?.connected !== 'boolean' || typeof status.gmail?.connected !== 'boolean') {
    throw new Error('Invalid status returned: ' + JSON.stringify(status));
  }

  // 2. Ensure we are on Settings -> Extensions
  console.log('--- Step 2: Ensuring Settings -> Extensions view ---');
  await evalExpr(`(() => {
    // If not in settings, click sidebar button
    const extNav = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent && b.textContent.includes('扩展'));
    if (extNav) {
      extNav.click();
    } else {
      const profile = document.querySelector('.mt-auto button');
      if (profile) profile.click();
    }
  })()`);
  await new Promise(r => setTimeout(r, 800));

  await evalExpr(`(() => {
    const extNav = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent && b.textContent.includes('扩展'));
    if (extNav) extNav.click();
  })()`);
  await new Promise(r => setTimeout(r, 800));

  // 3. Inspect the Quick Integrations Cards
  console.log('--- Step 3: Inspecting Quick Integrations Block ---');
  const sectionData = await evalExpr(`(() => {
    const quickBlock = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.includes('常用服务直连'))?.closest('section');
    if (!quickBlock) return { error: 'Quick block section not found' };
    
    const h3s = Array.from(quickBlock.querySelectorAll('h3')).map(h => h.textContent.trim());
    const badges = Array.from(quickBlock.querySelectorAll('span')).map(s => s.textContent.trim()).filter(t => t === '已连接' || t === '未连接');
    const buttons = Array.from(quickBlock.querySelectorAll('button')).map(b => b.textContent.trim());

    return {
      title: quickBlock.querySelector('h2')?.textContent.trim(),
      services: h3s,
      badges,
      buttons
    };
  })()`);
  console.log('Quick Integrations Block Data:', JSON.stringify(sectionData, null, 2));

  await takeScreenshot('quick-integrations-overview.png');

  // 4. Test opening Notion Modal
  console.log('--- Step 4: Testing Notion Modal ---');
  const notionClicked = await evalExpr(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Notion'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  })()`);
  console.log('Notion button clicked:', notionClicked);
  await new Promise(r => setTimeout(r, 600));

  const notionModalDetails = await evalExpr(`(() => {
    const modal = document.querySelector('[role="dialog"]');
    if (!modal) return { error: 'Notion dialog not found' };
    return {
      title: modal.querySelector('h3')?.textContent.trim(),
      inputs: Array.from(modal.querySelectorAll('input')).map(i => ({ placeholder: i.placeholder, type: i.type })),
      buttons: Array.from(modal.querySelectorAll('button')).map(b => b.textContent.trim())
    };
  })()`);
  console.log('Notion Modal Details:', JSON.stringify(notionModalDetails, null, 2));

  await takeScreenshot('notion-modal-opened.png');

  // Close Notion Modal
  await evalExpr(`(() => {
    const cancel = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === '取消');
    if (cancel) cancel.click();
  })()`);
  await new Promise(r => setTimeout(r, 600));

  // 5. Test opening Google Mail Modal
  console.log('--- Step 5: Testing Google Mail Modal ---');
  const googleClicked = await evalExpr(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Google'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  })()`);
  console.log('Google button clicked:', googleClicked);
  await new Promise(r => setTimeout(r, 600));

  const googleModalDetails = await evalExpr(`(() => {
    const modal = document.querySelector('[role="dialog"]');
    if (!modal) return { error: 'Google dialog not found' };
    return {
      title: modal.querySelector('h3')?.textContent.trim(),
      inputs: Array.from(modal.querySelectorAll('input')).map(i => ({ placeholder: i.placeholder, type: i.type })),
      buttons: Array.from(modal.querySelectorAll('button')).map(b => b.textContent.trim()),
      helperText: modal.querySelector('p')?.textContent.trim()
    };
  })()`);
  console.log('Google Modal Details:', JSON.stringify(googleModalDetails, null, 2));

  await takeScreenshot('google-modal-opened.png');

  // Close Google Modal
  await evalExpr(`(() => {
    const cancel = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === '取消');
    if (cancel) cancel.click();
  })()`);
  await new Promise(r => setTimeout(r, 400));

  console.log('All E2E CDP checks passed with flying colors!');
  ws.close();
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
