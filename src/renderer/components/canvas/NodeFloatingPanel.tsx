import { memo, useMemo, useRef, useState, useEffect } from 'react';
import { useStore } from '@xyflow/react';
import { ToggleGroup } from 'radix-ui';
import { Bot, X, Plus, Sparkles, SlidersHorizontal, Loader2 } from 'lucide-react';
import { toast } from '../../lib/toast';
import { Button } from '../ui/button';
import { Field, FieldGroup } from '../ui/field';
import { Separator } from '../ui/separator';
import MentionTextArea, { type MentionTextAreaHandle } from './MentionTextArea';
import { useAssetUrl } from './useAssetUrl';
import { CANVAS_IMAGE_MODELS, CANVAS_VIDEO_MODELS, type CanvasNode } from '../../../shared/canvas';
import CameraDial from './CameraDial';
import type { CameraControl } from '../../../shared/cameraMotion';
import * as canvasStore from '../../state/canvasStore';
import NodePanelViewport from './NodePanelViewport';
import NodePanelSelect from './NodePanelSelect';
import type { CanvasInputSource } from '../../state/canvasInputSources';
import { useSettingsStore } from '../../state/useSettingsStore';
import { mediaCatalogProvider } from '../../lib/modelCatalog';
import { modelVendorDomain } from '../../../shared/providers';

const CONFIGURED_MODEL = '__configured_model__';

export type UpstreamSourceItem = CanvasInputSource;

export interface NodeFloatingPanelProps {
  sessionId: string;
  node: CanvasNode;
  visible: boolean;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onPromptCommit: () => void;
  candidates: CanvasNode[];
  upstreamSources: UpstreamSourceItem[];
  running: boolean;
  onRun: () => void | Promise<void>;
  nodeType?: 'image' | 'video' | 'audio' | 'note';
  autoFocus?: boolean;
  // Audio specific controls
  audioProvider?: string;
  onAudioProviderChange?: (provider: string) => void;
  audioProviders?: Array<{ id: string; name: string; isDefault?: boolean }>;
  audioVoice?: string;
  onAudioVoiceChange?: (voice: string) => void;
  audioVoices?: Array<{ id: string; name: string; tag?: string }>;
  // Note specific controls
  onAgentExpand?: () => void;
  // Image specific controls
  size?: '1024x1024' | '1024x1536' | '1536x1024';
  onSizeChange?: (size: '1024x1024' | '1024x1536' | '1536x1024') => void;
  model?: string;
  onModelChange?: (model: string) => void;
  variationsCount?: 1 | 2 | 4;
  onVariationsCountChange?: (count: 1 | 2 | 4) => void;
  // Video specific controls
  ratio?: '16:9' | '9:16' | '1:1';
  onRatioChange?: (ratio: '16:9' | '9:16' | '1:1') => void;
  duration?: '5s' | '10s';
  onDurationChange?: (duration: '5s' | '10s') => void;
  camera?: CameraControl;
  onCameraChange?: (camera: CameraControl) => void;
}

/** Retains the existing selection gate; only its visible body owns a screen-space portal. */
function NodeFloatingPanel(props: NodeFloatingPanelProps) {
  const { node, visible } = props;
  const dragging = useStore((state) => state.nodeLookup.get(node.id)?.dragging ?? false);
  const [ready, setReady] = useState(false);
  // Hiding the body while dragging must not reset a paid request already in flight.
  const [refining, setRefining] = useState(false);
  const refiningRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || dragging) { setReady(false); return; }
    const timer = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(timer);
  }, [visible, dragging]);
  const refine = async () => {
    if (!props.prompt.trim() || refiningRef.current || props.running) return;
    refiningRef.current = true;
    setRefining(true);
    try {
      const value = await canvasStore.refinePrompt(props.prompt.trim(), props.nodeType === 'video' ? 'video' : 'image');
      props.onPromptChange(value); props.onPromptCommit(); toast.success('已完成提示词润色');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '提示词润色失败'); }
    finally { refiningRef.current = false; setRefining(false); }
  };
  const run = async () => {
    if (submittingRef.current || props.running) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await props.onRun();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '生成请求失败，请重试';
      setSubmitError(message);
      toast.error(message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
  return ready && visible && !dragging ? <NodePanelBody {...props} running={props.running || submitting} onRun={run} submitError={submitError} submitting={submitting} refining={refining} onRefine={refine} /> : null;
}

function NodePanelBody({ sessionId, node, prompt, onPromptChange, onPromptCommit, candidates, upstreamSources, running, onRun,
  nodeType = 'image', autoFocus = false, audioProvider, onAudioProviderChange, audioProviders, audioVoice, onAudioVoiceChange,
  audioVoices, onAgentExpand, size = '1024x1024', onSizeChange, model, onModelChange, variationsCount = 1,
  onVariationsCountChange, ratio = '16:9', onRatioChange, duration = '5s', onDurationChange,
  camera, onCameraChange, refining, onRefine, submitError, submitting }: NodeFloatingPanelProps & { refining: boolean; onRefine: () => Promise<void>; submitError: string | null; submitting: boolean }) {
  const areaRef = useRef<MentionTextAreaHandle>(null);
  const lastSyncedPrompt = useRef(prompt);
  const [boundary, setBoundary] = useState<HTMLDivElement | null>(null);
  const [paramsOpen, setParamsOpen] = useState(false);
  const isVideo = nodeType === 'video';
  const isAudio = nodeType === 'audio';
  const isNote = nodeType === 'note';
  const isImage = !isVideo && !isAudio && !isNote;
  const settings = useSettingsStore(state => state.settings);
  const active = settings.providers.find(provider => provider.id === settings.activeProviderId);
  const mediaProvider = isVideo || isImage ? mediaCatalogProvider(settings) : active;
  const account = mediaProvider?.id === 'reizo-account';
  const videoSupport = account ? mediaProvider.catalog?.video.find(item => item.id === (model || settings.mediaModels?.video))?.video : undefined;
  const durationOptions = [{ value: '5s', label: '5 秒' }, { value: '10s', label: '10 秒' }].filter(item => !account || videoSupport?.minSeconds && videoSupport.maxSeconds && Number.parseInt(item.value) >= videoSupport.minSeconds && Number.parseInt(item.value) <= videoSupport.maxSeconds);
  const ratioOptions = [{ value: '16:9', label: '横屏 16:9' }, { value: '9:16', label: '竖屏 9:16' }, { value: '1:1', label: '方形 1:1' }].filter(item => !account || videoSupport?.aspectRatios?.includes(item.value));
  const typeLabel = isNote ? '文本与提示词' : isVideo ? '视频' : isAudio ? '音频' : '图片';
  const currentModel = model || CONFIGURED_MODEL;
  const models = mediaProvider?.catalog ? mediaProvider.catalog[isVideo ? 'video' : 'image'] : account ? [] : isVideo ? CANVAS_VIDEO_MODELS : CANVAS_IMAGE_MODELS;
  const configuredModel = settings.mediaModels?.[isVideo ? 'video' : 'image'];
  const defaultModelName = models.find(item => item.id === configuredModel)?.name;
  const modelOptions = [{ value: CONFIGURED_MODEL, label: defaultModelName ? `默认 · ${defaultModelName}` : '沿用设置', iconDomain: configuredModel ? modelVendorDomain(configuredModel) : undefined }, ...models.map((item) => ({ value: item.id, label: item.name, iconDomain: modelVendorDomain(item.id) ?? modelVendorDomain(item.name) }))];
  const providerValue = audioProvider || audioProviders?.find((item) => item.isDefault)?.id || audioProviders?.[0]?.id || '';
  const candidateMap = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);
  const refs = useMemo(() => canvasStore.composerRefIds(node).map((id) => candidateMap.get(id) || canvasStore.nodeById(sessionId, id)).filter((item): item is CanvasNode => Boolean(item)), [node, candidateMap, sessionId]);
  const pinned = useMemo(() => refs.map((item) => item.id), [refs]);
  const hasPrompt = upstreamSources.some((item) => item.sourceType === 'note' || item.sourceType === 'agent');
  const hasFrame = upstreamSources.some((item) => item.handleId === 'start_frame' || item.sourceType === 'image' && isVideo);
  const hasParams = isVideo && Boolean(onDurationChange && durationOptions.length || onCameraChange && (!account || videoSupport?.camera)) || isAudio && Boolean(audioVoices?.length && onAudioVoiceChange);
  const canGenerate =Boolean(prompt.trim() || hasPrompt || isVideo && hasFrame);
  const placeholder = hasPrompt ? '补充创作要求…' : hasFrame ? '描述动态与运镜…' : '输入提示词，@ 引用节点';
  useEffect(() => {
    canvasStore.setMentionComposer(sessionId, node.id, (source) => areaRef.current?.insertMentionNode(source));
  }, [sessionId, node.id]);
  useEffect(() => {
    // Opening a panel is a read action. A saved/manual wire must not become an
    // extra history edit merely because this input was mounted.
    if (lastSyncedPrompt.current === prompt) return;
    lastSyncedPrompt.current = prompt;
    const timer = setTimeout(() => { void canvasStore.syncMentionWires(sessionId, node.id, prompt).catch((cause) => toast.error(cause instanceof Error ? cause.message : '引用同步失败')); }, 150);
    return () => clearTimeout(timer);
  }, [prompt, sessionId, node.id]);
  const close = () => {
    onPromptCommit();
    canvasStore.clearMentionComposer(sessionId, node.id);
    canvasStore.stopPickingCanvasRefs(sessionId);
    canvasStore.deselectNode(sessionId, node.id);
    boundary?.parentElement?.focus({ preventScroll: true });
  };
  return <NodePanelViewport node={node} onClose={close} onBoundary={setBoundary}>
    <header className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
      <span className="truncate text-xs font-medium">{node.title || typeLabel}</span>
      {node.title && node.title !== typeLabel ? <span className="shrink-0 text-[11px] text-muted-foreground">{typeLabel}</span> : null}
      {isImage ? <div data-node-panel-editor-slot={node.id} className="ml-auto shrink-0" /> : null}
      <Button type="button" variant="ghost" size="icon-xs" aria-label="收起输入面板" onClick={close} className={isImage ? undefined : 'ml-auto'}><X /></Button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
      <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1">
        {refs.map((reference) => <RefChip key={reference.id} node={reference} disabled={running} onInsert={() => areaRef.current?.insertMentionNode(reference)} onRemove={() => { void canvasStore.removeComposerRef(sessionId, node.id, reference.id).catch((cause) => toast.error(cause instanceof Error ? cause.message : '移除参考失败')); }} />)}
        {!isVideo || !account || videoSupport?.startFrame ? <Button type="button" variant="ghost" size="sm" disabled={running} onClick={() => canvasStore.startPickingCanvasRefs(sessionId, node.id)}><Plus data-icon="inline-start" />参考</Button> : null}
      </div>
      {node.runState === 'error' && node.output?.error ? <p role="alert" className="mb-2 rounded-lg bg-danger/10 px-2.5 py-2 text-xs leading-5 text-danger">{node.output.error}</p> : null}
      <FieldGroup className="gap-3">
        <Field className="gap-1.5">
          <div className="min-h-16 cursor-text select-text rounded-lg bg-muted/35 px-2.5 py-2" onClick={() => areaRef.current?.focus()}>
            <MentionTextArea key={node.id} ref={areaRef} variant="flat" value={prompt} onChange={onPromptChange} onCommit={onPromptCommit}
              candidates={candidates} pinnedNodeIds={pinned} onChipClick={(id) => canvasStore.focusNode(sessionId, id)} placeholder={placeholder}
              minRows={2} autoFocus={autoFocus} className="text-sm leading-6" ariaLabel="提示词" menuPortalContainer={boundary}
              onComposerActive={() => canvasStore.setMentionComposer(sessionId, node.id, (source) => areaRef.current?.insertMentionNode(source))}
              onMentionSelect={(source) => { void canvasStore.connectMention(sessionId, node.id, source).catch((cause) => toast.error(cause instanceof Error ? cause.message : '引用连接失败')); }}
              onMentionRemove={(id) => { void canvasStore.disconnectMention(sessionId, node.id, id).catch((cause) => toast.error(cause instanceof Error ? cause.message : '移除引用失败')); }} />
          </div>
        </Field>
        {paramsOpen && hasParams ? <Field className="gap-2">
          {isVideo && onDurationChange && durationOptions.length ? <PanelChoices label="视频时长" value={duration} options={durationOptions} disabled={running} onChange={(value) => onDurationChange(value as '5s' | '10s')} /> : null}
          {isVideo && onCameraChange && (!account || videoSupport?.camera) ? <div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">运镜</span><CameraDial value={camera} onChange={onCameraChange} portalBoundary={boundary} restoreInputFocus={() => areaRef.current?.focus()} disabled={running} /></div> : null}
          {isAudio && audioVoices?.length && onAudioVoiceChange ? <NodePanelSelect label="音色" value={audioVoice || audioVoices[0].id} options={audioVoices.map((voice) => ({ value: voice.id, label: voice.tag ? `${voice.name} (${voice.tag})` : voice.name }))} onChange={onAudioVoiceChange} disabled={running} boundary={boundary} /> : null}
        </Field> : null}
      </FieldGroup>
    </div>
    <Separator />
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 p-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {isAudio && audioProviders?.length && onAudioProviderChange ? <NodePanelSelect label="音频供应商" value={providerValue} options={audioProviders.map((provider) => ({ value: provider.id, label: provider.name }))} onChange={onAudioProviderChange} disabled={running} boundary={boundary} /> : null}
        {!isNote && !isAudio && onModelChange ? <NodePanelSelect label="生成模型" value={currentModel} options={modelOptions} onChange={(value) => onModelChange(value === CONFIGURED_MODEL ? '' : value)} disabled={running} boundary={boundary} /> : null}
        {!isNote && !isAudio && !onModelChange ? <span className="max-w-44 truncate text-xs text-muted-foreground">{modelOptions.find((item) => item.value === currentModel)?.label || currentModel}</span> : null}
        {isVideo && onRatioChange && ratioOptions.length ? <NodePanelSelect label="画幅比例" value={ratio} options={ratioOptions} onChange={(value) => onRatioChange(value as '16:9' | '9:16' | '1:1')} disabled={running} boundary={boundary} /> : null}
        {isImage && onSizeChange ? <NodePanelSelect label="图片尺寸" value={size} options={[{ value: '1024x1024', label: '方形 1:1' }, { value: '1024x1536', label: '竖幅 2:3' }, { value: '1536x1024', label: '横幅 3:2' }]} onChange={(value) => onSizeChange(value as '1024x1024' | '1024x1536' | '1536x1024')} disabled={running} boundary={boundary} /> : null}
        {isImage && onVariationsCountChange ? <NodePanelSelect label="变体数量" value={String(variationsCount)} options={[1, 2, 4].map((count) => ({ value: String(count), label: `${count} 张` }))} onChange={(value) => onVariationsCountChange(Number(value) as 1 | 2 | 4)} disabled={running} boundary={boundary} /> : null}
        {hasParams ? <Button type="button" variant={paramsOpen ? 'secondary' : 'ghost'} size="icon-sm" aria-label="生成参数" aria-expanded={paramsOpen} disabled={running} onClick={() => setParamsOpen((open) => !open)}><SlidersHorizontal /></Button> : null}
      </div>
      <div className="flex items-center gap-2">
        {(isImage || isVideo) ? <Button type="button" variant="ghost" size="sm" disabled={refining || running || !prompt.trim()} onClick={() => { void onRefine(); }}>{refining ? <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Sparkles data-icon="inline-start" />}{refining ? '润色中' : '润色'}</Button> : null}
        <Button type="button" size="sm" disabled={running || !canGenerate} onClick={isNote && onAgentExpand ? onAgentExpand : () => { void onRun(); }} title={isNote ? 'AI 扩写剧本与提示词' : account ? `生成${typeLabel}，费用按模型实际用量从账号余额结算` : `生成${typeLabel}`}>
          {running ? <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : isNote ? <Bot data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
          {submitting ? '提交中' : running ? '生成中' : isNote ? '扩写' : isImage && variationsCount > 1 ? `生成 ${variationsCount} 张` : '生成'}
        </Button>
      </div>
    </footer>
    {submitError ? <p role="alert" className="px-3 pb-3 text-xs text-destructive">{submitError}</p> : null}
  </NodePanelViewport>;
}

function PanelChoices({ label, value, options, onChange, disabled }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean }) {
  return <ToggleGroup.Root type="single" aria-label={label} value={value} disabled={disabled} onValueChange={(next) => { if (next) onChange(next); }} className="flex flex-wrap gap-1">
    {options.map((option) => <ToggleGroup.Item key={option.value} value={option.value} className="rounded-md border border-border px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-muted disabled:opacity-50">{option.label}</ToggleGroup.Item>)}
  </ToggleGroup.Root>;
}

function RefChip({ node, onInsert, onRemove, disabled }: { node: CanvasNode; onInsert: () => void; onRemove: () => void; disabled?: boolean }) {
  const url = useAssetUrl(node.output?.assets?.[node.output.activeAssetIndex ?? 0] ?? node.output?.assets?.[0]);
  const title = node.title || '节点';
  return <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border p-0.5">
    <button type="button" disabled={disabled} aria-label={`插入 @${title}`} onClick={onInsert} className="flex max-w-40 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
      {url ? <img src={url} alt="" className="size-6 rounded object-cover" /> : null}<span className="truncate">{title}</span>
    </button>
    <Button type="button" variant="ghost" size="icon-xs" disabled={disabled} aria-label={`移除参考${title}`} onClick={onRemove}><X /></Button>
  </div>;
}

export default memo(NodeFloatingPanel);
