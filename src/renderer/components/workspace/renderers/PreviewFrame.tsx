import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clapperboard,
  Copy,
  Crosshair,
  Monitor,
  Play,
  RotateCw,
  Send,
  Smartphone,
  Sparkles,
  Tablet,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import * as chatStore from '../../../state/chatStore';
import { toast } from '../../../lib/toast';

type Device = 'desktop' | 'motion' | 'tablet' | 'mobile';

const SIZES: Record<Device, { w: number | null; label: string; icon: React.ReactNode }> = {
  desktop: { w: null, label: '桌面自适应', icon: <Monitor size={12} /> },
  motion: { w: 960, label: '16:9 动效/大屏', icon: <Clapperboard size={12} /> },
  tablet: { w: 820, label: '平板 (820px)', icon: <Tablet size={12} /> },
  mobile: { w: 390, label: '手机 (390px)', icon: <Smartphone size={12} /> },
};

export interface SelectedDomElement {
  tagName: string;
  selector: string;
  textSnippet: string;
  htmlSnippet: string;
  rect: { x: number; y: number; width: number; height: number };
}

const QUICK_INSPECT_CHIPS = [
  { label: '🎨 调整配色', prompt: '请调整此元素的配色与对比度，使其更加精致现代化' },
  { label: '✏️ 修改文案', prompt: '请润色或更新此区域的文案内容' },
  { label: '📐 间距与圆角', prompt: '请优化此元素的内边距、外间距以及圆角弧度' },
  { label: '✨ 增添动效', prompt: '请为此元素添加平滑微动效（如悬停微缩放或淡入过渡）' },
  { label: '🗑️ 移除此区域', prompt: '请在页面中移除此多余模块' },
];

/**
 * Chrome for HTML / SVG previews:
 * - Device viewport switcher with smooth CSS transitions
 * - Zoom in / Zoom out controls
 * - Interactive Run / Pause script execution toggle
 * - DOM Element Click-to-Inspect & Annotation Mode (inspired by Open Design)
 * - Safe error catcher that alerts on unhandled script exceptions in preview
 */
export default function PreviewFrame({
  children,
  run,
  onToggleRun,
  inspecting,
  onToggleInspect,
  onReload,
  sessionId,
  artifactName,
}: {
  children: React.ReactNode;
  run?: boolean;
  onToggleRun?: () => void;
  inspecting?: boolean;
  onToggleInspect?: () => void;
  onReload?: () => void;
  sessionId?: string;
  artifactName?: string;
}) {
  const [device, setDevice] = useState<Device>('desktop');
  const [zoom, setZoom] = useState(1);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<SelectedDomElement | null>(null);
  const [annotationPrompt, setAnnotationPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const width = SIZES[device].w;

  // Broadcast inspect mode to child iframes
  useEffect(() => {
    const iframes = containerRef.current?.querySelectorAll('iframe');
    if (!iframes) return;
    iframes.forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage(
          { type: 'reizo:set-inspect-mode', enabled: Boolean(inspecting) },
          '*',
        );
      } catch {
        /* cross-origin ignore */
      }
    });
  }, [inspecting]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== 'object') return;

      if (event.data.type === 'reizo:preview-error') {
        const line = event.data.lineno ? ` (行 ${event.data.lineno})` : '';
        setRuntimeError(`${event.data.message}${line}`);
      } else if (event.data.type === 'reizo:element-selected') {
        setSelectedElement(event.data.element as SelectedDomElement);
        setAnnotationPrompt('');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const handleReload = () => {
    setRuntimeError(null);
    setSelectedElement(null);
    onReload?.();
  };

  const buildPrompt = () => {
    if (!selectedElement) return '';
    const target = artifactName ? `产物「${artifactName}」中的元素` : '页面中的元素';
    return [
      `请针对${target}进行修改：`,
      `- 目标标签: <${selectedElement.tagName}>`,
      `- DOM 选择器: \`${selectedElement.selector}\``,
      selectedElement.textSnippet ? `- 当前文字内容: "${selectedElement.textSnippet}"` : null,
      `- 修改要求: ${annotationPrompt.trim() || '优化此区域的视觉效果与交互'}`,
    ]
      .filter(Boolean)
      .join('\n');
  };

  const handleSendToChat = () => {
    if (!sessionId) {
      toast.info('未找到关联会话，已复制指令至剪贴板');
      void handleCopyPrompt();
      return;
    }
    const prompt = buildPrompt();
    chatStore.seedComposer(sessionId, prompt);
    toast.success('已填入对话框，可直接回车发送');
    setSelectedElement(null);
  };

  const handleCopyPrompt = async () => {
    const prompt = buildPrompt();
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success('已复制修改指令');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard error */
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
        {(Object.keys(SIZES) as Device[]).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDevice(d)}
            className={[
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors',
              device === d
                ? 'bg-paper-inset text-ink shadow-xs'
                : 'text-ink-muted hover:bg-paper-inset/60 hover:text-ink',
            ].join(' ')}
            title={SIZES[d].label}
          >
            {SIZES[d].icon}
          </button>
        ))}

        {onToggleRun && (
          <div className="ml-2 flex items-center gap-1 border-l border-line/60 pl-2">
            <button
              type="button"
              onClick={onToggleRun}
              className={[
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-all',
                run
                  ? 'bg-accent/15 text-accent shadow-xs'
                  : 'text-ink-muted hover:bg-paper-inset/60 hover:text-ink',
              ].join(' ')}
              title={run ? '暂停脚本执行（安全静态）' : '开启交互模式（运行 JS / Canvas / GSAP 动画）'}
            >
              <Play size={11} className={run ? 'fill-accent' : ''} />
              <span>{run ? '交互运行中' : '运行脚本'}</span>
            </button>
            {run && onReload && (
              <button
                type="button"
                onClick={handleReload}
                className="rounded p-1 text-ink-muted hover:bg-paper-inset/60 hover:text-ink transition-colors"
                title="重新载入页面并重启动画"
              >
                <RotateCw size={11} />
              </button>
            )}
          </div>
        )}

        {onToggleInspect && (
          <div className="ml-1 flex items-center gap-1 border-l border-line/60 pl-2">
            <button
              type="button"
              onClick={onToggleInspect}
              className={[
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-all',
                inspecting
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-ink-muted hover:bg-paper-inset/60 hover:text-ink',
              ].join(' ')}
              title={inspecting ? '退出点选标注模式' : '开启点选标注：点击页面中任意元素进行精准修改'}
            >
              <Crosshair size={11} className={inspecting ? 'animate-spin-slow' : ''} />
              <span>{inspecting ? '点选中' : '元素标注'}</span>
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 100) / 100))}
            className="rounded p-1 text-ink-muted hover:bg-paper-inset/60 hover:text-ink transition-colors"
            title="缩小"
          >
            <ZoomOut size={12} />
          </button>
          <span className="w-9 text-center text-[11px] tabular-nums text-ink-muted select-none">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 100) / 100))}
            className="rounded p-1 text-ink-muted hover:bg-paper-inset/60 hover:text-ink transition-colors"
            title="放大"
          >
            <ZoomIn size={12} />
          </button>
        </div>
      </div>

      {runtimeError && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertTriangle size={13} className="shrink-0 text-amber-500" />
            <span className="truncate">页面运行异常：{runtimeError}</span>
          </div>
          <button
            type="button"
            onClick={() => setRuntimeError(null)}
            className="shrink-0 rounded p-0.5 hover:bg-amber-500/20 text-ink-muted hover:text-ink"
            title="忽略"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-auto bg-paper-inset/30 p-2">
        <div
          className="mx-auto h-full origin-top bg-paper-raised shadow-sm transition-[width,transform] duration-250 ease-out"
          style={{
            width: width ?? '100%',
            maxWidth: '100%',
            transform: zoom === 1 ? undefined : `scale(${zoom})`,
          }}
        >
          {children}
        </div>

        {/* DOM Element Annotation Floating Overlay */}
        {selectedElement && (
          <div className="absolute bottom-4 left-4 right-4 z-40 mx-auto max-w-xl rounded-xl border border-line bg-paper-raised/95 p-3 shadow-2xl backdrop-blur-md transition-all">
            <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Crosshair size={13} className="shrink-0 text-blue-500" />
                <span className="font-mono text-xs font-semibold text-ink">
                  &lt;{selectedElement.tagName}&gt;
                </span>
                <span className="truncate font-mono text-[11px] text-ink-muted" title={selectedElement.selector}>
                  {selectedElement.selector}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedElement(null)}
                className="shrink-0 rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink"
                title="取消选定"
              >
                <X size={13} />
              </button>
            </div>

            {selectedElement.textSnippet && (
              <div className="mt-2 truncate rounded bg-black/5 dark:bg-white/5 px-2 py-1 font-mono text-[11px] text-ink-muted">
                &ldquo;{selectedElement.textSnippet}&rdquo;
              </div>
            )}

            {/* Quick Prompt Chips */}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {QUICK_INSPECT_CHIPS.map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setAnnotationPrompt((prev) => (prev ? `${prev}，${chip.prompt}` : chip.prompt))}
                  className="rounded-md border border-line/80 bg-paper-inset/60 px-2 py-0.5 text-[11px] text-ink-muted hover:border-accent hover:bg-accent/10 hover:text-accent transition-colors"
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <div className="mt-2.5">
              <textarea
                value={annotationPrompt}
                onChange={(e) => setAnnotationPrompt(e.target.value)}
                placeholder="针对此元素输入修改建议（例如：将按钮改为黑色背景，圆角 8px，悬浮微放大）..."
                className="w-full resize-none rounded-lg border border-line bg-paper-inset/40 p-2 text-xs text-ink placeholder:text-ink-muted/60 focus:border-accent focus:outline-none"
                rows={2}
              />
            </div>

            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleCopyPrompt()}
                className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
              >
                {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copied ? '已复制' : '复制指令'}</span>
              </button>
              <button
                type="button"
                onClick={handleSendToChat}
                className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-xs font-medium text-white shadow-xs hover:bg-accent/90 transition-colors"
              >
                <Send size={12} />
                <span>填入对话框</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
