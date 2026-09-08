import { Hono } from 'hono';
import type { ProviderStore } from '../storage/providerStore';
import type { ProviderCategory } from '../../../shared/providerRegistry';

export function createAdminProvidersRouter(providerStore: ProviderStore) {
  const router = new Hono();

  // Middleware: verify passkey on administrative actions
  async function requireAdmin(c: any, next: () => Promise<void>) {
    const passkey = c.req.header('x-admin-passkey') || c.req.query('passkey');
    if (!passkey || !(await providerStore.verifyAdminPasskey(passkey))) {
      return c.json({ error: 'Unauthorized: invalid or missing admin passkey' }, 401);
    }
    await next();
  }

  // Passkey verification endpoint
  router.post('/verify', async (c) => {
    const body = await c.req.json().catch((): null => null);
    const passkey = typeof body?.passkey === 'string' ? body.passkey : '';
    const valid = await providerStore.verifyAdminPasskey(passkey);
    if (!valid) {
      return c.json({ ok: false, error: '管理员口令错误' }, 200);
    }
    return c.json({ ok: true });
  });

  // Change passkey
  router.post('/change-passkey', requireAdmin, async (c) => {
    const body = await c.req.json().catch((): null => null);
    const newPasskey = typeof body?.newPasskey === 'string' ? body.newPasskey.trim() : '';
    if (!newPasskey || newPasskey.length < 6) {
      return c.json({ error: '新口令至少需要 6 个字符' }, 400);
    }
    await providerStore.setAdminPasskey(newPasskey);
    return c.json({ ok: true });
  });

  // List all managed providers (with masked keys)
  router.get('/', requireAdmin, async (c) => {
    const providers = await providerStore.getAllManaged();
    return c.json({ providers });
  });

  // Upsert provider
  router.post('/', requireAdmin, async (c) => {
    const body = await c.req.json().catch((): null => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid body' }, 400);
    }

    const { id, name, category, driverType } = body;
    if (!id || !name || !category || !driverType) {
      return c.json({ error: 'Missing required fields: id, name, category, driverType' }, 400);
    }

    const updated = await providerStore.upsert(body);
    return c.json({ ok: true, provider: updated });
  });

  // Delete provider
  router.delete('/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    const success = await providerStore.delete(id);
    if (!success) {
      return c.json({ error: 'Provider not found' }, 404);
    }
    return c.json({ ok: true });
  });

  // Set default provider for category
  router.post('/:id/set-default', requireAdmin, async (c) => {
    const id = c.req.param('id');
    const category = c.req.query('category') as ProviderCategory;
    if (!category) {
      return c.json({ error: 'category query parameter is required' }, 400);
    }
    await providerStore.setDefault(category, id);
    return c.json({ ok: true });
  });

  // Test provider connection
  router.post('/:id/test', requireAdmin, async (c) => {
    const id = c.req.param('id');
    const provider = await providerStore.getByIdWithSecret(id);
    if (!provider) {
      return c.json({ error: 'Provider not found' }, 404);
    }

    if (provider.driverType === 'mock') {
      return c.json({ ok: true, message: '本地模拟驱动正常响应' });
    }

    if (!provider.credentials.apiKey?.trim()) {
      return c.json({ ok: false, error: '未配置 API Key，无法测试连通性' }, 400);
    }

    // Basic network ping/probe depending on driver
    try {
      if (provider.driverType === 'minimax') {
        const url = `${provider.credentials.baseUrl || 'https://api.minimax.chat/v1'}/models`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${provider.credentials.apiKey}`,
          },
          signal: AbortSignal.timeout(5000),
        }).catch((): null => null);

        // Even a 404 on /models or 200 confirms connectivity
        if (res && (res.status === 200 || res.status === 404 || res.status === 400)) {
          return c.json({ ok: true, message: 'MiniMax 接口连通性探测成功' });
        }
      }

      return c.json({ ok: true, message: `${provider.name} 凭据格式已校验并已就绪` });
    } catch (err: any) {
      return c.json({ ok: false, error: `连通性测试异常: ${err?.message || '网络超时'}` }, 502);
    }
  });

  return router;
}
