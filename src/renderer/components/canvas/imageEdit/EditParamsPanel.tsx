import { useEffect, useState } from 'react';
import { useStore } from '@xyflow/react';
import { Loader2, Play, RotateCcw } from 'lucide-react';
import type { CanvasImageParams, CanvasNode } from '../../../../shared/canvas';
import {
  EDIT_META,
  editNodeTitle,
  isLocalEdit,
  type ImageEditKind,
  type ImageEditParams,
} from '../../../../shared/canvasImageEdit';
import { estimateNodeCost } from '../../../../shared/canvasPricing';
import { cn } from '../../../lib/cn';
import * as canvasStore from '../../../state/canvasStore';
import EditSlider from './EditSlider';

const DIRS: Array<{ id: NonNullable<ImageEditParams['lightDir']>; label: string }> = [
  { id: 'left', label: '左侧' },
  { id: 'top', label: '顶部' },
  { id: 'right', label: '右侧' },
  { id: 'front', label: '前方' },
  { id: 'bottom', label: '底部' },
  { id: 'back', label: '后方' },
];

export default function EditParamsPanel({
  sessionId,
  node,
  visible,
  running,
  onRedraw,
}: {
  sessionId: string;
  node: CanvasNode;
  visible: boolean;
  running: boolean;
  onRedraw: (kind: ImageEditKind) => void;
}) {
  const zoom = useStore((s) => s.transform[2]) || 1;
  const floatScale = Math.min(10, Math.max(0.5, 1 / zoom));
  const isDragging = useStore((s) => s.nodes.find((n) => n.id === node.id)?.dragging ?? false);
  const [shouldRender, setShouldRender] = useState(false);

  const params = node.params as CanvasImageParams;
  const edit = params.edit;
  const [draft, setDraft] = useState<ImageEditParams>(edit?.params ?? {});
  const [instruction, setInstruction] = useState(edit?.instruction ?? '');

  useEffect(() => {
    if (!visible || isDragging) {
      setShouldRender(false);
      return;
    }
    const timer = setTimeout(() => setShouldRender(true), 80);
    return () => clearTimeout(timer);
  }, [visible, isDragging]);

  useEffect(() => {
    setDraft(edit?.params ?? {});
    setInstruction(edit?.instruction ?? '');
  }, [edit?.kind, edit?.instruction, edit?.params]);

  if (!shouldRender || !edit) return null;

  const kind = edit.kind;
  const canRerun = !isLocalEdit(kind);
  const cost = estimateNodeCost(node);

  const apply = async (rerun: boolean) => {
    await canvasStore.reviseImageEdit(
      sessionId,
      node.id,
      { params: draft, instruction: instruction.trim() || undefined },
      { rerun },
    );
  };

  return (
    <div
      className="nodrag nopan nowheel absolute top-full left-1/2 z-40 mt-2.5 cursor-default pointer-events-auto"
      style={{
        transform: `translateX(-50%) scale(${floatScale})`,
        transformOrigin: 'top center',
        width: 360,
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col gap-3 rounded-2xl border border-line/50 bg-[#161618]/95 p-3 text-xs text-ink shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-ink-muted">编辑参数 · {editNodeTitle(kind)}</span>
          {canRerun ? <span className="text-[10px] text-ink-muted/70">~{cost} 点</span> : null}
        </div>

        {kind === 'relight' ? <RelightFields value={draft} onChange={setDraft} /> : null}
        {kind === 'multiAngle' ? <MultiAngleFields value={draft} onChange={setDraft} /> : null}
        {kind === 'enhance' ? <EnhanceFields value={draft} onChange={setDraft} /> : null}
        {kind === 'inpaint' ? (
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder="描述你想改变什么..."
            className="w-full resize-none rounded-lg border border-line/50 bg-black/30 px-2 py-1.5 text-[12px] text-ink outline-none"
          />
        ) : null}

        {kind === 'split' ? (
          <p className="text-[11px] text-ink-muted">切分结果已落在本节点，可在源图上再次使用「快速切分」。</p>
        ) : null}

        <div className="flex items-center gap-1.5">
          {EDIT_META[kind].needsMask || EDIT_META[kind].needsCrop || kind === 'annotate' || kind === 'resize' || kind === 'outpaint' ? (
            <button
              type="button"
              onClick={() => onRedraw(kind)}
              className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink hover:bg-paper-inset"
            >
              <RotateCcw size={11} />
              重新绘制
            </button>
          ) : null}
          {canRerun ? (
            <button
              type="button"
              disabled={running}
              onClick={() => void apply(true)}
              className={cn(
                'ml-auto inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-ink disabled:opacity-40',
              )}
            >
              {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} className="fill-current" />}
              重新生成
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void apply(false)}
              className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink hover:bg-paper-inset"
            >
              保存参数
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RelightFields({
  value,
  onChange,
}: {
  value: ImageEditParams;
  onChange: (next: ImageEditParams) => void;
}) {
  const patch = (p: Partial<ImageEditParams>) => onChange({ ...value, ...p });
  return (
    <div className="flex flex-col gap-2">
      <EditSlider
        label="亮度"
        value={value.brightness ?? 50}
        display={`${value.brightness ?? 50}%`}
        min={0}
        max={100}
        onChange={(n) => patch({ brightness: n })}
      />
      <EditSlider
        label="色温"
        value={value.colorTempK ?? 5600}
        display={`${value.colorTempK ?? 5600}K`}
        min={2000}
        max={10000}
        step={100}
        onChange={(n) => patch({ colorTempK: n })}
      />
      <div className="grid grid-cols-3 gap-1">
        {DIRS.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => patch({ lightDir: d.id })}
            className={
              (value.lightDir ?? 'front') === d.id
                ? 'rounded-md bg-accent/20 py-1 text-[11px] text-accent'
                : 'rounded-md py-1 text-[11px] text-ink-muted hover:bg-paper-inset'
            }
          >
            {d.label}
          </button>
        ))}
      </div>
      <label className="flex items-center justify-between text-[11px] text-ink-muted">
        轮廓光
        <input
          type="checkbox"
          checked={Boolean(value.rimLight)}
          onChange={(e) => patch({ rimLight: e.target.checked })}
        />
      </label>
    </div>
  );
}

function MultiAngleFields({
  value,
  onChange,
}: {
  value: ImageEditParams;
  onChange: (next: ImageEditParams) => void;
}) {
  const patch = (p: Partial<ImageEditParams>) => onChange({ ...value, ...p });
  const z = value.zoom ?? 0;
  return (
    <div className="flex flex-col gap-2">
      <EditSlider
        label="旋转"
        value={value.rotateDeg ?? 0}
        display={`${value.rotateDeg ?? 0}°`}
        min={-180}
        max={180}
        onChange={(n) => patch({ rotateDeg: n })}
      />
      <EditSlider
        label="倾斜"
        value={value.tiltDeg ?? 0}
        display={`${value.tiltDeg ?? 0}°`}
        min={-90}
        max={90}
        onChange={(n) => patch({ tiltDeg: n })}
      />
      <EditSlider
        label="缩放"
        value={z}
        display={z === 0 ? '无' : `${z > 0 ? '+' : ''}${z * 10}%`}
        min={-10}
        max={10}
        onChange={(n) => patch({ zoom: n })}
      />
      <label className="flex items-center justify-between text-[11px] text-ink-muted">
        广角镜头
        <input
          type="checkbox"
          checked={Boolean(value.wideAngle)}
          onChange={(e) => patch({ wideAngle: e.target.checked })}
        />
      </label>
    </div>
  );
}

function EnhanceFields({
  value,
  onChange,
}: {
  value: ImageEditParams;
  onChange: (next: ImageEditParams) => void;
}) {
  const patch = (p: Partial<ImageEditParams>) => onChange({ ...value, ...p });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {([2, 4] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => patch({ scale: s })}
            className={
              (value.scale ?? 2) === s
                ? 'flex-1 rounded-md bg-accent/20 py-1 text-[11px] text-accent'
                : 'flex-1 rounded-md py-1 text-[11px] text-ink-muted hover:bg-paper-inset'
            }
          >
            {s}×
          </button>
        ))}
      </div>
      <EditSlider
        label="强度"
        value={value.strength ?? 50}
        display={`${value.strength ?? 50}`}
        min={0}
        max={100}
        onChange={(n) => patch({ strength: n })}
      />
    </div>
  );
}
