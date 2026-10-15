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

  console.log('Triggering Page.reload to ensure clean render...');
  await cdp('Page.enable');
  await cdp('Page.reload');
  await new Promise(r => setTimeout(r, 2000));


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

  const expectedKeys = ['feishu', 'wecom', 'dingtalk', 'yuque', 'notion', 'gmail'];
  for (const k of expectedKeys) {
    if (!status || typeof status[k]?.connected !== 'boolean') {
      throw new Error(`Missing expected status key ${k} in ` + JSON.stringify(status));
    }
  }

  // 2. Ensure we are on Settings -> Extensions view
  console.log('--- Step 2: Ensuring Settings -> Extensions view ---');
  
  // First ensure mode is settings by clicking sidebar Settings button
  await evalExpr(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const settingsBtn = btns.find(b => b.textContent && b.textContent.includes('设置'));
    if (settingsBtn) {
      settingsBtn.click();
    }
  })()`);

  // Wait for Settings nav to appear and click Extensions
  console.log('Waiting for Settings navigation to mount...');
  let navFound = false;
  for (let i = 0; i < 20; i++) {
    navFound = await evalExpr(`(() => {
      const extNav = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent && b.textContent.includes('扩展'));
      if (extNav) {
        extNav.click();
        return true;
      }
      return false;
    })()`);
    if (navFound) break;
    await new Promise(r => setTimeout(r, 400));
  }
  console.log('Extensions nav clicked:', navFound);

  // Wait for Quick block section to appear
  console.log('Waiting for Quick Integrations block to render...');
  for (let i = 0; i < 20; i++) {
    const hasBlock = await evalExpr(`(() => {
      return Boolean(Array.from(document.querySelectorAll('h2')).find(h => h.textContent.includes('常用服务直连')));
    })()`);
    if (hasBlock) {
      console.log('Quick Integrations block found!');
      break;
    }
    await new Promise(r => setTimeout(r, 400));
  }


  // 3. Inspect All 6 Services in the Quick Integrations Block
  console.log('--- Step 3: Inspecting Quick Integrations Block with Domestic Services ---');
  const sectionData = await evalExpr(`(() => {
    const quickBlock = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.includes('常用服务直连'))?.closest('section');
    if (!quickBlock) return { error: 'Quick block section not found' };
    
    const tabs = Array.from(quickBlock.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t.includes('全部') || t.includes('国内') || t.includes('海外'));
    const cards = Array.from(quickBlock.querySelectorAll('h3')).map(h => h.textContent.trim());
    const buttons = Array.from(quickBlock.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t.includes('连接') || t.includes('配置') || t.includes('授权'));

    return {
      title: quickBlock.querySelector('h2')?.textContent.trim(),
      tabs,
      cards,
      actionButtons: buttons
    };
  })()`);
  console.log('Quick Integrations Overview Data:', JSON.stringify(sectionData, null, 2));

  await takeScreenshot('quick-integrations-all-services.png');

  // Test Domestic Tab Filter
  console.log('--- Testing Domestic Tab Filter ---');
  await evalExpr(`(() => {
    const qb = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.includes('常用服务直连'))?.closest('section');
    const btn = Array.from(qb.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('国内办公'));
    if (btn) btn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  await takeScreenshot('quick-integrations-domestic-tab.png');

  // Switch back to All
  await evalExpr(`(() => {
    const qb = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.includes('常用服务直连'))?.closest('section');
    const btn = Array.from(qb.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('全部 ('));
    if (btn) btn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));

  async function openAndVerifyModal(cardButtonText, modalTitleSubstr, screenshotName) {
    console.log(`--- Testing Modal for ${cardButtonText} ---`);
    await evalExpr(`(() => {
      const qb = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.includes('常用服务直连'))?.closest('section');
      if (!qb) throw new Error('Quick block not found');
      const btn = Array.from(qb.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('${cardButtonText}'));
      if (!btn) throw new Error('Card button for ${cardButtonText} not found');
      btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    const modalFound = await evalExpr(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      return dialog.textContent.includes('${modalTitleSubstr}');
    })()`);
    if (!modalFound) {
      throw new Error('Modal with title "${modalTitleSubstr}" was not found open!');
    }

    await takeScreenshot(screenshotName);

    await evalExpr(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        const cancelBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === '取消');
        if (cancelBtn) cancelBtn.click();
      }
    })()`);
    await new Promise(r => setTimeout(r, 500));
  }

  // 4. Test Feishu Modal
  await openAndVerifyModal('一键连接飞书', '飞书', 'feishu-modal-opened.png');

  // 5. Test WeCom Modal
  await openAndVerifyModal('配置企微机器人', '企业微信', 'wecom-modal-opened.png');

  // 6. Test DingTalk Modal
  await openAndVerifyModal('配置钉钉机器人', '钉钉', 'dingtalk-modal-opened.png');

  // 7. Test Yuque Modal
  await openAndVerifyModal('一键连接语雀', '语雀', 'yuque-modal-opened.png');

  console.log('All domestic and international quick integration E2E checks passed!');
  ws.close();

}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
