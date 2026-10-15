import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  connectNotionIntegration,
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
});
