import { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, FolderTree, Paperclip, Image as ImageIcon, Video, Type, Volume2, Bot, Sparkles, BoxSelect, Layers } from 'lucide-react';
import { isImeComposingEvent } from '../../lib/ime';
import { cn } from '../../lib/cn';
import { PromptInput } from '../agents/prompt-input';
import ModelPicker from './ModelPicker';
import MentionMenu, { extractMentionQuery } from './MentionMenu';
import SlashPalette, { buildSlashCommands, extractSlashQuery, type SlashCommand } from './SlashPalette';
import PermissionPrompt from './PermissionPrompt';
import AskUserPrompt from './AskUserPrompt';
import QueuePanel from './QueuePanel';
import TodoCard from './TodoCard';
import NextStepStrip from './NextStepStrip';
import ReplyStatusBar, { type ReplyPhase } from './ReplyStatusBar';
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
  replyPhase,
  replyStartedAt,
  replyToolCount = 0,
  interruptRequested = false,
  turnOutcome = null,
  turnError = null,
  loopNotice = null,
  showInterruptBanner = false,
  onRetryTurn,
  onDismissInterrupt,
  compact = false,
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
  replyPhase?: ReplyPhase;
  replyStartedAt?: number;
  replyToolCount?: number;
  interruptRequested?: boolean;
  turnOutcome?: TurnOutcome | null;
  turnError?: string | null;
  loopNotice?: string | null;
  showInterruptBanner?: boolean;
  onRetryTurn?: () => void;
  onDismissInterrupt?: () => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [skillId, setSkillId] = useState<string | undefined>();
  const [attachments, setAttachments] = useState<{ name: string; content: string }[]>([]);
  const replaceFromIdRef = useRef<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const permissionMode = useSettingsStore((s) => s.settings.permissionMode);
  const skills = useSkillStore().skills;
  const interaction = useChatStore((s) => (sessionId ? s.interactionBySession[sessionId] : null)) ?? null;
  const permission = interaction?.kind === 'permission' ? interaction : null;
  const ask = interaction?.kind === 'ask' ? interaction : null;
  const queue = useChatStore((s) => (sessionId ? s.queueBySession[sessionId] : undefined)) ?? [];
  const todos = useChatStore((s) => (sessionId ? s.todosBySession[sessionId] : undefined)) ?? [];
  const lastTextAt = useChatStore((s) => (sessionId ? s.lastTextAtBySession[sessionId] : undefined));
  const lastProgressAt = useChatStore((s) => (sessionId ? s.lastProgressAtBySession[sessionId] : undefined));
  const turnStartedAt = useChatStore((s) => (sessionId ? s.turnStartedAtBySession[sessionId] : undefined));
  const liveToolCount = useChatStore((s) => (sessionId ? s.streamingToolsBySession[sessionId] : undefined))?.filter(
    (part) => part.result === undefined && part.error === undefined,
  ).length ?? 0;
  const seed = useChatStore((s) => (sessionId ? s.composerSeedBySession[sessionId] : undefined));
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
  const slashQuery = extractSlashQuery(draft);
  const slashCommands = buildSlashCommands(skills);
  const activeSkill = skills.find((s) => s.id === skillId);

  useEffect(() => {
    if (!seed) return;
    setDraft(seed.text);
    replaceFromIdRef.current = seed.replaceFromId;
  }, [seed?.nonce, seed?.text, seed?.replaceFromId]);

  function submit() {
    if (!draft.trim() || disabled) return;
    const selectionMentions = unpinnedSelectionNodes.map((n) => `canvas:${n.id}`);
    const allMentions = [...mentions, ...nodeRefs.map((r) => `canvas:${r.id}`), ...selectionMentions];
    onSend(draft, allMentions, { skillId, attachments, replaceFromId: replaceFromIdRef.current });
    setDraft('');
    setMentions([]);
    setSkillId(undefined);
    setAttachments([]);
    replaceFromIdRef.current = undefined;
    if (sessionId) {
      chatStore.clearComposerSeed(sessionId);
      chatStore.clearNodeRefs(sessionId);
      chatStore.setPickingReference(sessionId, false);
    }
  }

  useEffect(() => {
    if (!draft.includes('@')) setMentions([]);
  }, [draft]);

  async function addDroppedFiles(files: FileList | File[]) {
    const next = [...attachments];
    for (const file of Array.from(files)) {
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

  function pickSlash(command: SlashCommand) {
    setSkillId(command.id);
    setDraft('');
  }

  const liveStatus = sessionId && sending ? (
    <ReplyStatusBar
      startedAt={turnStartedAt ?? replyStartedAt}
      toolCount={liveToolCount}
      todos={todos}
      interaction={interaction}
      interruptRequested={interruptRequested}
      recovering={Boolean(turnError?.includes('正在恢复'))}
      lastTextAt={lastTextAt}
      lastProgressAt={lastProgressAt}
    />
  ) : null;

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-paper via-paper to-paper-a0',
        compact ? 'px-3 pb-3 pt-8' : 'px-6 pb-6 pt-16',
      )}
    >
      <div className="pointer-events-auto relative mx-auto max-w-3xl">
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
        {sessionId && <TodoCard items={todos} />}
        {sessionId && !sending && turnOutcome === 'completed' && (
          <NextStepStrip
            sessionId={sessionId}
            onPick={(prompt) => onSend(prompt, [], {})}
          />
        )}
        {sessionId && (
          <QueuePanel items={queue} onRemove={(id) => chatStore.removeQueuedTurn(sessionId, id)} />
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
                chatStore.addNodeRef(sessionId, { id: node.id, label, type: node.type, thumbnail });
              }
            }}
            onPick={(path) => {
              const replaced = draft.replace(/@([^\s@]*)$/, `@${path} `);
              setDraft(replaced);
              setMentions((m) => (m.includes(path) ? m : [...m, path]));
            }}
          />
        )}
        {slashQuery !== null && (
          <SlashPalette query={slashQuery} commands={slashCommands} onPick={pickSlash} />
        )}
        {ask && sessionId ? (
          <>
            {liveStatus ? <div className="mb-2 px-1">{liveStatus}</div> : null}
            <AskUserPrompt pending={ask} onAnswer={(answers) => void chatStore.answerAsk(sessionId, answers)} />
          </>
        ) : permission && sessionId ? (
          <>
            {liveStatus ? <div className="mb-2 px-1">{liveStatus}</div> : null}
            <PermissionPrompt
              permission={permission}
              onRespond={(decision) => void chatStore.answerPermission(sessionId, decision)}
            />
          </>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length) void addDroppedFiles(e.dataTransfer.files);
            }}
          >
            {(activeSkill || attachments.length > 0 || nodeRefs.length > 0 || mentions.length > 0 || unpinnedSelectionNodes.length > 0) && (
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
                      title={`画布节点引用: ${ref.label}`}
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
                        {ref.label}
                      </span>
                      <button
                        type="button"
                        className="flex h-4 w-4 items-center justify-center rounded-full text-ink-muted hover:bg-white/20 hover:text-ink transition-colors cursor-pointer text-[12px] leading-none"
                        onClick={() => chatStore.removeNodeRef(sessionId, ref.id)}
                        title="移除引用"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                {activeSkill && (
                  <span className="rounded-full bg-paper-inset px-2 py-0.5 text-[11px] text-ink">
                    /{activeSkill.id}
                    <button type="button" className="ml-1 text-ink-muted" onClick={() => setSkillId(undefined)}>
                      ×
                    </button>
                  </span>
                )}
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
            <div className="rounded-2xl border border-line bg-paper-raised p-2 shadow-[0_8px_30px_rgba(28,22,18,0.06)]">
              {liveStatus ? <div className="mb-2 px-2">{liveStatus}</div> : null}
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
                loading={Boolean(sending)}
                onStop={onStop}
                disabled={disabled}
                autoFocus={autoFocus}
                minRows={2}
                placeholder="输入消息，/ 调用技能，@ 引用文件…"
                onKeyDown={(e) => {
                  if (isImeComposingEvent(e)) return;
                  if ((mentionQuery !== null || slashQuery !== null) && e.key === 'Enter' && !e.shiftKey) {
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
                  </div>
                }
                actions={[
                  { value: 'attach', label: '上传附件', icon: <Paperclip size={14} /> },
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
                  if (action === 'canvas-pick' && sessionId) chatStore.setPickingReference(sessionId, true);
                  if (action === 'mention') setDraft((d) => (d.endsWith('@') ? d : `${d}@`));
                  if (action === 'tree') onToggleTree?.();
                }}
                className="border-0 bg-transparent p-0"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
