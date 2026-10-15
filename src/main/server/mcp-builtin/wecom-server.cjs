#!/usr/bin/env node
const readline = require('node:readline');

const webhookUrl = process.env.WECOM_WEBHOOK_URL || (process.env.WECOM_KEY ? `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${process.env.WECOM_KEY}` : '');

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handleCall(name, args) {
  if (!webhookUrl) {
    throw new Error('未配置 WECOM_WEBHOOK_URL 或 WECOM_KEY');
  }

  if (name === 'wecom_send_markdown') {
    const content = String(args?.content || '').trim();
    if (!content) throw new Error('content 不能为空');

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { content }
      })
    });
    const data = await res.json();
    if (data.errcode !== 0) {
      throw new Error(`企业微信发送失败 (${data.errcode}): ${data.errmsg}`);
    }
    return { content: [{ type: 'text', text: '企业微信 Markdown 消息已成功推送' }] };
  }

  if (name === 'wecom_send_text') {
    const content = String(args?.content || '').trim();
    if (!content) throw new Error('content 不能为空');

    const payload = {
      msgtype: 'text',
      text: {
        content,
        mentioned_list: Array.isArray(args?.mentioned_list) ? args.mentioned_list : undefined,
        mentioned_mobile_list: Array.isArray(args?.mentioned_mobile_list) ? args.mentioned_mobile_list : undefined
      }
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.errcode !== 0) {
      throw new Error(`企业微信发送失败 (${data.errcode}): ${data.errmsg}`);
    }
    return { content: [{ type: 'text', text: '企业微信文本消息已成功推送' }] };
  }

  throw new Error(`未知工具: ${name}`);
}

const TOOLS = [
  {
    name: 'wecom_send_markdown',
    description: '向企业微信群机器人推送 Markdown 格式消息（支持标题、粗体、代码块、链接、引用、列表及颜色字体）',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Markdown 消息内容' }
      },
      required: ['content']
    }
  },
  {
    name: 'wecom_send_text',
    description: '向企业微信群机器人推送纯文本消息，支持 @群成员 或 @所有人',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '纯文本消息内容' },
        mentioned_list: { type: 'array', items: { type: 'string' }, description: '需要 @ 的用户 ID 列表，[\"@all\"] 代表所有人' },
        mentioned_mobile_list: { type: 'array', items: { type: 'string' }, description: '需要 @ 的手机号列表' }
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
        serverInfo: { name: 'reizo-wecom', version: '1.0.0' }
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
