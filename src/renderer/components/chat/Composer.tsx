import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { AtSign, Clapperboard, FolderTree, Paperclip, Image as ImageIcon, Video, Type, Volume2, Bot, Sparkles, BoxSelect, Layers, Pin, Wrench } from 'lucide-react';
import { isImeComposingEvent } from '../../lib/ime';
import { cn } from '../../lib/cn';
import { PromptInput } from '../agents/prompt-input';
import ModelPicker from './ModelPicker';
import MentionMenu, { extractMentionQuery } from './MentionMenu';
import SlashPalette, { applySlashArgs, buildSlashCommands, extractSlashQuery, type SlashCommand } from './SlashPalette';
import PendingInteraction from './PendingInteraction';
import QueuePanel from './QueuePanel';
import ComposerDock from './ComposerDock';
import ReplyStatusBar from './ReplyStatusBar';
import InterruptedTurnBanner from './InterruptedTurnBanner';
import SelectField from '../ui/SelectField';
import { useSettingsStore } from '../../state/useSettingsStore';
import { useSkillStore } from '../../state/useSkillStore';
import { useChatStore } from '../../state/useChatStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as settingsStore from '../../state/settingsStore';
import * as chatStore from '../../state/chatStore';
import * as canvasStore from '../../state/canvasStore';
import { getCanvasNodeThumbnail } from '../canvas/canvasThumbnail';
import type { PermissionMode } from '../../../shared/settings';
import type { TurnOutcome } from '../../../shared/stream';

const MODE_LABEL: Record<PermissionMode, string> = {
  ask: '每次询问',
  workspace: '工作区可写',
  full: '全部允许',
};

export default function Composer({
  sessionId,
  disabled,
  sending,
  onSend,
  onStop,
  onToggleTree,
  treeOpen,
  autoFocus = false,
  interruptRequested = false,
  turnOutcome = null,
  turnError = null,
  loopNotice = null,
  showInterruptBanner = false,
  onRetryTurn,
  onRetryStalled,
  onDismissInterrupt,
  compact = false,
  onOverlayHeight,
}: {
  sessionId?: string;
  disabled: boolean;
  sending?: boolean;
  onSend: (
    text: string,
    mentions: string[],
    extra: { skillId?: string; attachments?: { name: string; content: string }[]; replaceFromId?: string },
  ) => void;
  onStop?: () => void;
  onToggleTree?: () => void;
  treeOpen?: boolean;
  autoFocus?: boolean;
  interruptRequested?: boolean;
  turnOutcome?: TurnOutcome | null;
  turnError?: string | null;
  loopNotice?: string | null;
  showInterruptBanner?: boolean;
  onRetryTurn?: () => void;
  /** Kill the stalled live turn and re-run it — shown in the status row. */
  onRetryStalled?: () => void;
  onDismissInterrupt?: () => void;
  compact?: boolean;
  /** Reports the floating overlay's rendered height so the message list can keep enough bottom padding for content to scroll fully clear of the docked cards. */
  onOverlayHeight?: (height: number) => void;
}) {
  const [draft, setDraft] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [localSkillId, setLocalSkillId] = useState<string | undefined>();
  const [attachments, setAttachments] = useState<{ name: string; content: string }[]>([]);
  const replaceFromIdRef = useRef<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const permissionMode = useSettingsStore((s) => s.settings.permissionMode);
  const directorOn = useSettingsStore((s) => (sessionId ? s.settings.directorSessions?.[sessionId] === true : false));
  // Busy-Enter preference (DSH): plain Enter while a turn runs either queues
  // the message for the next turn or steers it into the live one; Ctrl+Enter
  // always takes the opposite lane.
  const busyEnter = useSettingsStore((s) => s.settings.busyEnter);
  const skills = useSkillStore().skills;
  const interaction = useChatStore((s) => (sessionId ? s.interactionBySession[sessionId] : null)) ?? null;
  const queue = useChatStore((s) => (sessionId ? s.queueBySession[sessionId] : undefined)) ?? [];
  const steerPending = useChatStore((s) => (sessionId ? s.steerPendingBySession[sessionId] : undefined)) ?? [];
  const todos = useChatStore((s) => (sessionId ? s.todosBySession[sessionId] : undefined)) ?? [];
  const seed = useChatStore((s) => (sessionId ? s.composerSeedBySession[sessionId] : undefined));
  const storeSkillId = useChatStore((s) => (sessionId ? s.skillBySession[sessionId] : undefined));
  // Pinned skills are session-scoped: once picked (via /, @, or the plugins page)
  // they stay on every message until the chip is removed.
  const skillId = sessionId ? storeSkillId : localSkillId;
  const setSkillId = useCallback(
    (id?: string) => {
      if (sessionId) chatStore.setSessionSkill(sessionId, id);
      else setLocalSkillId(id);
    },
    [sessionId],
  );
  const nodeRefs = useChatStore((s) => (sessionId ? s.nodeRefsBySession[sessionId] : undefined)) ?? [];
  const selectedNodeIds = useCanvasStore((s) => (sessionId ? s.selectedNodeIdsBySession[sessionId] : undefined)) ?? canvasStore.EMPTY_SELECTED_IDS;
  const canvasNodes = useCanvasStore((s) => (sessionId ? s.nodesBySession[sessionId] : undefined)) ?? canvasStore.EMPTY_NODES;

  const activeSelectedNodes = useMemo(() => {
    if (!selectedNodeIds.length || !canvasNodes.length) return [];
    return canvasNodes.filter((n) => selectedNodeIds.includes(n.id));
  }, [selectedNodeIds, canvasNodes]);

  const unpinnedSelectionNodes = useMemo(() => {
    return activeSelectedNodes.filter((n) => !nodeRefs.some((r) => r.id === n.id));
  }, [activeSelectedNodes, nodeRefs]);

  const mentionQuery = extractMentionQuery(draft);
  const slash = extractSlashQuery(draft);
  const slashCommands = buildSlashCommands(skills);
  const activeSkill = skills.find((s) => s.id === skillId);

  useEffect(() => {
    if (!seed) return;
    setDraft(seed.text);
    replaceFromIdRef.current = seed.replaceFromId;
  }, [seed?.nonce, seed?.text, seed?.replaceFromId]);

  function buildSubmitPayload() {
    const selectionMentions = unpinnedSelectionNodes.map((n) => `canvas:${n.id}`);
    const refMentions = nodeRefs.map((r) =>
      r.region
        ? `canvas:${r.id}@r=${[r.region.x, r.region.y, r.region.w, r.region.h].map((v) => v.toFixed(3)).join(',')}`
        : `canvas:${r.id}`,
    );
    return {
      mentions: [...mentions, ...refMentions, ...selectionMentions],
      extra: { skillId, attachments, replaceFromId: replaceFromIdRef.current },
    };
  }

  function resetAfterSubmit() {
    setDraft('');
    setMentions([]);
    // skillId intentionally NOT cleared — a pinned skill applies to the whole session
    setAttachments([]);
    replaceFromIdRef.current = undefined;
    if (sessionId) {
      chatStore.clearComposerSeed(sessionId);
      chatStore.clearNodeRefs(sessionId);
      chatStore.setPickingReference(sessionId, false);
    }
  }

  function submit() {
    if (!draft.trim() || disabled) return;
    const { mentions: allMentions, extra } = buildSubmitPayload();
    // Busy-Enter lane: while a turn runs, Enter follows the user's preference —
    // queue (default, next turn) or steer (inject into the live turn).
    if (sessionId && sending && !interaction && busyEnter === 'steer') {
      void chatStore.steerNow(sessionId, draft, allMentions, extra);
    } else {
      onSend(draft, allMentions, extra);
    }
    resetAfterSubmit();
  }

  /** Ctrl/Cmd+Enter while a turn is live — the opposite of the busyEnter lane. */
  function submitNow() {
    if (!draft.trim() || disabled || !sessionId) return;
    const { mentions: allMentions, extra } = buildSubmitPayload();
    if (busyEnter === 'steer') {
      // Opposite lane = queue it like a normal send-while-busy.
      onSend(draft, allMentions, extra);
    } else {
      void chatStore.steerNow(sessionId, draft, allMentions, extra);
    }
    resetAfterSubmit();
  }

  /** Empty draft + Ctrl/Cmd+Enter while busy — steer every queued message at once (DSH). */
  function steerAllQueued() {
    if (!sessionId || queue.length === 0) return;
    void chatStore.steerAllQueued(sessionId);
  }

  /** Move a queued message back into the composer for editing. */
  function editQueuedItem(item: (typeof queue)[number]) {
    if (!sessionId) return;
    chatStore.removeQueuedTurn(sessionId, item.id);
    setDraft((prev) => (prev ? `${prev}\n${item.text}` : item.text));
    focusComposer();
  }

  /** ArrowUp at the start of the box recalls every queued message (Claude Code style). */
  function recallQueuedMessages(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!sessionId || queue.length === 0) return false;
    const cursor = e.currentTarget.selectionStart ?? 0;
    if (draft.slice(0, cursor).includes('\n')) return false;
    const items = chatStore.recallQueue(sessionId);
    if (items.length === 0) return false;
    const recalled = items.map((i) => i.text).join('\n');
    setDraft((prev) => (prev ? `${recalled}\n${prev}` : recalled));
    return true;
  }

  useEffect(() => {
    if (!draft.includes('@')) setMentions([]);
  }, [draft]);

  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepth = useRef(0);

  async function addDroppedFiles(files: FileList | File[]) {
    const next = [...attachments];
    for (const file of Array.from(files)) {
      // Images land on this session's canvas as a node and get @-referenced in
      // the draft — the composer text path can't carry binaries.
      if (sessionId && file.type.startsWith('image/')) {
        try {
          const nodes = canvasStore.getSnapshot().nodesBySession[sessionId] ?? [];
          const right = nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
          const node = await canvasStore.importImage(sessionId, file, { x: (right || 0) + 40, y: 60 });
          if (node) {
            const p = (node.params as Record<string, unknown>) ?? {};
            chatStore.addNodeRef(sessionId, {
              id: node.id,
              label: (node.title || file.name).toString().slice(0, 24),
              type: 'image',
              thumbnail: getCanvasNodeThumbnail(node) ?? (p.imageUrl as string | undefined),
            });
          }
        } catch {
          /* import failed — nothing to attach */
        }
        continue;
      }
      try {
        const filePath = window.reizo.getPathForFile(file);
        const read = await window.reizo.readDroppedFile(filePath);
        next.push({ name: read.name, content: read.content });
      } catch {
        if (file.type.startsWith('text') || file.name.endsWith('.md') || file.name.endsWith('.json')) {
          next.push({ name: file.name, content: await file.text() });
        }
      }
    }
    setAttachments(next);
  }

  const composerBodyRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !onOverlayHeight) return;
    onOverlayHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => onOverlayHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [onOverlayHeight]);

  const focusComposer = useCallback(() => {
    composerBodyRef.current?.querySelector('textarea')?.focus();
  }, []);

  function pickSlash(command: SlashCommand, args: string) {
    setSkillId(command.id);
    setDraft(applySlashArgs(command.prompt, args));
    // The palette button steals focus on click — hand it back to the textarea
    // so the skill chip feels like an inline token you can keep typing after.
    window.setTimeout(focusComposer, 0);
  }

  const liveStatus = sessionId && sending ? (
    <LiveStatusBar
      sessionId={sessionId}
      todos={todos}
      interaction={interaction}
      interruptRequested={interruptRequested}
      recovering={Boolean(turnError?.includes('正在恢复'))}
      // Always offer stop while a turn is live — the composer button switches to
      // queue/send once the user has typed, so this stays the persistent interrupt.
      onStop={onStop}
      onRetryStalled={onRetryStalled}
      skillName={activeSkill?.name}
    />
  ) : null;

  return (
    <div
      ref={overlayRef}
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-paper via-paper to-paper-a0',
        compact ? 'px-3 pb-3 pt-8' : 'px-6 pb-6 pt-16',
      )}
    >
      <div ref={composerBodyRef} className="pointer-events-auto relative mx-auto max-w-3xl">
        {!sending && turnOutcome === 'error' && turnError && (
          <div className="mb-2 flex items-center gap-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-ink" role="alert">
            <span className="flex-1">回复失败：{turnError}</span>
            {onRetryTurn && (
              <button
                type="button"
                onClick={onRetryTurn}
                className="inline-flex items-center gap-1 rounded-full bg-paper-inset px-2.5 py-1 text-[12px] text-ink transition-colors hover:bg-paper"
              >
                重试
              </button>
            )}
          </div>
        )}
        {!sending && showInterruptBanner && onRetryTurn && onDismissInterrupt && (
          <InterruptedTurnBanner onRetry={onRetryTurn} onDismiss={onDismissInterrupt} />
        )}
        {loopNotice && (
          <div
            className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-ink"
            role="status"
          >
            ⚠ {loopNotice}
          </div>
        )}
        {sessionId && <div className="mb-2"><PendingInteraction sessionId={sessionId} /></div>}
        {sessionId && (
          <QueuePanel
            items={queue}
            steers={steerPending}
            onRemove={(id) => chatStore.removeQueuedTurn(sessionId, id)}
            onEdit={editQueuedItem}
            onSendNow={(item) => void chatStore.sendQueuedNow(sessionId, item.id)}
          />
        )}
        {mentionQuery !== null && (
          <MentionMenu
            query={mentionQuery}
            sessionId={sessionId}
            onPickNode={(node) => {
              const replaced = draft.replace(/@([^\s@]*)$/, '');
              setDraft(replaced);
              if (sessionId) {
                const p = (node.params as Record<string, unknown>) ?? {};
                const label = (node.title || p.prompt || p.instruction || p.content || node.type).toString().slice(0, 24);
                const thumbnail = (node as { assets?: { url: string }[] }).assets?.[0]?.url || (p.imageUrl as string | undefined) || (p.videoUrl as string | undefined);
                chatStore.addNodeRef(sessionId, { id: node.id, label, type: node.type, thumbnail }); // context only — never wires the canvas
              }
            }}
            onPick={(path) => {
              const replaced = draft.replace(/@([^\s@]*)$/, `@${path} `);
              setDraft(replaced);
              setMentions((m) => (m.includes(path) ? m : [...m, path]));
            }}
            onPickSkill={(skill) => {
              setDraft(draft.replace(/@([^\s@]*)$/, ''));
              setSkillId(skill.id);
              window.setTimeout(focusComposer, 0);
            }}
          />
        )}
        {slash !== null && (
          <SlashPalette query={slash.query} args={slash.args} commands={slashCommands} onPick={pickSlash} />
        )}
        <div
          className="relative"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDragEnter={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              dragDepth.current += 1;
              setDraggingFiles(true);
            }
          }}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDraggingFiles(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragDepth.current = 0;
            setDraggingFiles(false);
            if (e.dataTransfer.files.length) void addDroppedFiles(e.dataTransfer.files);
          }}
        >
            {sessionId && <ComposerDock todos={todos} />}
            {(attachments.length > 0 || nodeRefs.length > 0 || mentions.length > 0 || unpinnedSelectionNodes.length > 0) && (
              <div className={cn("mb-2 flex flex-wrap gap-1.5", compact && "max-h-24 overflow-y-auto pr-0.5")}>
                {sessionId && unpinnedSelectionNodes.length > 0 && (
                  <div
                    className="group inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 py-0.5 pl-1.5 pr-2 text-xs shadow-sm backdrop-blur-sm transition-all hover:border-sky-500/60 hover:bg-sky-500/15"
                    title="画布当前选区 · 发送消息时自动作为上下文带入"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-sky-500/20 text-sky-400 shrink-0" title="画布选中">
                      <BoxSelect size={12} />
                    </span>
                    <div className="flex items-center -space-x-1.5 hover:space-x-1 transition-all overflow-hidden py-0.5">
                      {unpinnedSelectionNodes.map((node) => {
                        const p = (node.params as Record<string, unknown>) ?? {};
                        const label = (node.title || p.prompt || p.instruction || p.content || node.type).toString().slice(0, 20);
                        const thumbnail = getCanvasNodeThumbnail(node) || (p.imageUrl as string | undefined) || (p.videoUrl as string | undefined);
                        return (
                          <div
                            key={node.id}
                            className="relative group/thumb shrink-0"
                            title={`画布选中: ${label}`}
                          >
                            {thumbnail ? (
                              <img
                                src={thumbnail}
                                alt={label}
                                className="h-5 w-5 rounded object-cover border border-white/20 shadow-xs transition-transform group-hover/thumb:scale-110"
                              />
                            ) : (
                              <span className="flex h-5 w-5 items-center justify-center rounded border border-sky-400/30 bg-sky-950/60 text-sky-200 text-[9px] font-medium uppercase">
                                {node.type.slice(0, 2)}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                canvasStore.deselectNode(sessionId, node.id);
                              }}
                              className="absolute -top-1 -right-1 hidden group-hover/thumb:flex h-3 w-3 items-center justify-center rounded-full bg-black/80 text-white hover:bg-black text-[9px] leading-none"
                              title="取消选中此节点"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <span className="text-[11px] font-medium text-sky-200">
                      选区 {unpinnedSelectionNodes.length}
                    </span>
                    <button
                      type="button"
                      className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-sky-300 hover:bg-sky-400/20 hover:text-white transition-colors cursor-pointer"
                      title="固定为引用 · 之后可继续点选其他节点逐个累积"
                      onClick={() => {
                        if (!sessionId) return;
                        for (const node of unpinnedSelectionNodes) {
                          const p = (node.params as Record<string, unknown>) ?? {};
                          const label = (node.title || p.prompt || p.instruction || p.content || node.type).toString().slice(0, 24);
                          const thumbnail = getCanvasNodeThumbnail(node) || (p.imageUrl as string | undefined) || (p.videoUrl as string | undefined);
                          chatStore.addNodeRef(sessionId, { id: node.id, label, type: node.type, thumbnail });
                        }
                      }}
                    >
                      <Pin size={11} />
                    </button>
                    <button
                      type="button"
                      className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-sky-300 hover:bg-sky-400/20 hover:text-white transition-colors cursor-pointer text-[12px] leading-none"
                      onClick={() => canvasStore.clearSelection(sessionId)}
                      title="清空画布选区"
                    >
                      ×
                    </button>
                  </div>
                )}
                {mentions.map((m) => (
                  <span key={m} className="rounded-full bg-paper-inset px-2 py-0.5 text-[11px] text-ink">
                    @{m.split(/[/\\]/).pop() || m}
                    <button
                      type="button"
                      className="ml-1 text-ink-muted"
                      onClick={() => setMentions((items) => items.filter((item) => item !== m))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {sessionId &&
                  nodeRefs.map((ref) => (
                    <span
                      key={ref.id}
                      className="group inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 py-0.5 pl-1 pr-1.5 text-xs text-ink shadow-sm backdrop-blur-sm transition-all hover:border-accent/60 hover:bg-accent/15"
                      title={ref.region ? `画布节点区域引用: ${ref.label}` : `画布节点引用: ${ref.label}`}
                    >
                      {ref.thumbnail ? (
                        <img
                          src={ref.thumbnail}
                          alt={ref.label}
                          className="h-5 w-5 rounded object-cover border border-white/10 shrink-0"
                        />
                      ) : (
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-accent/20 text-accent shrink-0">
                          {ref.type === 'image' ? (
                            <ImageIcon size={11} />
                          ) : ref.type === 'video' ? (
                            <Video size={11} />
                          ) : ref.type === 'audio' ? (
                            <Volume2 size={11} />
                          ) : ref.type === 'note' ? (
                            <Type size={11} />
                          ) : ref.type === 'agent' ? (
                            <Bot size={11} />
                          ) : (
                            <Sparkles size={11} />
                          )}
                        </span>
                      )}
                      <span className="max-w-[120px] truncate text-[11px] font-medium text-ink">
                        {ref.label}{ref.region ? ' · 区域' : ''}
                      </span>
                      <button
                        type="button"
                        className="flex h-4 w-4 items-center justify-center rounded-full text-ink-muted hover:bg-white/20 hover:text-ink transition-colors cursor-pointer text-[12px] leading-none"
                        onClick={() => chatStore.removeNodeRef(sessionId, ref.id, ref.region)}
                        title="移除引用"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                {attachments.map((file) => (
                  <span key={file.name} className="rounded-full bg-paper-inset px-2 py-0.5 text-[11px] text-ink">
                    {file.name}
                    <button
                      type="button"
                      className="ml-1 text-ink-muted"
                      onClick={() => setAttachments((items) => items.filter((item) => item.name !== file.name))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className={cn(
              'rounded-2xl border bg-paper-raised p-2 shadow-[0_8px_30px_rgba(28,22,18,0.06)] transition-colors',
              draggingFiles ? 'border-accent ring-2 ring-accent/40' : 'border-line',
            )}>
              {liveStatus ? <div className="mb-2 px-2">{liveStatus}</div> : null}
              {activeSkill && (
                <div className="mb-1.5 px-1">
                  <span
                    className="pop-in inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 py-0.5 pl-1 pr-1 text-xs text-ink shadow-sm transition-colors hover:border-accent/60"
                    title={`本会话持续生效 · ${activeSkill.description || activeSkill.id}（退格键可移除）`}
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-accent/20 text-accent">
                      <Wrench size={11} />
                    </span>
                    <span className="font-mono text-[11px] font-medium">/{activeSkill.id}</span>
                    <span className="max-w-[160px] truncate text-[11px] text-ink-muted">
                      {activeSkill.name}
                    </span>
                    <button
                      type="button"
                      className="flex h-4 w-4 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-accent/20 hover:text-ink"
                      onClick={() => {
                        setSkillId(undefined);
                        focusComposer();
                      }}
                      title="退出技能"
                    >
                      ×
                    </button>
                  </span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void addDroppedFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <PromptInput
                value={draft}
                onValueChange={setDraft}
                onSubmit={() => submit()}
                loading={Boolean(sending && !interaction)}
                onStop={onStop}
                onSendNow={() => submitNow()}
                onEmptySendNow={queue.length > 0 ? steerAllQueued : undefined}
                busySendTitle={
                  busyEnter === 'steer'
                    ? 'Enter 插话（本轮生效）· Ctrl+Enter 排队'
                    : 'Enter 排队 · Ctrl+Enter 插话（本轮生效）'
                }
                disabled={disabled}
                autoFocus={autoFocus}
                minRows={2}
                placeholder={
                  sending && !interaction
                    ? busyEnter === 'steer'
                      ? '回复中 — Enter 插话（本轮生效），Ctrl+Enter 排队'
                      : '回复中 — Enter 排队，Ctrl+Enter 插话（本轮生效）'
                    : activeSkill
                      ? `技能 /${activeSkill.id} 生效中 — 直接描述任务，退格或 × 退出`
                      : '输入消息，/ 调用技能，@ 引用文件…'
                }
                onKeyDown={(e) => {
                  if (isImeComposingEvent(e)) return;
                  if ((mentionQuery !== null || slash !== null) && e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    return;
                  }
                  // Atomic chip delete: Backspace on an empty draft unpins the
                  // skill, mirroring how Cursor/Linear remove context chips.
                  if (e.key === 'Backspace' && draft === '' && skillId) {
                    e.preventDefault();
                    setSkillId(undefined);
                  }
                  // ↑ at the start of the box pulls queued messages back in for editing.
                  if (e.key === 'ArrowUp' && recallQueuedMessages(e)) {
                    e.preventDefault();
                  }
                }}
                leadingAction={
                  <div className="flex min-w-0 shrink items-center gap-1">
                    <ModelPicker compact={compact} />
                    {compact ? (
                      <SelectField
                        ariaLabel="权限模式"
                        value={permissionMode}
                        options={(Object.keys(MODE_LABEL) as PermissionMode[]).map((mode) => ({
                          value: mode,
                          label: mode === 'full' ? '允许' : mode === 'workspace' ? '工作区' : '询问',
                          hint: MODE_LABEL[mode],
                        }))}
                        onChange={(mode) =>
                          void settingsStore.patchSettings({ permissionMode: mode as PermissionMode })
                        }
                        className="max-w-[76px] px-1.5 py-1 text-[11px]"
                      />
                    ) : (
                      <SelectField
                        ariaLabel="权限模式"
                        value={permissionMode}
                        options={(Object.keys(MODE_LABEL) as PermissionMode[]).map((mode) => ({
                          value: mode,
                          label: MODE_LABEL[mode],
                        }))}
                        onChange={(mode) =>
                          void settingsStore.patchSettings({ permissionMode: mode as PermissionMode })
                        }
                        className="max-w-[120px]"
                      />
                    )}
                    {sessionId ? (
                      <button
                        type="button"
                        title={directorOn ? '导演模式：开 —— agent 会主动在画布上规划' : '导演模式：关 —— 仅在你明确要求时才碰画布'}
                        aria-pressed={directorOn}
                        onClick={(e) => {
                          void settingsStore.patchSettings({
                            directorSession: { sessionId, enabled: !directorOn },
                          });
                          // Drop focus so Enter in the composer doesn't re-toggle it.
                          e.currentTarget.blur();
                        }}
                        className={cn(
                          'flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors',
                          directorOn
                            ? 'bg-accent/15 text-accent'
                            : 'text-ink-muted hover:bg-paper-hover hover:text-ink',
                        )}
                      >
                        <Clapperboard size={13} />
                        导演
                      </button>
                    ) : null}
                  </div>
                }
                actions={[
                  { value: 'attach', label: '上传附件', icon: <Paperclip size={14} /> },
                  { value: 'skill', label: '使用技能', description: '等同输入 /', icon: <Wrench size={14} /> },
                  ...(sessionId
                    ? [{ value: 'canvas-pick', label: '从画布引用 (Insert from canvas)', description: '点击画布节点加入引用', icon: <Layers size={14} /> }]
                    : []),
                  ...(workspacePath
                    ? [{ value: 'mention', label: '引用文件', description: '插入 @ 路径', icon: <AtSign size={14} /> }]
                    : []),
                  ...(onToggleTree && workspacePath
                    ? [{ value: 'tree', label: '工作区文件', icon: <FolderTree size={14} /> }]
                    : []),
                ]}
                onAction={(action) => {
                  if (action === 'attach') fileInputRef.current?.click();
                  if (action === 'skill') {
                    setDraft((d) => (d === '' ? '/' : d));
                    window.setTimeout(focusComposer, 0);
                  }
                  if (action === 'canvas-pick' && sessionId) chatStore.setPickingReference(sessionId, true);
                  if (action === 'mention') setDraft((d) => (d.endsWith('@') ? d : `${d}@`));
                  if (action === 'tree') onToggleTree?.();
                }}
                className="border-0 bg-transparent p-0"
              />
            </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Live reply status subscribes to the per-token progress slices
 * (lastTextAt / lastProgressAt) itself so stream commits don't re-render the
 * whole composer — textarea included — 20 times a second.
 */
function LiveStatusBar({
  sessionId,
  todos,
  interaction,
  interruptRequested,
  recovering,
  onStop,
  onRetryStalled,
  skillName,
}: {
  sessionId: string;
  todos: ComponentProps<typeof ReplyStatusBar>['todos'];
  interaction: ComponentProps<typeof ReplyStatusBar>['interaction'];
  interruptRequested: boolean;
  recovering: boolean;
  onStop?: () => void;
  onRetryStalled?: () => void;
  skillName?: string;
}) {
  const lastTextAt = useChatStore((s) => s.lastTextAtBySession[sessionId]);
  const lastProgressAt = useChatStore((s) => s.lastProgressAtBySession[sessionId]);
  const turnStartedAt = useChatStore((s) => s.turnStartedAtBySession[sessionId]);
  const liveToolCount =
    useChatStore((s) => s.streamingToolsBySession[sessionId])?.filter(
      (part) => part.result === undefined && part.error === undefined,
    ).length ?? 0;
  return (
    <ReplyStatusBar
      startedAt={turnStartedAt}
      toolCount={liveToolCount}
      todos={todos}
      interaction={interaction}
      interruptRequested={interruptRequested}
      recovering={recovering}
      lastTextAt={lastTextAt}
      lastProgressAt={lastProgressAt}
      onStop={onStop}
      onRetry={onRetryStalled}
      skillName={skillName}
    />
  );
}
