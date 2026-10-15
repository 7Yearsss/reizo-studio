import { describe, expect, it, vi } from 'vitest';
import { EditorMcpClient, editorResult } from './mcpClient';
import { VideoEditorService } from './service';

describe('editor MCP transport', () => {
  it('keeps transport ownership, consumes SSE notifications, and preserves image evidence', async () => {
    const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      requests.push({ headers: new Headers(options?.headers), body });
      if (body.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26' } }, { headers: { 'Mcp-Session-Id': 'owner-1' } });
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      return new Response(`event: message\ndata: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '{"ok":true}' }, { type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    const client = new EditorMcpClient('http://127.0.0.1:47831', 'private-token', fetcher as typeof fetch);
    const result = await client.call('view_timeline_frames', { editSessionId: 'draft-1' });
    expect(requests).toHaveLength(3);
    expect(requests[2].headers.get('Mcp-Session-Id')).toBe('owner-1');
    expect(requests[2].headers.get('authorization')).toBe('Bearer private-token');
    expect(result.content[1]).toEqual({ type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' });
    expect(editorResult(result)).toEqual({ ok: true });
  });

  it('does not replay a mutation after an HTTP error', async () => {
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      if (body.method === 'initialize') return Response.json({ result: {} }, { headers: { 'Mcp-Session-Id': 'owner' } });
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      return new Response(null, { status: 500 });
    });
    const client = new EditorMcpClient('http://127.0.0.1:47831', 'test', fetcher as typeof fetch);
    await expect(client.call('split_item', { id: 'clip' })).rejects.toThrow('不会自动重试');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('blocks generation and unopened projects before starting the engine', async () => {
    const service = new VideoEditorService('unused-test-root');
    await expect(service.call('session', 'generate_video', {})).rejects.toThrow('未开放');
    await expect(service.call('session', 'read_project', {})).rejects.toThrow('先打开');
    service.stop();
  });

  it('propagates tool errors instead of claiming success', () => {
    expect(() => editorResult({ isError: true, content: [{ type: 'text', text: 'stale draft' }] })).toThrow('stale draft');
  });
});
