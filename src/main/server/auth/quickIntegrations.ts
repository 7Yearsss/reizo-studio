import crypto from 'node:crypto';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { shell } from 'electron';
import type { GoogleOAuthParams, IntegrationConnectResult, McpServerEntry, QuickIntegrationsStatus } from '../../../shared/extensionConfig';
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

export async function getQuickIntegrationsStatus(dataRoot: string): Promise<QuickIntegrationsStatus> {
  const entries = await readMcpEntries(dataRoot);
  const notion = entries.find((e) => isNotionEntry(e) && !e.disabled);
  const gmail = entries.find((e) => isGmailEntry(e) && !e.disabled);

  return {
    notion: {
      connected: Boolean(notion),
      ...(notion ? { serverName: notion.name } : {}),
    },
    gmail: {
      connected: Boolean(gmail),
      ...(gmail ? { serverName: gmail.name, email: gmail.env?.GOOGLE_GMAIL_USER_EMAIL } : {}),
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

export async function disconnectQuickIntegration(
  dataRoot: string,
  id: 'notion' | 'gmail',
): Promise<IntegrationConnectResult> {
  const existing = await readMcpEntries(dataRoot);
  const filtered = existing.filter((e) => (id === 'notion' ? !isNotionEntry(e) : !isGmailEntry(e)));
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
