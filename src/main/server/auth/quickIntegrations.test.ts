import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  connectDingTalkIntegration,
  connectFeishuIntegration,
  connectGiteeIntegration,
  connectGitHubIntegration,
  connectNotionIntegration,
  connectWeComIntegration,
  connectYuqueIntegration,
  disconnectQuickIntegration,
  getQuickIntegrationsStatus,
  startGoogleOAuthFlow,
} from './quickIntegrations';
import { readMcpEntries, writeMcpEntries } from '../plugins/extensionConfig';

describe('quickIntegrations', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'integrations-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports disconnected status when no entries exist', async () => {
    const status = await getQuickIntegrationsStatus(root);
    expect(status).toEqual({
      notion: { connected: false },
      gmail: { connected: false },
      feishu: { connected: false },
      wecom: { connected: false },
      dingtalk: { connected: false },
      yuque: { connected: false },
      gitee: { connected: false },
      github: { connected: false },
    });
  });

  it('detects connected Notion and Gmail entries', async () => {
    await writeMcpEntries(root, [
      {
        name: 'notion',
        transport: 'http',
        url: 'https://mcp.notion.com/mcp',
        headers: { Authorization: 'Bearer test-token' },
      },
      {
        name: 'gmail',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'mcp-google-gmail'],
        env: {
          GOOGLE_GMAIL_CLIENT_ID: 'cid',
          GOOGLE_GMAIL_CLIENT_SECRET: 'csec',
          GOOGLE_GMAIL_REFRESH_TOKEN: 'rtoken',
          GOOGLE_GMAIL_USER_EMAIL: 'user@example.com',
        },
      },
    ]);

    const status = await getQuickIntegrationsStatus(root);
    expect(status.notion).toEqual({ connected: true, serverName: 'notion' });
    expect(status.gmail).toEqual({ connected: true, serverName: 'gmail', email: 'user@example.com' });
  });

  it('disconnects an integration by ID', async () => {
    await writeMcpEntries(root, [
      {
        name: 'notion',
        transport: 'http',
        url: 'https://mcp.notion.com/mcp',
      },
      {
        name: 'files',
        transport: 'stdio',
        command: 'npx',
      },
    ]);

    const res = await disconnectQuickIntegration(root, 'notion');
    expect(res.ok).toBe(true);

    const remaining = await readMcpEntries(root);
    expect(remaining.map((r) => r.name)).toEqual(['files']);
    const status = await getQuickIntegrationsStatus(root);
    expect(status.notion.connected).toBe(false);
  });

  it('rejects empty Notion token', async () => {
    const res = await connectNotionIntegration(root, '   ');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Token 不能为空');
  });

  it('completes Google OAuth loopback flow and saves Gmail entry', async () => {
    let capturedAuthUrl = '';

    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'mock-access-token',
            refresh_token: 'mock-refresh-token',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('googleapis.com/oauth2/v2/userinfo')) {
        return new Response(
          JSON.stringify({
            email: 'hello@reizo.ai',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const flowPromise = startGoogleOAuthFlow(
      root,
      { clientId: 'my-client-id', clientSecret: 'my-client-secret' },
      {
        opener: async (url) => {
          capturedAuthUrl = url;
          // Simulate user completing login and browser redirecting to local callback
          const parsed = new URL(url);
          const redirectUri = parsed.searchParams.get('redirect_uri') ?? '';
          const state = parsed.searchParams.get('state') ?? '';
          const callbackUrl = `${redirectUri}?code=mock-auth-code&state=${state}`;

          // Hit the local server callback
          const res = await fetch(callbackUrl);
          expect(res.status).toBe(200);
        },
        fetchImpl: mockFetch as unknown as typeof globalThis.fetch,
        timeoutMs: 5000,
      },
    );

    const result = await flowPromise;
    expect(result.ok).toBe(true);
    expect(result.email).toBe('hello@reizo.ai');
    expect(capturedAuthUrl).toContain('accounts.google.com/o/oauth2/v2/auth');

    const entries = await readMcpEntries(root);
    const gmail = entries.find((e) => e.name === 'gmail');
    expect(gmail).toBeDefined();
    expect(gmail?.env?.GOOGLE_GMAIL_CLIENT_ID).toBe('my-client-id');
    expect(gmail?.env?.GOOGLE_GMAIL_CLIENT_SECRET).toBe('my-client-secret');
    expect(gmail?.env?.GOOGLE_GMAIL_REFRESH_TOKEN).toBe('mock-refresh-token');
    expect(gmail?.env?.GOOGLE_GMAIL_USER_EMAIL).toBe('hello@reizo.ai');

    const status = await getQuickIntegrationsStatus(root);
    expect(status.gmail.connected).toBe(true);
    expect(status.gmail.email).toBe('hello@reizo.ai');
  });

  it('connects Feishu integration after verifying credentials', async () => {
    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('auth/v3/tenant_access_token/internal')) {
        return new Response(JSON.stringify({ code: 0, msg: 'ok', tenant_access_token: 't-test-token', expire: 7200 }));
      }
      if (url.includes('bot/v3/info')) {
        return new Response(JSON.stringify({ code: 0, bot: { app_name: 'Reizo 飞书助手' } }));
      }
      return new Response('not found', { status: 404 });
    };

    const res = await connectFeishuIntegration(
      root,
      { appId: 'cli_test_123', appSecret: 'sec_test_456' },
      { fetchImpl: mockFetch as unknown as typeof globalThis.fetch },
    );

    expect(res.ok).toBe(true);
    expect(res.name).toBe('Reizo 飞书助手');

    const status = await getQuickIntegrationsStatus(root);
    expect(status.feishu.connected).toBe(true);
    expect(status.feishu.appName).toBe('Reizo 飞书助手');
    expect(status.feishu.appId).toBe('cli_test_123');

    // Test disconnect
    const disc = await disconnectQuickIntegration(root, 'feishu');
    expect(disc.ok).toBe(true);
    const afterStatus = await getQuickIntegrationsStatus(root);
    expect(afterStatus.feishu.connected).toBe(false);
  });

  it('rejects invalid Feishu credentials', async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response(JSON.stringify({ code: 10003, msg: 'app_id or app_secret invalid' }));
    };

    const res = await connectFeishuIntegration(
      root,
      { appId: 'bad_id', appSecret: 'bad_secret' },
      { fetchImpl: mockFetch as unknown as typeof globalThis.fetch },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain('飞书应用鉴权失败');
  });

  it('connects WeCom integration and normalizes key or URL', async () => {
    const res = await connectWeComIntegration(root, {
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=12345678-abcd-1234-abcd-1234567890ab',
      botName: '技术通知群',
    });

    expect(res.ok).toBe(true);
    expect(res.name).toBe('技术通知群');

    const status = await getQuickIntegrationsStatus(root);
    expect(status.wecom.connected).toBe(true);
    expect(status.wecom.botName).toBe('技术通知群');

    // Disconnect
    await disconnectQuickIntegration(root, 'wecom');
    const after = await getQuickIntegrationsStatus(root);
    expect(after.wecom.connected).toBe(false);
  });

  it('connects DingTalk integration and supports signature secret', async () => {
    const res = await connectDingTalkIntegration(root, {
      webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=mock-ding-token',
      secret: 'SEC12345678',
      botName: '钉钉运维群',
    });

    expect(res.ok).toBe(true);
    expect(res.name).toBe('钉钉运维群');

    const status = await getQuickIntegrationsStatus(root);
    expect(status.dingtalk.connected).toBe(true);
    expect(status.dingtalk.botName).toBe('钉钉运维群');

    // Disconnect
    await disconnectQuickIntegration(root, 'dingtalk');
    const after = await getQuickIntegrationsStatus(root);
    expect(after.dingtalk.connected).toBe(false);
  });

  it('connects Yuque integration after verifying user token', async () => {
    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('/api/v2/user')) {
        return new Response(JSON.stringify({ data: { name: '语雀架构师', login: 'reizo_architect' } }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    };

    const res = await connectYuqueIntegration(
      root,
      { token: 'mock-yuque-token' },
      { fetchImpl: mockFetch as unknown as typeof globalThis.fetch },
    );

    expect(res.ok).toBe(true);
    expect(res.name).toBe('语雀架构师');

    const status = await getQuickIntegrationsStatus(root);
    expect(status.yuque.connected).toBe(true);
    expect(status.yuque.userName).toBe('语雀架构师');

    // Disconnect
    await disconnectQuickIntegration(root, 'yuque');
    const after = await getQuickIntegrationsStatus(root);
    expect(after.yuque.connected).toBe(false);
  });

  it('rejects invalid Yuque token', async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response(JSON.stringify({ message: '401 Unauthorized' }), { status: 401 });
    };

    const res = await connectYuqueIntegration(
      root,
      { token: 'bad-token' },
      { fetchImpl: mockFetch as unknown as typeof globalThis.fetch },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain('语雀 Token 校验失败');
  });

  it('connects Gitee integration after verifying token', async () => {
    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('gitee.com/api/v5/user')) {
        return new Response(JSON.stringify({ name: '开源贡献者', login: 'reizo_gitee' }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    };

    const res = await connectGiteeIntegration(
      root,
      { token: 'mock-gitee-token' },
      { fetchImpl: mockFetch as unknown as typeof globalThis.fetch },
    );

    expect(res.ok).toBe(true);
    expect(res.name).toBe('开源贡献者');

    const status = await getQuickIntegrationsStatus(root);
    expect(status.gitee.connected).toBe(true);
    expect(status.gitee.userName).toBe('开源贡献者');
    expect(status.gitee.login).toBe('reizo_gitee');

    // Disconnect
    await disconnectQuickIntegration(root, 'gitee');
    const after = await getQuickIntegrationsStatus(root);
    expect(after.gitee.connected).toBe(false);
  });

  it('rejects invalid Gitee token', async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response(JSON.stringify({ message: '401 Unauthorized' }), { status: 401 });
    };

    const res = await connectGiteeIntegration(
      root,
      { token: 'bad-gitee-token' },
      { fetchImpl: mockFetch as unknown as typeof globalThis.fetch },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain('Gitee Token 校验失败');
  });

  it('connects GitHub integration after verifying token', async () => {
    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('api.github.com/user')) {
        return new Response(JSON.stringify({ name: 'Octocat Developer', login: 'octocat' }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    };

    const res = await connectGitHubIntegration(
      root,
      { token: 'ghp_mock_token_123' },
      { fetchImpl: mockFetch as unknown as typeof globalThis.fetch },
    );

    expect(res.ok).toBe(true);
    expect(res.name).toBe('Octocat Developer');

    const status = await getQuickIntegrationsStatus(root);
    expect(status.github.connected).toBe(true);
    expect(status.github.userName).toBe('Octocat Developer');
    expect(status.github.login).toBe('octocat');

    // Disconnect
    await disconnectQuickIntegration(root, 'github');
    const after = await getQuickIntegrationsStatus(root);
    expect(after.github.connected).toBe(false);
  });

  it('rejects invalid GitHub token', async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
    };

    const res = await connectGitHubIntegration(
      root,
      { token: 'bad-github-token' },
      { fetchImpl: mockFetch as unknown as typeof globalThis.fetch },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain('GitHub Token 校验失败');
  });
});

