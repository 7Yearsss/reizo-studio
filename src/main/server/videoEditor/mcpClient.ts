import type { VideoToolDefinition, VideoToolResult } from '../../../shared/videoEditor';

/** Small Streamable HTTP client. Never retry mutations after ambiguous transport failures. */
export class EditorMcpClient {
  private sessionId?: string;
  private sequence = 0;
  private initialization?: Promise<void>;
  constructor(private origin: string, private token: string, private fetcher: typeof fetch = fetch) {}

  private async rpc(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = ++this.sequence;
    const response = await this.fetcher(`${this.origin}/api/external-mcp/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream',
        authorization: `Bearer ${this.token}`,
        'MCP-Protocol-Version': '2025-03-26',
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`剪辑引擎请求失败 (${response.status})。请重新打开面板；修改操作不会自动重试。`);
    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    const unwrap = (message: { id?: number; error?: { message?: string }; result?: unknown }) => {
      if (message.error) throw new Error(message.error.message || '剪辑引擎返回错误');
      return message.result;
    };
    if (!response.headers.get('content-type')?.includes('text/event-stream')) return unwrap(await response.json());
    const reader = response.body?.getReader();
    if (!reader) throw new Error('剪辑引擎返回空响应');
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error('剪辑响应中断，操作结果尚未确认。请读取工程状态后再决定是否重试。');
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          const message = JSON.parse(data);
          if (message.id === id) return unwrap(message);
        }
      }
    } finally { await reader.cancel().catch((): void => undefined); }
  }

  private initialize(): Promise<void> {
    if (!this.initialization) this.initialization = (async () => {
      await this.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Reizo Studio', version: '0.1.0' } });
      const response = await this.fetcher(`${this.origin}/api/external-mcp/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${this.token}`, ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}), 'MCP-Protocol-Version': '2025-03-26' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('剪辑工具初始化失败');
      await response.body?.cancel();
    })();
    return this.initialization;
  }
  async call(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<VideoToolResult> {
    await this.initialize();
    return await this.rpc('tools/call', { name, arguments: args }, signal) as VideoToolResult;
  }
  async list(): Promise<VideoToolDefinition[]> {
    await this.initialize();
    const result = await this.rpc('tools/list', {}) as { tools: VideoToolDefinition[] };
    return result.tools;
  }
  async close(): Promise<void> {
    if (!this.sessionId) return;
    await this.fetcher(`${this.origin}/api/external-mcp/mcp`, {
      method: 'DELETE', headers: { authorization: `Bearer ${this.token}`, 'Mcp-Session-Id': this.sessionId, 'MCP-Protocol-Version': '2025-03-26' }, signal: AbortSignal.timeout(3_000),
    }).then((r) => r.body?.cancel()).catch((): void => undefined);
  }
}

export function editorResult(result: VideoToolResult): Record<string, unknown> {
  const text = result.content.find((c) => c.type === 'text')?.text;
  if (result.isError) throw new Error(text || '剪辑操作未成功');
  return result.structuredContent ?? (text ? JSON.parse(text) : {});
}
