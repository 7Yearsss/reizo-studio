import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DropdownMenu } from 'radix-ui';
import { Clapperboard, Ellipsis, Loader2, ScanSearch } from 'lucide-react';
import type { CanvasNode } from '../../../../shared/canvas';
import { EDIT_META, IMAGE_EDIT_KINDS, type ImageEditKind } from '../../../../shared/canvasImageEdit';
import { cn } from '../../../lib/cn';
import { Tooltip } from '../../ui/Tooltip';
import { CANVAS_MENU_SURFACE } from '../CanvasCommandMenu';
import { EditKindIcon } from './editIcons';
import { openImageEdit } from './openImageEdit';
import { openRegionMark } from './openRegionMark';
import { openAnimate } from './openAnimate';
import { runMatting } from './localMatting';
import useNodeScreenAnchor from '../useNodeScreenAnchor';

const PRIMARY = IMAGE_EDIT_KINDS.filter((k) => EDIT_META[k].primary);
const MORE = IMAGE_EDIT_KINDS.filter((k) => !EDIT_META[k].primary);

export default function ImageNodeEditToolbar({
  sessionId,
  node,
  visible,
}: {
  sessionId: string;
  node: CanvasNode;
  visible: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [mattingBusy, setMattingBusy] = useState(false);
  const mattingInFlight = useRef(false);

  useEffect(() => {
    if (!moreOpen) return;
    const onScroll = () => setMoreOpen(false);
    window.addEventListener('wheel', onScroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', onScroll);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!visible) setMoreOpen(false);
  }, [visible]);

  const activate = (kind: ImageEditKind) => {
    setMoreOpen(false);
    if (kind === 'matting') {
      if (mattingInFlight.current) return;
      // Local ONNX matting is free and ~2s; falls back to the remote AI edit
      // inside runMatting when the model can't load.
      mattingInFlight.current = true;
      setMattingBusy(true);
      void runMatting(sessionId, node).finally(() => { mattingInFlight.current = false; setMattingBusy(false); });
      return;
    }
    openImageEdit({ sessionId, nodeId: node.id, kind, commitMode: 'derive' });
  };

  return visible ? <VisibleImageToolbar sessionId={sessionId} node={node} visible={visible} moreOpen={moreOpen}
    onMoreOpenChange={setMoreOpen} mattingBusy={mattingBusy} activate={activate} /> : null;
}

function VisibleImageToolbar({ sessionId, node, visible, moreOpen, onMoreOpenChange, mattingBusy, activate }: {
  sessionId: string;
  node: CanvasNode;
  visible: boolean;
  moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void;
  mattingBusy: boolean;
  activate: (kind: ImageEditKind) => void;
}) {
  const { canvas, nodeRect, canvasWidth, canvasHeight, railRect, navRect } = useNodeScreenAnchor(node);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 304, height: 38 });
  const [dockTarget, setDockTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const width = content.offsetWidth + 2;
      const height = toolbarRef.current?.offsetHeight || content.offsetHeight + 2;
      if (width <= 2 || height <= 2) return;
      setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    if (toolbarRef.current) observer.observe(toolbarRef.current);
    return () => observer.disconnect();
  }, [canvas, dockTarget]);

  const bottom = Math.min(canvasHeight - 12, navRect ? navRect.top - 12 : canvasHeight - 12);
  const top = Math.max(12, Math.min(nodeRect.top - size.height - 36, bottom - size.height));
  const overlapsRail = railRect && top < railRect.top + railRect.height + 12 && top + size.height > railRect.top - 12;
  const minimumLeft = overlapsRail ? Math.min(canvasWidth - 12, railRect.left + railRect.width + 12) : 12;
  const width = Math.max(0, Math.min(size.width, canvasWidth - minimumLeft - 12));
  const left = Math.max(minimumLeft, Math.min(nodeRect.left + nodeRect.width / 2 - width / 2, canvasWidth - width - 12));
  useLayoutEffect(() => {
    if (!canvas) return;
    let panel: HTMLElement | undefined;
    const resize = new ResizeObserver(() => position());
    const styles = new MutationObserver(() => position());
    const position = () => {
      const boundary = canvas.getBoundingClientRect();
      const rect = panel?.getBoundingClientRect();
      const intersects = rect && left < rect.right - boundary.left + 8 && left + width > rect.left - boundary.left - 8
        && top < rect.bottom - boundary.top + 8 && top + size.height > rect.top - boundary.top - 8;
      const target = intersects ? panel?.querySelector<HTMLElement>('[data-node-panel-editor-slot]') ?? null : null;
      setDockTarget((previous) => previous === target ? previous : target);
    };
    const findPanel = () => {
      resize.disconnect(); styles.disconnect();
      panel = Array.from(canvas.querySelectorAll<HTMLElement>('[data-node-panel-screen]')).find((element) => element.dataset.mentionComposer === node.id);
      if (panel) { resize.observe(panel); styles.observe(panel, { attributes: true, attributeFilter: ['style'] }); }
      position();
    };
    findPanel();
    const children = new MutationObserver(findPanel);
    children.observe(canvas, { childList: true });
    return () => { resize.disconnect(); styles.disconnect(); children.disconnect(); };
  }, [canvas, node.id, left, top, width, size.height]);

  const titleFor = (kind: ImageEditKind) => {
    const meta = EDIT_META[kind];
    return meta.label;
  };

  if (!canvas) return null;
  if (dockTarget) return createPortal(<ImageEditMenu sessionId={sessionId} node={node} canvas={canvas} compact moreOpen={moreOpen}
    onMoreOpenChange={onMoreOpenChange} mattingBusy={mattingBusy} activate={activate} titleFor={titleFor} />, dockTarget);
  return createPortal(
    <div
      ref={toolbarRef}
      role="group"
      aria-label="图片编辑工具"
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        'node-edit-toolbar nodrag nopan nowheel cursor-default absolute z-[7] max-h-full overflow-x-auto overflow-y-hidden overscroll-contain rounded-full border border-border bg-card text-foreground shadow-md whitespace-nowrap',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{ width, left: Math.round(left), top: Math.round(top) }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div ref={contentRef} className="flex w-max items-center gap-0.5 px-1.5 py-1">
      {PRIMARY.map((kind, i) => (
        <Fragment key={kind}>
          {i > 0 ? <span className="mx-0.5 h-3.5 w-px bg-line" /> : null}
          <ToolbarBtn
            kind={kind}
            title={titleFor(kind)}
            busy={kind === 'matting' && mattingBusy}
            onClick={() => activate(kind)}
          />
        </Fragment>
      ))}
      <span className="mx-0.5 h-3.5 w-px bg-line" />
      <Tooltip content="框选区域 → 引用到对话" side="top" wrapperClassName="inline-flex">
        <button
          type="button"
          aria-label="框选区域并引用到对话"
          onClick={() => openRegionMark({ sessionId, nodeId: node.id })}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink hover:bg-paper-inset"
        >
          <ScanSearch size={14} />
        </button>
      </Tooltip>
      <span className="mx-0.5 h-3.5 w-px bg-line" />
      <ImageEditMenu sessionId={sessionId} node={node} canvas={canvas} moreOpen={moreOpen} onMoreOpenChange={onMoreOpenChange}
        mattingBusy={mattingBusy} activate={activate} titleFor={titleFor} />
      </div>
    </div>, canvas,
  );
}

function ImageEditMenu({ sessionId, node, canvas, compact, moreOpen, onMoreOpenChange, mattingBusy, activate, titleFor }: {
  sessionId: string; node: CanvasNode; canvas: HTMLElement; compact?: boolean; moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void; mattingBusy: boolean;
  activate: (kind: ImageEditKind) => void; titleFor: (kind: ImageEditKind) => string;
}) {
  const label = compact ? '图片编辑' : '更多图片编辑';
  return <DropdownMenu.Root open={moreOpen} onOpenChange={onMoreOpenChange} modal={false}>
    <Tooltip content={label} side="top" wrapperClassName="inline-flex">
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={label} className={cn('inline-flex items-center justify-center rounded-md text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', compact ? 'h-6 gap-1 px-2 text-[11px]' : 'h-7 w-7 rounded-full')}>
          <Ellipsis size={14} />{compact ? <span>图片编辑</span> : null}
        </button>
      </DropdownMenu.Trigger>
    </Tooltip>
    <DropdownMenu.Portal container={canvas}>
      <DropdownMenu.Content aria-label={label} side={compact ? 'bottom' : 'top'} align="end" sideOffset={8} collisionBoundary={canvas} collisionPadding={12} loop
        className={cn(CANVAS_MENU_SURFACE, 'nowheel nodrag nopan min-w-[180px] max-w-[var(--radix-dropdown-menu-content-available-width)]')}
        onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        {(compact ? [...PRIMARY, ...MORE] : MORE).map((kind) => <DropdownMenu.Item key={kind} title={titleFor(kind)} disabled={kind === 'matting' && mattingBusy}
          aria-busy={kind === 'matting' && mattingBusy} onSelect={() => activate(kind)} className="flex min-h-9 cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50">
          <EditKindIcon kind={kind} size={13} />{EDIT_META[kind].label}
        </DropdownMenu.Item>)}
        {compact ? <DropdownMenu.Item onSelect={() => { onMoreOpenChange(false); openRegionMark({ sessionId, nodeId: node.id }); }}
          className="flex min-h-9 cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none data-[highlighted]:bg-muted"><ScanSearch size={13} />框选区域并引用到对话</DropdownMenu.Item> : null}
        <div className="my-1 h-px bg-line" />
        <DropdownMenu.Item title="动态图片 · 生成图生视频" onSelect={() => { onMoreOpenChange(false); openAnimate({ sessionId, nodeId: node.id }); }}
          className="flex min-h-9 cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none data-[highlighted]:bg-muted"><Clapperboard size={13} />动态图片</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

function ToolbarBtn({
  kind,
  title,
  busy,
  onClick,
}: {
  kind: ImageEditKind;
  title: string;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={title} side="top" wrapperClassName="inline-flex">
      <button
        type="button"
        aria-label={title}
        aria-busy={busy}
        onClick={onClick}
        disabled={busy}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink hover:bg-paper-inset disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <EditKindIcon kind={kind} size={14} />}
      </button>
    </Tooltip>
  );
}
