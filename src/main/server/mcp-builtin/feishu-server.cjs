#!/usr/bin/env node
const readline = require('node:readline');

const appId = process.env.FEISHU_APP_ID || '';
const appSecret = process.env.FEISHU_APP_SECRET || '';

let cachedToken = null;
let tokenExpireAt = 0;

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function getTenantToken() {
  if (!appId || !appSecret) {
    throw new Error('未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET');
  }
  if (cachedToken && Date.now() < tokenExpireAt - 60_000) {
    return cachedToken;
  }

  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });

  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`飞书鉴权失败 (${data.code}): ${data.msg}`);
  }

  cachedToken = data.tenant_access_token;
  tokenExpireAt = Date.now() + (data.expire || 7200) * 1000;
  return cachedToken;
}

async function feishuFetch(url, options = {}) {
  const token = await getTenantToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`飞书 API 错误 (${data.code}): ${data.msg}`);
  }
  return data.data;
}

async function handleCall(name, args) {
  if (name === 'feishu_get_bot_info') {
    const info = await feishuFetch('https://open.feishu.cn/open-apis/bot/v3/info', { method: 'GET' });
    return {
      content: [{ type: 'text', text: JSON.stringify(info, null, 2) }]
    };
  }

  if (name === 'feishu_send_message') {
    const receiveIdType = args?.receive_id_type || 'chat_id';
    const receiveId = String(args?.receive_id || '').trim();
    const content = String(args?.content || '').trim();
    if (!receiveId || !content) throw new Error('receive_id 和 content 不能为空');

    const msgBody = {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text: content })
    };

    const res = await feishuFetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`, {
      method: 'POST',
      body: JSON.stringify(msgBody)
    });

    return {
      content: [{ type: 'text', text: `飞书消息已发送，消息 ID: ${res?.message_id || 'ok'}` }]
    };
  }

  if (name === 'feishu_get_bitable_records') {
    const appToken = String(args?.app_token || '').trim();
    const tableId = String(args?.table_id || '').trim();
    const pageSize = args?.page_size ? Number(args.page_size) : 20;
    if (!appToken || !tableId) throw new Error('app_token 和 table_id 不能为空');

    const data = await feishuFetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?page_size=${pageSize}`, {
      method: 'GET'
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(data?.items || [], null, 2) }]
    };
  }

  throw new Error(`未知工具: ${name}`);
}

const TOOLS = [
  {
    name: 'feishu_get_bot_info',
    description: '获取当前飞书应用助手的机器人的名称、状态与权限信息',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'feishu_send_message',
    description: '向指定的飞书群聊 (chat_id) 或用户 (open_id / email) 发送文本通知消息',
    inputSchema: {
      type: 'object',
      properties: {
        receive_id_type: { type: 'string', enum: ['chat_id', 'open_id', 'user_id', 'email'], default: 'chat_id', description: '接收者 ID 类型' },
        receive_id: { type: 'string', description: '群聊 chat_id（例如 oc_...）或用户 ID' },
        content: { type: 'string', description: '发送的文本正文' }
      },
      required: ['receive_id', 'content']
    }
  },
  {
    name: 'feishu_get_bitable_records',
    description: '读取飞书多维表格 (Bitable) 指定子数据表的数据行记录',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: '多维表格应用凭证 app_token' },
        table_id: { type: 'string', description: '子数据表 table_id（例如 tbl...）' },
        page_size: { type: 'number', description: '获取条数，默认 20' }
      },
      required: ['app_token', 'table_id']
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
        serverInfo: { name: 'reizo-feishu', version: '1.0.0' }
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
