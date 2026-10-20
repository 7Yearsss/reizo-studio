#!/usr/bin/env node
const readline = require('node:readline');

const token = process.env.GITHUB_TOKEN || '';
const host = 'https://api.github.com';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function githubFetch(apiPath, options = {}) {
  if (!token) throw new Error('未配置 GITHUB_TOKEN GitHub Personal Access Token');
  const url = `${host}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
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
    const errMsg = (typeof data === 'object' && data?.message) || `GitHub API 错误 (${res.status})`;
    throw new Error(errMsg);
  }
  return data;
}

async function handleCall(name, args) {
  if (name === 'github_get_user') {
    const user = await githubFetch('/user');
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

  if (name === 'github_list_repos') {
    const sort = args?.sort ? String(args.sort).trim() : 'updated';
    const repos = await githubFetch(`/user/repos?sort=${encodeURIComponent(sort)}&per_page=20`);
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

  if (name === 'github_get_file') {
    const owner = String(args?.owner || '').trim();
    const repo = String(args?.repo || '').trim();
    const path = String(args?.path || '').replace(/^\/+/, '').trim();
    const ref = args?.ref ? String(args.ref).trim() : 'main';

    if (!owner || !repo || !path) {
      throw new Error('参数 owner, repo 和 path 为必填项');
    }

    const data = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`);
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

  if (name === 'github_search_issues') {
    const query = String(args?.query || '').trim();
    if (!query) throw new Error('参数 query 为必填项');
    const data = await githubFetch(`/search/issues?q=${encodeURIComponent(query)}&per_page=15`);
    const list = Array.isArray(data?.items)
      ? data.items.map(i => ({
          number: i.number,
          title: i.title,
          state: i.state,
          html_url: i.html_url,
          created_at: i.created_at,
          user: i.user?.login
        }))
      : data;
    return {
      content: [{ type: 'text', text: JSON.stringify(list, null, 2) }]
    };
  }

  if (name === 'github_create_issue') {
    const owner = String(args?.owner || '').trim();
    const repo = String(args?.repo || '').trim();
    const title = String(args?.title || '').trim();
    const body = String(args?.body || '').trim();

    if (!owner || !repo || !title) {
      throw new Error('参数 owner, repo 和 title 为必填项');
    }

    const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
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
    name: 'github_get_user',
    description: '获取当前 GitHub 授权用户的个人基础信息及仓库统计',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'github_list_repos',
    description: '列出当前 GitHub 用户的代码仓库列表',
    inputSchema: {
      type: 'object',
      properties: {
        sort: { type: 'string', description: '排序方式：updated, created, pushed, full_name', default: 'updated' }
      }
    }
  },
  {
    name: 'github_get_file',
    description: '读取 GitHub 代码仓库中指定路径的文件源码内容',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: '仓库拥有者或组织 (例如 "facebook")' },
        repo: { type: 'string', description: '仓库名称 (例如 "react")' },
        path: { type: 'string', description: '文件相对路径 (例如 "package.json")' },
        ref: { type: 'string', description: '分支名称或 commit sha，默认 main', default: 'main' }
      },
      required: ['owner', 'repo', 'path']
    }
  },
  {
    name: 'github_search_issues',
    description: '通过关键词搜索 GitHub Issues 与 Pull Requests',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词或过滤语法 (例如 "is:open is:issue repo:owner/name bug")' }
      },
      required: ['query']
    }
  },
  {
    name: 'github_create_issue',
    description: '在指定的 GitHub 仓库中创建新 Issue',
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
          serverInfo: { name: 'reizo-builtin-github', version: '0.1.0' }
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
