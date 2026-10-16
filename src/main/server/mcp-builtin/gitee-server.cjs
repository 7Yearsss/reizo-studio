#!/usr/bin/env node
const readline = require('node:readline');

const token = process.env.GITEE_TOKEN || '';
const host = 'https://gitee.com/api/v5';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function giteeFetch(apiPath, options = {}) {
  if (!token) throw new Error('未配置 GITEE_TOKEN 码云访问密钥');
  const sep = apiPath.includes('?') ? '&' : '?';
  const url = `${host}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}${sep}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'ReizoStudio/0.1.0',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    const errMsg = (typeof data === 'object' && data?.message) || `Gitee API 错误 (${res.status})`;
    throw new Error(errMsg);
  }
  return data;
}

async function handleCall(name, args) {
  if (name === 'gitee_get_user') {
    const user = await giteeFetch('/user');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          id: user.id,
          login: user.login,
          name: user.name,
          email: user.email,
          html_url: user.html_url,
          public_repos: user.public_repos,
          total_private_repos: user.total_private_repos
        }, null, 2)
      }]
    };
  }

  if (name === 'gitee_list_repos') {
    const type = args?.type ? String(args.type).trim() : 'all';
    const repos = await giteeFetch(`/user/repos?type=${encodeURIComponent(type)}&sort=updated&per_page=20`);
    const list = Array.isArray(repos)
      ? repos.map(r => ({
          name: r.name,
          full_name: r.full_name,
          description: r.description,
          html_url: r.html_url,
          private: r.private,
          fork: r.fork,
          updated_at: r.updated_at
        }))
      : repos;
    return {
      content: [{ type: 'text', text: JSON.stringify(list, null, 2) }]
    };
  }

  if (name === 'gitee_get_file') {
    const owner = String(args?.owner || '').trim();
    const repo = String(args?.repo || '').trim();
    const path = String(args?.path || '').replace(/^\/+/, '').trim();
    const ref = args?.ref ? String(args.ref).trim() : 'master';

    if (!owner || !repo || !path) {
      throw new Error('参数 owner, repo 和 path 为必填项');
    }

    const data = await giteeFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`);
    let content = data.content;
    if (data.encoding === 'base64' && content) {
      content = Buffer.from(content, 'base64').toString('utf-8');
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          name: data.name,
          path: data.path,
          sha: data.sha,
          size: data.size,
          content
        }, null, 2)
      }]
    };
  }

  if (name === 'gitee_search_issues') {
    const state = args?.state ? String(args.state).trim() : 'all';
    const filter = args?.filter ? String(args.filter).trim() : 'created';
    const issues = await giteeFetch(`/user/issues?state=${encodeURIComponent(state)}&filter=${encodeURIComponent(filter)}&sort=updated&per_page=15`);
    const list = Array.isArray(issues)
      ? issues.map(i => ({
          number: i.number,
          title: i.title,
          state: i.state,
          html_url: i.html_url,
          created_at: i.created_at,
          repository: i.repository?.full_name
        }))
      : issues;
    return {
      content: [{ type: 'text', text: JSON.stringify(list, null, 2) }]
    };
  }

  if (name === 'gitee_create_issue') {
    const owner = String(args?.owner || '').trim();
    const repo = String(args?.repo || '').trim();
    const title = String(args?.title || '').trim();
    const body = String(args?.body || '').trim();

    if (!owner || !repo || !title) {
      throw new Error('参数 owner, repo 和 title 为必填项');
    }

    const res = await giteeFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        body
      })
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          number: res.number,
          title: res.title,
          state: res.state,
          html_url: res.html_url,
          created_at: res.created_at
        }, null, 2)
      }]
    };
  }

  throw new Error(`未知工具调用: ${name}`);
}

const TOOLS = [
  {
    name: 'gitee_get_user',
    description: '获取当前 Gitee (码云) 授权用户的个人基础信息及仓库统计',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'gitee_list_repos',
    description: '列出当前 Gitee 用户的代码仓库列表（支持筛选所有、拥有或所属协作仓库）',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '仓库类型：all(全部), owner(自己创建), member(协作), public(公开), private(私有)', default: 'all' }
      }
    }
  },
  {
    name: 'gitee_get_file',
    description: '读取 Gitee 代码仓库中指定路径的文件源码内容',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: '仓库拥有者或组织命名空间 (例如 "oschina")' },
        repo: { type: 'string', description: '仓库名称 (例如 "git-osc")' },
        path: { type: 'string', description: '文件在仓库内的相对路径 (例如 "README.md" 或 "src/index.js")' },
        ref: { type: 'string', description: '分支名称或 commit sha，默认 master', default: 'master' }
      },
      required: ['owner', 'repo', 'path']
    }
  },
  {
    name: 'gitee_search_issues',
    description: '检索当前用户的 Gitee 任务 / Issue 列表',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'Issue 状态：open, progressing, closed, rejected, all', default: 'all' },
        filter: { type: 'string', description: '筛选维度：assigned(指派给我), created(我创建的), all(所有)', default: 'created' }
      }
    }
  },
  {
    name: 'gitee_create_issue',
    description: '在指定的 Gitee 仓库中新建一个 Issue 任务或 Bug 反馈',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: '仓库拥有者或组织' },
        repo: { type: 'string', description: '仓库名称' },
        title: { type: 'string', description: 'Issue 标题' },
        body: { type: 'string', description: 'Issue 详细说明内容 (支持 Markdown 格式)' }
      },
      required: ['owner', 'repo', 'title']
    }
  }
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    const { id, method, params } = req;

    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'reizo-builtin-gitee', version: '0.1.0' }
        }
      });
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS }
      });
      return;
    }

    if (method === 'tools/call') {
      const { name, arguments: callArgs } = params || {};
      const res = await handleCall(name, callArgs);
      send({
        jsonrpc: '2.0',
        id,
        result: res
      });
      return;
    }

    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    });
  } catch (err) {
    send({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32603, message: err.message || String(err) }
    });
  }
});
