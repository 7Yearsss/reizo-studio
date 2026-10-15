import crypto from 'node:crypto';
import fs from 'node:fs';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { shell } from 'electron';
import type {
  DingTalkConnectParams,
  FeishuConnectParams,
  GiteeConnectParams,
  GitHubConnectParams,
  GoogleOAuthParams,
  IntegrationConnectResult,
  McpServerEntry,
  QuickIntegrationId,
  QuickIntegrationsStatus,
  WeComConnectParams,
  YuqueConnectParams,
} from '../../../shared/extensionConfig';

import { readMcpEntries, testMcpEntry, writeMcpEntries } from '../plugins/extensionConfig';
import { closeAllMcpSessions } from '../agent/mcpTools';

export function isNotionEntry(e: McpServerEntry): boolean {
  return e.name === 'notion' || e.url === 'https://mcp.notion.com/mcp' || /notion/i.test(e.command ?? '');
}

export function isGmailEntry(e: McpServerEntry): boolean {
  return (
    e.name === 'gmail' ||
    e.name === 'google-gmail' ||
    /gmail/i.test(e.command ?? '') ||
    (e.args ?? []).some((a) => /gmail/i.test(a))
  );
}

export function isFeishuEntry(e: McpServerEntry): boolean {
  return (
    e.name === 'feishu' ||
    /feishu|lark/i.test(e.command ?? '') ||
    (e.args ?? []).some((a) => /feishu|lark/i.test(a)) ||
    Boolean(e.env?.FEISHU_APP_ID)
  );
}

export function isWeComEntry(e: McpServerEntry): boolean {
  return (
    e.name === 'wecom' ||
    /wecom/i.test(e.command ?? '') ||
    (e.args ?? []).some((a) => /wecom/i.test(a)) ||
    Boolean(e.env?.WECOM_WEBHOOK_URL || e.env?.WECOM_KEY)
  );
}

export function isDingTalkEntry(e: McpServerEntry): boolean {
  return (
    e.name === 'dingtalk' ||
    /dingtalk/i.test(e.command ?? '') ||
    (e.args ?? []).some((a) => /dingtalk/i.test(a)) ||
    Boolean(e.env?.DINGTALK_WEBHOOK_URL)
  );
}

export function isYuqueEntry(e: McpServerEntry): boolean {
  return (
    e.name === 'yuque' ||
    /yuque/i.test(e.command ?? '') ||
    (e.args ?? []).some((a) => /yuque/i.test(a)) ||
    Boolean(e.env?.YUQUE_TOKEN)
  );
}

export function isGiteeEntry(e: McpServerEntry): boolean {
  return (
    e.name === 'gitee' ||
    /gitee/i.test(e.command ?? '') ||
    (e.args ?? []).some((a) => /gitee/i.test(a)) ||
    Boolean(e.env?.GITEE_TOKEN)
  );
}

export function isGitHubEntry(e: McpServerEntry): boolean {
  return (
    e.name === 'github' ||
    /github/i.test(e.command ?? '') ||
    (e.args ?? []).some((a) => /github/i.test(a)) ||
    Boolean(e.env?.GITHUB_TOKEN)
  );
}

export function getBuiltinMcpScript(scriptName: string): string {
  const candidates = [
    path.resolve(__dirname, 'mcp-builtin', scriptName),
    path.resolve(__dirname, '../server/mcp-builtin', scriptName),
    path.resolve(__dirname, '../../src/main/server/mcp-builtin', scriptName),
    path.resolve(process.cwd(), 'src/main/server/mcp-builtin', scriptName),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

export async function getQuickIntegrationsStatus(dataRoot: string): Promise<QuickIntegrationsStatus> {
  const entries = await readMcpEntries(dataRoot);
  const notion = entries.find((e) => isNotionEntry(e) && !e.disabled);
  const gmail = entries.find((e) => isGmailEntry(e) && !e.disabled);
  const feishu = entries.find((e) => isFeishuEntry(e) && !e.disabled);
  const wecom = entries.find((e) => isWeComEntry(e) && !e.disabled);
  const dingtalk = entries.find((e) => isDingTalkEntry(e) && !e.disabled);
  const yuque = entries.find((e) => isYuqueEntry(e) && !e.disabled);
  const gitee = entries.find((e) => isGiteeEntry(e) && !e.disabled);
  const github = entries.find((e) => isGitHubEntry(e) && !e.disabled);

  return {
    notion: {
      connected: Boolean(notion),
      ...(notion ? { serverName: notion.name } : {}),
    },
    gmail: {
      connected: Boolean(gmail),
      ...(gmail ? { serverName: gmail.name, email: gmail.env?.GOOGLE_GMAIL_USER_EMAIL } : {}),
    },
    feishu: {
      connected: Boolean(feishu),
      ...(feishu ? { serverName: feishu.name, appName: feishu.env?.FEISHU_APP_NAME, appId: feishu.env?.FEISHU_APP_ID } : {}),
    },
    wecom: {
      connected: Boolean(wecom),
      ...(wecom ? { serverName: wecom.name, botName: wecom.env?.WECOM_BOT_NAME } : {}),
    },
    dingtalk: {
      connected: Boolean(dingtalk),
      ...(dingtalk ? { serverName: dingtalk.name, botName: dingtalk.env?.DINGTALK_BOT_NAME } : {}),
    },
    yuque: {
      connected: Boolean(yuque),
      ...(yuque ? { serverName: yuque.name, userName: yuque.env?.YUQUE_USER_NAME } : {}),
    },
    gitee: {
      connected: Boolean(gitee),
      ...(gitee ? { serverName: gitee.name, userName: gitee.env?.GITEE_USER_NAME, login: gitee.env?.GITEE_USER_LOGIN } : {}),
    },
    github: {
      connected: Boolean(github),
      ...(github ? { serverName: github.name, userName: github.env?.GITHUB_USER_NAME, login: github.env?.GITHUB_USER_LOGIN } : {}),
    },
  };
}


export async function connectNotionIntegration(
  dataRoot: string,
  token: string,
): Promise<IntegrationConnectResult> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    return { ok: false, error: 'Token 不能为空，请输入有效的 Notion Integration Token。' };
  }

  const entry: McpServerEntry = {
    name: 'notion',
    transport: 'http',
    url: 'https://mcp.notion.com/mcp',
    headers: {
      Authorization: `Bearer ${cleanToken}`,
    },
  };

  const test = await testMcpEntry(dataRoot, entry);
  if (!test.ok && test.tools.length === 0) {
    return {
      ok: false,
      error: test.messages.join('； ') || '无法连接 Notion 官方服务，请检查 Token 权限或网络配置。',
    };
  }

  const existing = await readMcpEntries(dataRoot);
  const filtered = existing.filter((e) => !isNotionEntry(e));
  filtered.push(entry);

  await writeMcpEntries(dataRoot, filtered);
  await closeAllMcpSessions();

  return {
    ok: true,
    toolsCount: test.tools.length,
  };
}

export async function connectFeishuIntegration(
  dataRoot: string,
  params: FeishuConnectParams,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<IntegrationConnectResult> {
  const appId = params.appId.trim();
  const appSecret = params.appSecret.trim();
  if (!appId || !appSecret) {
    return { ok: false, error: '飞书 App ID 和 App Secret 不能为空。' };
  }

  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  try {
    const tokenRes = await fetchFn('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const tokenData = (await tokenRes.json()) as { code: number; msg?: string; tenant_access_token?: string };
    if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
      return { ok: false, error: `飞书应用鉴权失败 (${tokenData.code}): ${tokenData.msg || 'App ID 或 App Secret 无效'}` };
    }

    let botName = '飞书协同助手';
    try {
      const botRes = await fetchFn('https://open.feishu.cn/open-apis/bot/v3/info', {
        headers: { Authorization: `Bearer ${tokenData.tenant_access_token}` },
      });
      const botData = (await botRes.json()) as { code: number; bot?: { app_name?: string } };
      if (botData.code === 0 && botData.bot?.app_name) {
        botName = botData.bot.app_name;
      }
    } catch {
      // Bot info is optional enhancement
    }

    const script = getBuiltinMcpScript('feishu-server.cjs');
    const entry: McpServerEntry = {
      name: 'feishu',
      transport: 'stdio',
      command: process.execPath,
      args: [script],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        FEISHU_APP_ID: appId,
        FEISHU_APP_SECRET: appSecret,
        FEISHU_APP_NAME: botName,
      },
    };

    const test = await testMcpEntry(dataRoot, entry);
    const existing = await readMcpEntries(dataRoot);
    const filtered = existing.filter((e) => !isFeishuEntry(e));
    filtered.push(entry);

    await writeMcpEntries(dataRoot, filtered);
    await closeAllMcpSessions();

    return {
      ok: true,
      name: botName,
      toolsCount: test.tools.length,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `连接飞书服务时发生异常: ${message}` };
  }
}

export async function connectWeComIntegration(
  dataRoot: string,
  params: WeComConnectParams,
): Promise<IntegrationConnectResult> {
  let raw = params.webhookUrl.trim();
  if (!raw) {
    return { ok: false, error: '企业微信机器人 Webhook 地址或 Key 不能为空。' };
  }
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    raw = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${raw}`;
  }
  if (!raw.includes('qyapi.weixin.qq.com/cgi-bin/webhook/send?key=')) {
    return { ok: false, error: '无效的企业微信 Webhook 地址，格式应为 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...' };
  }

  const botName = params.botName?.trim() || '企微群机器人';
  const script = getBuiltinMcpScript('wecom-server.cjs');
  const entry: McpServerEntry = {
    name: 'wecom',
    transport: 'stdio',
    command: process.execPath,
    args: [script],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      WECOM_WEBHOOK_URL: raw,
      WECOM_BOT_NAME: botName,
    },
  };

  const test = await testMcpEntry(dataRoot, entry);
  const existing = await readMcpEntries(dataRoot);
  const filtered = existing.filter((e) => !isWeComEntry(e));
  filtered.push(entry);

  await writeMcpEntries(dataRoot, filtered);
  await closeAllMcpSessions();

  return {
    ok: true,
    name: botName,
    toolsCount: test.tools.length,
  };
}

export async function connectDingTalkIntegration(
  dataRoot: string,
  params: DingTalkConnectParams,
): Promise<IntegrationConnectResult> {
  let raw = params.webhookUrl.trim();
  if (!raw) {
    return { ok: false, error: '钉钉机器人 Webhook 地址或 Token 不能为空。' };
  }
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    raw = `https://oapi.dingtalk.com/robot/send?access_token=${raw}`;
  }
  if (!raw.includes('oapi.dingtalk.com/robot/send?access_token=')) {
    return { ok: false, error: '无效的钉钉 Webhook 地址，格式应为 https://oapi.dingtalk.com/robot/send?access_token=...' };
  }

  const botName = params.botName?.trim() || '钉钉群机器人';
  const script = getBuiltinMcpScript('dingtalk-server.cjs');
  const entry: McpServerEntry = {
    name: 'dingtalk',
    transport: 'stdio',
    command: process.execPath,
    args: [script],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      DINGTALK_WEBHOOK_URL: raw,
      DINGTALK_SECRET: params.secret?.trim() || '',
      DINGTALK_BOT_NAME: botName,
    },
  };

  const test = await testMcpEntry(dataRoot, entry);
  const existing = await readMcpEntries(dataRoot);
  const filtered = existing.filter((e) => !isDingTalkEntry(e));
  filtered.push(entry);

  await writeMcpEntries(dataRoot, filtered);
  await closeAllMcpSessions();

  return {
    ok: true,
    name: botName,
    toolsCount: test.tools.length,
  };
}

export async function connectYuqueIntegration(
  dataRoot: string,
  params: YuqueConnectParams,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<IntegrationConnectResult> {
  const token = params.token.trim();
  if (!token) {
    return { ok: false, error: '语雀个人访问令牌 (Token) 不能为空。' };
  }

  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  try {
    const userRes = await fetchFn('https://www.yuque.com/api/v2/user', {
      headers: {
        'X-Auth-Token': token,
        'User-Agent': 'ReizoStudio/0.1.0',
      },
    });
    if (!userRes.ok) {
      return { ok: false, error: `语雀 Token 校验失败 (${userRes.status}): 请确认 Token 是否正确且具有权限。` };
    }
    const userData = (await userRes.json()) as { data?: { name?: string; login?: string } };
    const userName = userData.data?.name || userData.data?.login || '语雀用户';

    const script = getBuiltinMcpScript('yuque-server.cjs');
    const entry: McpServerEntry = {
      name: 'yuque',
      transport: 'stdio',
      command: process.execPath,
      args: [script],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        YUQUE_TOKEN: token,
        YUQUE_USER_NAME: userName,
      },
    };

    const test = await testMcpEntry(dataRoot, entry);
    const existing = await readMcpEntries(dataRoot);
    const filtered = existing.filter((e) => !isYuqueEntry(e));
    filtered.push(entry);

    await writeMcpEntries(dataRoot, filtered);
    await closeAllMcpSessions();

    return {
      ok: true,
      name: userName,
      toolsCount: test.tools.length,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `连接语雀服务时发生异常: ${message}` };
  }
}

export async function connectGiteeIntegration(
  dataRoot: string,
  params: GiteeConnectParams,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<IntegrationConnectResult> {
  const token = params.token.trim();
  if (!token) {
    return { ok: false, error: 'Gitee 个人访问令牌 (Token) 不能为空。' };
  }

  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  try {
    const userRes = await fetchFn(`https://gitee.com/api/v5/user?access_token=${encodeURIComponent(token)}`, {
      headers: {
        'User-Agent': 'ReizoStudio/0.1.0',
      },
    });
    if (!userRes.ok) {
      return { ok: false, error: `Gitee Token 校验失败 (${userRes.status}): 请确认私人令牌是否有效并勾选了 projects 权限。` };
    }
    const userData = (await userRes.json()) as { name?: string; login?: string };
    const userName = userData.name || userData.login || 'Gitee 用户';

    const script = getBuiltinMcpScript('gitee-server.cjs');
    const entry: McpServerEntry = {
      name: 'gitee',
      transport: 'stdio',
      command: process.execPath,
      args: [script],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        GITEE_TOKEN: token,
        GITEE_USER_NAME: userName,
        ...(userData.login ? { GITEE_USER_LOGIN: userData.login } : {}),
      },
    };

    const test = await testMcpEntry(dataRoot, entry);
    const existing = await readMcpEntries(dataRoot);
    const filtered = existing.filter((e) => !isGiteeEntry(e));
    filtered.push(entry);

    await writeMcpEntries(dataRoot, filtered);
    await closeAllMcpSessions();

    return {
      ok: true,
      name: userName,
      toolsCount: test.tools.length,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `连接 Gitee 服务时发生异常: ${message}` };
  }
}

export async function connectGitHubIntegration(
  dataRoot: string,
  params: GitHubConnectParams,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<IntegrationConnectResult> {
  const token = params.token.trim();
  if (!token) {
    return { ok: false, error: 'GitHub Personal Access Token 不能为空。' };
  }

  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  try {
    const userRes = await fetchFn('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'ReizoStudio/0.1.0',
        Accept: 'application/vnd.github+json',
      },
    });
    if (!userRes.ok) {
      return { ok: false, error: `GitHub Token 校验失败 (${userRes.status}): 请确认 Token 是否正确且具有 repo 权限。` };
    }
    const userData = (await userRes.json()) as { name?: string; login?: string };
    const userName = userData.name || userData.login || 'GitHub 用户';

    const script = getBuiltinMcpScript('github-server.cjs');
    const entry: McpServerEntry = {
      name: 'github',
      transport: 'stdio',
      command: process.execPath,
      args: [script],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        GITHUB_TOKEN: token,
        GITHUB_USER_NAME: userName,
        ...(userData.login ? { GITHUB_USER_LOGIN: userData.login } : {}),
      },
    };

    const test = await testMcpEntry(dataRoot, entry);
    const existing = await readMcpEntries(dataRoot);
    const filtered = existing.filter((e) => !isGitHubEntry(e));
    filtered.push(entry);

    await writeMcpEntries(dataRoot, filtered);
    await closeAllMcpSessions();

    return {
      ok: true,
      name: userName,
      toolsCount: test.tools.length,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `连接 GitHub 服务时发生异常: ${message}` };
  }
}

export async function disconnectQuickIntegration(
  dataRoot: string,
  id: QuickIntegrationId,
): Promise<IntegrationConnectResult> {
  const existing = await readMcpEntries(dataRoot);
  const filtered = existing.filter((e) => {
    switch (id) {
      case 'notion':
        return !isNotionEntry(e);
      case 'gmail':
        return !isGmailEntry(e);
      case 'feishu':
        return !isFeishuEntry(e);
      case 'wecom':
        return !isWeComEntry(e);
      case 'dingtalk':
        return !isDingTalkEntry(e);
      case 'yuque':
        return !isYuqueEntry(e);
      case 'gitee':
        return !isGiteeEntry(e);
      case 'github':
        return !isGitHubEntry(e);
      default:
        return true;
    }
  });
  await writeMcpEntries(dataRoot, filtered);
  await closeAllMcpSessions();
  return { ok: true };
}


export interface GoogleOAuthOptions {
  opener?: (url: string) => Promise<void> | void;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export async function startGoogleOAuthFlow(
  dataRoot: string,
  params: GoogleOAuthParams,
  options: GoogleOAuthOptions = {},
): Promise<IntegrationConnectResult> {
  const clientId = params.clientId.trim();
  const clientSecret = params.clientSecret.trim();
  if (!clientId || !clientSecret) {
    return { ok: false, error: '需要提供 Google OAuth Client ID 和 Client Secret。' };
  }

  const opener = options.opener ?? ((url: string) => shell.openExternal(url));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 180_000;

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const expectedState = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve) => {
    let server: Server | null = null;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (server) {
        try {
          server.close();
        } catch {
          /* ignore */
        }
        server = null;
      }
    };

    timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, error: '授权超时，请重试。' });
    }, timeoutMs);

    server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host}`);
        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderResultPage('授权未完成', `Google 返回错误：${error}`, false));
          cleanup();
          resolve({ ok: false, error: `Google 授权失败：${error}` });
          return;
        }

        if (state !== expectedState || !code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderResultPage('验证失败', '状态码或校验参数不匹配，请重试。', false));
          cleanup();
          resolve({ ok: false, error: 'OAuth 状态码校验不匹配。' });
          return;
        }

        // Exchange code for tokens
        const address = server?.address() as AddressInfo | null;
        const redirectUri = `http://127.0.0.1:${address?.port}/callback`;

        const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        });

        if (!tokenRes.ok) {
          const body = await tokenRes.text();
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderResultPage('换取凭证失败', `服务器返回错误：${body}`, false));
          cleanup();
          resolve({ ok: false, error: `换取 Token 失败：${body}` });
          return;
        }

        const tokens = (await tokenRes.json()) as {
          access_token?: string;
          refresh_token?: string;
        };

        if (!tokens.refresh_token) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            renderResultPage(
              '未能获取长期 Refresh Token',
              'Google 未返回 refresh_token（可能此前已授权）。请在 Google 账号安全设置中撤销授权后重新尝试。',
              false,
            ),
          );
          cleanup();
          resolve({
            ok: false,
            error: 'Google 未返回 refresh_token，请到 Google 账号管理中移除应用权限后重试。',
          });
          return;
        }

        // Retrieve email if possible
        let userEmail: string | undefined;
        try {
          const userinfoRes = await fetchImpl('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          if (userinfoRes.ok) {
            const userinfo = (await userinfoRes.json()) as { email?: string };
            userEmail = userinfo.email;
          }
        } catch {
          /* ignore */
        }

        // Write to mcp.json
        const entry: McpServerEntry = {
          name: 'gmail',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'mcp-google-gmail'],
          env: {
            GOOGLE_GMAIL_CLIENT_ID: clientId,
            GOOGLE_GMAIL_CLIENT_SECRET: clientSecret,
            GOOGLE_GMAIL_REFRESH_TOKEN: tokens.refresh_token,
            ...(userEmail ? { GOOGLE_GMAIL_USER_EMAIL: userEmail } : {}),
          },
        };

        const existing = await readMcpEntries(dataRoot);
        const filtered = existing.filter((e) => !isGmailEntry(e));
        filtered.push(entry);
        await writeMcpEntries(dataRoot, filtered);
        await closeAllMcpSessions();

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          renderResultPage(
            '授权成功！',
            `已成功连接 Google 账号${userEmail ? `（${userEmail}）` : ''}至 Reizo Studio。<br>您可以关闭此窗口。`,
            true,
          ),
        );

        cleanup();
        resolve({ ok: true, email: userEmail });
      } catch (cause) {
        cleanup();
        resolve({
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    });

    server.listen(0, '127.0.0.1', async () => {
      try {
        const address = server?.address() as AddressInfo | null;
        if (!address) {
          cleanup();
          resolve({ ok: false, error: '无法绑定本地授权服务端口。' });
          return;
        }

        const redirectUri = `http://127.0.0.1:${address.port}/callback`;
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set(
          'scope',
          'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email',
        );
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');
        authUrl.searchParams.set('code_challenge', challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('state', expectedState);

        await opener(authUrl.toString());
      } catch (err) {
        cleanup();
        resolve({
          ok: false,
          error: `打开授权网页失败：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  });
}

function renderResultPage(title: string, message: string, success: boolean): string {
  const color = success ? '#10b981' : '#f59e0b';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Reizo Studio - ${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 85vh;
      margin: 0;
      background-color: #f4f4f5;
      color: #18181b;
    }
    .card {
      background: white;
      border: 1px solid #e4e4e7;
      border-radius: 20px;
      padding: 40px 48px;
      text-align: center;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);
      max-width: 440px;
      width: 90%;
    }
    h2 { margin: 0 0 12px; font-size: 22px; font-weight: 600; color: ${color}; }
    p { margin: 0 0 24px; font-size: 14px; color: #71717a; line-height: 1.6; }
    .btn {
      display: inline-block;
      padding: 8px 20px;
      background: #18181b;
      color: white;
      border-radius: 9999px;
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>${title}</h2>
    <p>${message}</p>
    <a class="btn" href="javascript:window.close();">关闭此页面</a>
  </div>
</body>
</html>`;
}
