#!/usr/bin/env node
const crypto = require('node:crypto');
const readline = require('node:readline');

const webhookBase = process.env.DINGTALK_WEBHOOK_URL || '';
const secret = process.env.DINGTALK_SECRET || '';

function getSignedUrl() {
  if (!webhookBase) return '';
  if (!secret) return webhookBase;

  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64');
  const encodedSign = encodeURIComponent(sign);
  const sep = webhookBase.includes('?') ? '&' : '?';
  return `${webhookBase}${sep}timestamp=${timestamp}&sign=${encodedSign}`;
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handleCall(name, args) {
  const url = getSignedUrl();
  if (!url) {
    throw new Error('未配置 DINGTALK_WEBHOOK_URL');
  }

  if (name === 'dingtalk_send_markdown') {
    const title = String(args?.title || 'Reizo 消息通知').trim();
    const text = String(args?.text || '').trim();
    if (!text) throw new Error('text 不能为空');

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { title, text },
        at: { isAtAll: Boolean(args?.atAll) }
      })
    });
    const data = await res.json();
    if (data.errcode !== 0) {
      throw new Error(`钉钉发送失败 (${data.errcode}): ${data.errmsg}`);
    }
    return { content: [{ type: 'text', text: '钉钉 Markdown 消息已成功推送' }] };
  }

  if (name === 'dingtalk_send_text') {
    const content = String(args?.content || '').trim();
    if (!content) throw new Error('content 不能为空');

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: { content },
        at: { isAtAll: Boolean(args?.atAll) }
      })
    });
    const data = await res.json();
    if (data.errcode !== 0) {
      throw new Error(`钉钉发送失败 (${data.errcode}): ${data.errmsg}`);
    }
    return { content: [{ type: 'text', text: '钉钉纯文本消息已成功推送' }] };
  }

  throw new Error(`未知工具: ${name}`);
}

const TOOLS = [
  {
    name: 'dingtalk_send_markdown',
    description: '向钉钉自定义群机器人推送 Markdown 消息（支持标题、文字、图片、列表等格式）',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '首屏通知提示标题' },
        text: { type: 'string', description: 'Markdown 格式正文' },
        atAll: { type: 'boolean', description: '是否 @全员' }
      },
      required: ['title', 'text']
    }
  },
  {
    name: 'dingtalk_send_text',
    description: '向钉钉自定义群机器人推送纯文本消息',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '纯文本消息内容' },
        atAll: { type: 'boolean', description: '是否 @全员' }
      },
      required: ['content']
    }
  }
];

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return;

  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'reizo-dingtalk', version: '1.0.0' }
      }
    });
  } else if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { tools: TOOLS }
    });
  } else if (msg.method === 'tools/call') {
    try {
      const res = await handleCall(msg.params?.name, msg.params?.arguments);
      send({ jsonrpc: '2.0', id: msg.id, result: res });
    } catch (err) {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: `调用失败: ${err.message}` }],
          isError: true
        }
      });
    }
  } else {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
});
