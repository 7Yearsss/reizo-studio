#!/usr/bin/env node
const readline = require('node:readline');

const token = process.env.YUQUE_TOKEN || '';
const host = (process.env.YUQUE_HOST || 'https://www.yuque.com/api/v2').replace(/\/+$/, '');

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function yuqueFetch(apiPath, options = {}) {
  if (!token) throw new Error('未配置 YUQUE_TOKEN 语雀访问密钥');
  const url = `${host}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'X-Auth-Token': token,
      'User-Agent': 'ReizoStudio/0.1.0',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `语雀 API 错误 (${res.status})`);
  }
  return data.data;
}

async function handleCall(name, args) {
  if (name === 'yuque_get_user') {
    const user = await yuqueFetch('/user');
    return {
      content: [{ type: 'text', text: JSON.stringify(user, null, 2) }]
    };
  }

  if (name === 'yuque_list_repos') {
    const user = args?.user ? String(args.user).trim() : null;
    const endpoint = user ? `/users/${encodeURIComponent(user)}/repos` : '/user/repos';
    const repos = await yuqueFetch(endpoint);
    const list = Array.isArray(repos)
      ? repos.map(r => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          namespace: r.namespace,
          description: r.description,
          items_count: r.items_count,
          public: r.public
        }))
      : repos;
    return {
      content: [{ type: 'text', text: JSON.stringify(list, null, 2) }]
    };
  }

  if (name === 'yuque_search_docs') {
    const q = String(args?.query || '').trim();
    if (!q) throw new Error('query 搜索关键字不能为空');
    const docs = await yuqueFetch(`/search?type=doc&q=${encodeURIComponent(q)}`);
    return {
      content: [{ type: 'text', text: JSON.stringify(docs, null, 2) }]
    };
  }

  if (name === 'yuque_get_doc') {
    const repo = String(args?.repo || '').trim();
    const id = String(args?.id || '').trim();
    if (!repo || !id) throw new Error('repo 和 id 参数不能为空');
    const doc = await yuqueFetch(`/repos/${encodeURIComponent(repo)}/docs/${encodeURIComponent(id)}`);
    return {
      content: [
        {
          type: 'text',
          text: `# ${doc.title}\n\n${doc.body || doc.body_draft || '(空内容)'}`
        }
      ]
    };
  }

  if (name === 'yuque_create_doc') {
    const repo = String(args?.repo || '').trim();
    const title = String(args?.title || '').trim();
    const body = String(args?.body || '').trim();
    if (!repo || !title) throw new Error('repo 和 title 不能为空');

    const created = await yuqueFetch(`/repos/${encodeURIComponent(repo)}/docs`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        body,
        format: 'markdown'
      })
    });
    return {
      content: [
        {
          type: 'text',
          text: `语雀文档创建成功: ${created.title} (ID: ${created.id}, Slug: ${created.slug})`
        }
      ]
    };
  }

  throw new Error(`未知工具: ${name}`);
}

const TOOLS = [
  {
    name: 'yuque_get_user',
    description: '获取当前语雀认证用户的个人信息与账号空间',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'yuque_list_repos',
    description: '列出当前用户或指定团队下的所有语雀知识库 (Repos)',
    inputSchema: {
      type: 'object',
      properties: {
        user: { type: 'string', description: '团队 namespace 或用户 login；留空则获取自身知识库' }
      }
    }
  },
  {
    name: 'yuque_search_docs',
    description: '在语雀知识库中全局搜索相关文档',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' }
      },
      required: ['query']
    }
  },
  {
    name: 'yuque_get_doc',
    description: '根据知识库路径(namespace/repo)与文档 ID/slug 读取文档 Markdown 详情正文',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '知识库 namespace 或 ID，例如 \"my-team/wiki\"' },
        id: { type: 'string', description: '文档 ID 或 slug' }
      },
      required: ['repo', 'id']
    }
  },
  {
    name: 'yuque_create_doc',
    description: '在指定的语雀知识库中创建一篇 Markdown 格式新文档',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '知识库 namespace 或 ID' },
        title: { type: 'string', description: '文档标题' },
        body: { type: 'string', description: '文档正文内容 (Markdown)' }
      },
      required: ['repo', 'title', 'body']
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
        serverInfo: { name: 'reizo-yuque', version: '1.0.0' }
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
