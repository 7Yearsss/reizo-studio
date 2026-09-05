import type { ToolCallPart } from '../../../shared/chat';
import { ToolResult, ToolResultOutput } from '../agents/tool-result';
import { ImageGeneration } from '../agents/image-generation';
import { getResolvedApiOrigin } from '../../api';
import DiffView from './DiffView';
import { toolDetail, toolDiffPreview, toolLabel, toolTarget } from './toolDisplay';

export default function ToolCard({ part, collapsed = false }: { part: ToolCallPart; collapsed?: boolean }) {
  const running = part.result === undefined && part.error === undefined;

  if (part.name === 'generate_image' || part.name === 'create_image') {
    const prompt = typeof part.args?.prompt === 'string' ? part.args.prompt : undefined;
    const resolution =
      typeof part.args?.resolution === 'string'
        ? part.args.resolution
        : typeof part.args?.size === 'string'
          ? (part.args.size as string).replace('x', ' × ')
          : '1024 × 1024';
    let imageUrl = '';
    if (part.result) {
      try {
        const parsed = JSON.parse(part.result) as Record<string, unknown>;
        if (typeof parsed.imageUrl === 'string') imageUrl = parsed.imageUrl;
        else if (typeof parsed.url === 'string') imageUrl = parsed.url;
        else if (typeof parsed.dataUrl === 'string') imageUrl = parsed.dataUrl;
        else if (typeof parsed.src === 'string') imageUrl = parsed.src;
      } catch {
        if (part.result.startsWith('http') || part.result.startsWith('data:image')) {
          imageUrl = part.result;
        }
      }

      if (!imageUrl && typeof part.result === 'string') {
        const match = /"imageUrl"\s*:\s*"([^"]+)"/.exec(part.result);
        if (match?.[1]) {
          imageUrl = match[1];
        } else {
          const fileMatch = /(img-[a-z0-9-]+?\.(?:png|jpg|jpeg|webp))/i.exec(part.result);
          if (fileMatch?.[1]) {
            imageUrl = `/api/canvas/assets/chat/${fileMatch[1]}`;
          }
        }
      }
    }

    if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
      const origin = getResolvedApiOrigin() || 'http://127.0.0.1:47100';
      imageUrl = imageUrl.startsWith('/') ? `${origin}${imageUrl}` : `${origin}/${imageUrl}`;
    }
    const status = running ? 'generating' : part.error ? 'error' : 'complete';

    return (
      <div className="my-2 flex w-full justify-start text-left">
        <ImageGeneration
          status={status}
          prompt={prompt}
          resolution={resolution}
          size="compact"
          className="mr-auto"
        >
          {imageUrl ? (
            <img src={imageUrl} alt={prompt || 'AI 生成图片'} className="size-full object-cover" />
          ) : null}
        </ImageGeneration>
      </div>
    );
  }

  const detail = toolDetail(part);
  const target = toolTarget(part);
  const diffPreview = part.error ? null : toolDiffPreview(part);
  const kind = part.name === 'run_command' ? 'terminal' : part.name === 'edit_file' || part.name === 'write_file' ? 'custom' : 'request';
  const isWrite = part.name === 'edit_file' || part.name === 'write_file' || part.name === 'memory_write';

  return (
    <ToolResult
      tool={target}
      title={toolLabel(part.name)}
      status={running ? 'running' : part.error ? 'error' : 'success'}
      kind={kind}
      defaultOpen={!collapsed && (isWrite || Boolean(part.error))}
      collapseOnComplete={!isWrite}
      copyText={detail || undefined}
    >
      {diffPreview ? (
        <DiffView preview={diffPreview} />
      ) : detail ? (
        <ToolResultOutput language={kind === 'terminal' ? 'bash' : 'json'}>{detail}</ToolResultOutput>
      ) : (
        '（无输出）'
      )}
    </ToolResult>
  );
}
