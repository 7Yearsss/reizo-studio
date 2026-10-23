import { describe, expect, it, vi } from 'vitest';
import { AccountService, accountOrigin, type AccountCredential } from './service';
import type { AccountUser } from '../../shared/account';

const origin = 'https://reizo.example';
const token = 't'.repeat(43);
const user: AccountUser = { id: 'u1', username: 'test', displayName: '测试用户', email: null };
const now = Date.parse('2026-10-15T00:00:00Z');
const expiresAt = new Date(now + 600_000).toISOString();
const requestId = 'b044ce0d-0296-4711-9ae4-632c965ac911';
const grant = { token, requestId, code: 'ABCD-1234', expiresAt, verificationUrl: `${origin}/desktop/connect?request=${requestId}` };
const authenticated = { status: 'authenticated', user, expiresAt };
const response = (body: unknown, status = 200) => Response.json(body, { status });
function fixture(saved: AccountCredential | null = null, modelSessions = false) {
  let disk = saved;
  let clock = now;
  const fetcher = vi.fn<typeof fetch>();
  const open = vi.fn(async () => undefined);
  const write = vi.fn((value: AccountCredential | null) => { disk = value; });
  const connected = vi.fn();
  const deps = { origin, fetch: fetcher, read: () => disk, write, open, connected, modelSessions, now: () => clock };
  return { service: new AccountService(deps), deps, fetcher, open, write, connected, advance: (ms: number) => { clock += ms; } };
}

describe('browser account login', () => {
  it('keeps tokens out of renderer state and browser URLs, restores only after revalidation', async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(response(grant)).mockResolvedValueOnce(response(authenticated));
    const pending = await f.service.start();
    expect(pending).toMatchObject({ status: 'pending', code: grant.code });
    expect(JSON.stringify(pending)).not.toContain(token);
    expect(f.open).toHaveBeenCalledWith(grant.verificationUrl);
    expect(f.write).not.toHaveBeenCalled();
    expect(await f.service.refresh()).toMatchObject({ status: 'authenticated', user });
    expect(f.connected).toHaveBeenCalledOnce();
    const restarted = new AccountService(f.deps);
    expect(restarted.snapshot().status).toBe('offline');
    f.fetcher.mockResolvedValueOnce(response(authenticated));
    expect((await restarted.refresh()).status).toBe('authenticated');
    expect(f.fetcher.mock.calls[1][1]).toMatchObject({ headers: { Authorization: `Bearer ${token}` }, redirect: 'error' });
  });
  it('deduplicates starts and retains the same pending request when reopening', async () => {
    const f = fixture(); f.fetcher.mockResolvedValueOnce(response(grant));
    await Promise.all([f.service.start(), f.service.start()]);
    await f.service.start();
    expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.open).toHaveBeenCalledTimes(2);
  });
  it('does not restore a stale poll after logout', async () => {
    const f = fixture(); f.fetcher.mockResolvedValueOnce(response(grant)); await f.service.start();
    let resolve!: (r: Response) => void;
    f.fetcher.mockReturnValueOnce(new Promise((r) => { resolve = r; })).mockResolvedValueOnce(response({ revoked: true }));
    const pending = f.service.refresh(); await f.service.logout(); resolve(response(authenticated)); await pending;
    expect(f.service.snapshot().status).toBe('signed-out'); expect(f.connected).not.toHaveBeenCalled();
    expect(f.write.mock.calls.every(([value]) => value === null)).toBe(true);
  });
  it('cancels an in-flight start and revokes the late-issued grant without opening a browser', async () => {
    const f = fixture(); let resolve!: (r: Response) => void;
    f.fetcher.mockReturnValueOnce(new Promise((r) => { resolve = r; })).mockResolvedValueOnce(response({ revoked: true }));
    const start = f.service.start(); await f.service.logout(); resolve(response(grant)); await start;
    expect(f.open).not.toHaveBeenCalled(); expect(f.service.snapshot().status).toBe('signed-out');
    expect(f.fetcher.mock.calls[1][1]?.method).toBe('DELETE');
  });
  it('distinguishes a network failure from a revoked account and preserves the cached identity offline', async () => {
    const f = fixture({ token, origin, user, expiresAt });
    f.fetcher.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(response({}, 401));
    expect(await f.service.refresh()).toMatchObject({ status: 'offline', user });
    expect(f.write).not.toHaveBeenCalled();
    expect((await f.service.refresh()).status).toBe('signed-out'); expect(f.write).toHaveBeenCalledWith(null);
  });
  it('expires a request locally without accepting a later approval', async () => {
    const f = fixture(); f.fetcher.mockResolvedValueOnce(response(grant)); await f.service.start();
    f.advance(600_001);
    expect((await f.service.refresh()).status).toBe('signed-out');
    expect(f.fetcher.mock.calls[1][1]?.method).toBe('DELETE');
    const expired = fixture({ token, origin, user, expiresAt: new Date(now - 1).toISOString() });
    expect(expired.service.snapshot().status).toBe('signed-out'); expect(expired.write).toHaveBeenCalledWith(null);
  });
  it('rejects foreign authorization URLs and does not send credentials across redirects', async () => {
    const f = fixture(); f.fetcher.mockResolvedValueOnce(response({ ...grant, verificationUrl: 'https://other.example/login' })).mockResolvedValueOnce(response({ revoked: true }));
    expect((await f.service.start()).status).toBe('signed-out'); expect(f.open).not.toHaveBeenCalled();
    expect(f.fetcher.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  });
  it('fails closed and revokes a grant if encrypted persistence fails', async () => {
    const f = fixture(); f.fetcher.mockResolvedValueOnce(response(grant)).mockResolvedValueOnce(response(authenticated)).mockResolvedValueOnce(response({ revoked: true }));
    await f.service.start(); f.write.mockImplementation(() => { throw new Error('disk full'); });
    expect(await f.service.refresh()).toMatchObject({ status: 'signed-out', message: expect.stringContaining('安全保存') });
    expect(f.connected).not.toHaveBeenCalled();
  });
  it('reports offline revocation honestly while clearing local credentials', async () => {
    const f = fixture({ token, origin, user, expiresAt }); f.fetcher.mockRejectedValue(new Error('offline'));
    expect(await f.service.logout()).toMatchObject({ status: 'signed-out', message: expect.stringContaining('尚未确认') });
    expect(f.write).toHaveBeenCalledWith(null);
  });
  it('still clears the visible identity if revoked credentials cannot be removed from disk', async () => {
    const f = fixture({ token, origin, user, expiresAt }); f.fetcher.mockResolvedValueOnce(response({}, 401));
    f.write.mockImplementation(() => { throw new Error('file locked'); });
    expect(await f.service.refresh()).toMatchObject({ status: 'signed-out', message: expect.stringContaining('未能移除') });
    expect(f.service.snapshot().user).toBeUndefined();
  });
  it('allows loopback HTTP only in development and rejects credentials in origins', () => {
    expect(accountOrigin('http://localhost:3000', true)).toBe('http://localhost:3000');
    for (const url of ['http://localhost:3000', 'http://example.com', 'https://user:password@example.com', 'https://example.com/path']) expect(() => accountOrigin(url)).toThrow();
  });
});

const modelSession = { organizationId: 'org-1', organizationName: '测试工作区', apiKey: 'sk-device-test', baseUrl: 'https://gateway.example/v1', expiresAt,
  models: [{ id: 'chat-test', name: 'Chat Test' }] };

describe('account model credentials', () => {
  it('revalidates before using encrypted credentials and never exposes keys through account state', async () => {
    const f = fixture({ token, origin, user, expiresAt, models: modelSession }, true);
    expect(f.service.modelCredential()).toBeNull();
    f.fetcher.mockResolvedValueOnce(response(authenticated)).mockResolvedValueOnce(response({ credential: modelSession }));
    expect(await f.service.refresh()).toMatchObject({ status: 'authenticated', models: { ready: true, organizationId: 'org-1' } });
    expect(f.service.modelCredential()).toEqual(modelSession);
    const catalogVersion = f.service.snapshot().models?.catalogVersion;
    f.fetcher.mockResolvedValueOnce(response(authenticated)).mockResolvedValueOnce(response({ credential: { ...modelSession, models: [{ id: 'chat-new', name: 'New Chat' }] } }));
    await f.service.refresh();
    expect(f.service.snapshot().models?.catalogVersion).not.toBe(catalogVersion);
    expect(JSON.stringify(f.service.snapshot())).not.toContain('sk-device-test');
    expect(f.write.mock.calls.at(-1)?.[0]?.models?.models[0].id).toBe('chat-new');
    f.advance(600_001);
    expect(f.service.modelCredential()).toBeNull();
    expect(f.service.snapshot().models?.ready).toBe(false);
  });

  it('clears a previous lease on offline or rejected model refresh without signing out a valid identity', async () => {
    const f = fixture({ token, origin, user, expiresAt }, true);
    f.fetcher.mockResolvedValueOnce(response(authenticated)).mockResolvedValueOnce(response({ credential: modelSession }));
    await f.service.refresh();
    f.fetcher.mockResolvedValueOnce(response(authenticated)).mockResolvedValueOnce(response({}, 403));
    expect(await f.service.refresh()).toMatchObject({ status: 'authenticated', models: { ready: false } });
    expect(f.service.modelCredential()).toBeNull();
    expect(f.write.mock.calls.at(-1)?.[0]?.models).toBeUndefined();
  });

  it('does not resurrect a model lease after logout races its response', async () => {
    const f = fixture({ token, origin, user, expiresAt }, true);
    let resolve!: (r: Response) => void;
    f.fetcher.mockResolvedValueOnce(response(authenticated)).mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValueOnce(response({ revoked: true }));
    const refresh = f.service.refresh();
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2));
    await f.service.logout(); resolve(response({ credential: modelSession })); await refresh;
    expect(f.service.modelCredential()).toBeNull();
    expect(f.service.snapshot().status).toBe('signed-out');
    expect(f.write.mock.calls.every(([value]) => value === null)).toBe(true);
  });

  it('rejects insecure gateways, invalid model lists and leases outliving the desktop session', async () => {
    for (const bad of [{ baseUrl: 'http://gateway.example/v1' }, { models: [] as { id: string; name: string }[] }, { expiresAt: new Date(now + 700_000).toISOString() }]) {
      const f = fixture({ token, origin, user, expiresAt }, true);
      f.fetcher.mockResolvedValueOnce(response(authenticated)).mockResolvedValueOnce(response({ credential: { ...modelSession, ...bad } }));
      expect((await f.service.refresh()).models?.ready).toBe(false);
      expect(f.service.modelCredential()).toBeNull();
    }
  });
});
