import { useEffect, useRef, useState } from 'react';
import { AtSign, FolderTree, Paperclip } from 'lucide-react';
import { isImeComposingEvent } from '../../lib/ime';
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
import * as settingsStore from '../../state/settingsStore';
import * as chatStore from '../../state/chatStore';
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
    const allMentions = [...mentions, ...nodeRefs.map((r) => `canvas:${r.id}`)];
    onSend(draft, allMentions, { skillId, attachments, replaceFromId: replaceFromIdRef.current });
    setDraft('');
    setMentions([]);
    setSkillId(undefined);
    setAttachments([]);
    replaceFromIdRef.current = undefined;
    if (sessionId) {
      chatStore.clearComposerSeed(sessionId);
      chatStore.clearNodeRefs(sessionId);
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
    <div className="pointer-events-none absolute inset-x-0 bottom-0 px-6 pt-16 pb-6 bg-gradient-to-t from-paper via-paper to-paper-a0">
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
                const label = (node.title || (node.params as Record<string, string>)?.prompt || node.type).slice(0, 24);
                chatStore.addNodeRef(sessionId, { id: node.id, label });
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
            {(activeSkill || attachments.length > 0 || nodeRefs.length > 0 || mentions.length > 0) && (
              <div className="mb-2 flex flex-wrap gap-1.5">
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
                    <span key={ref.id} className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                      ◇ {ref.label}
                      <button
                        type="button"
                        className="ml-1 text-accent/60"
                        onClick={() => chatStore.removeNodeRef(sessionId, ref.id)}
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
                  <div className="flex min-w-0 items-center gap-1">
                    <ModelPicker />
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
                  </div>
                }
                actions={[
                  { value: 'attach', label: '附件', icon: <Paperclip size={14} /> },
                  ...(workspacePath
                    ? [{ value: 'mention', label: '引用文件', description: '插入 @ 路径', icon: <AtSign size={14} /> }]
                    : []),
                  ...(onToggleTree && workspacePath
                    ? [{ value: 'tree', label: '工作区文件', icon: <FolderTree size={14} /> }]
                    : []),
                ]}
                onAction={(action) => {
                  if (action === 'attach') fileInputRef.current?.click();
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
