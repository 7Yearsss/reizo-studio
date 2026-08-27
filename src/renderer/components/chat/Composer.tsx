import { useEffect, useState } from 'react';
import { AtSign, FolderTree, Paperclip, Shield } from 'lucide-react';
import PromptCard from './PromptCard';
import ModelPicker from './ModelPicker';
import MentionMenu, { extractMentionQuery } from './MentionMenu';
import SlashPalette, { buildSlashCommands, extractSlashQuery, type SlashCommand } from './SlashPalette';
import PermissionPrompt from './PermissionPrompt';
import AskUserPrompt from './AskUserPrompt';
import QueuePanel from './QueuePanel';
import TodoCard from './TodoCard';
import { useSettingsStore } from '../../state/useSettingsStore';
import { useSkillStore } from '../../state/useSkillStore';
import { useChatStore } from '../../state/useChatStore';
import * as settingsStore from '../../state/settingsStore';
import * as chatStore from '../../state/chatStore';
import type { PermissionMode } from '../../../shared/settings';

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
}: {
  sessionId?: string;
  disabled: boolean;
  sending?: boolean;
  onSend: (
    text: string,
    mentions: string[],
    extra: { skillId?: string; attachments?: { name: string; content: string }[] },
  ) => void;
  onStop?: () => void;
  onToggleTree?: () => void;
  treeOpen?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [skillId, setSkillId] = useState<string | undefined>();
  const [attachments, setAttachments] = useState<{ name: string; content: string }[]>([]);
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const permissionMode = useSettingsStore((s) => s.settings.permissionMode);
  const skills = useSkillStore().skills;
  const permission = useChatStore((s) => (sessionId ? s.permissionBySession[sessionId] : null)) ?? null;
  const ask = useChatStore((s) => (sessionId ? s.askBySession[sessionId] : null)) ?? null;
  const queue = useChatStore((s) => (sessionId ? s.queueBySession[sessionId] : undefined)) ?? [];
  const todos = useChatStore((s) => (sessionId ? s.todosBySession[sessionId] : undefined)) ?? [];
  const mentionQuery = extractMentionQuery(draft);
  const slashQuery = extractSlashQuery(draft);
  const slashCommands = buildSlashCommands(skills);
  const activeSkill = skills.find((s) => s.id === skillId);

  function submit() {
    if (!draft.trim() || disabled) return;
    onSend(draft, mentions, { skillId, attachments });
    setDraft('');
    setMentions([]);
    setSkillId(undefined);
    setAttachments([]);
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

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 px-6 pt-16 pb-6 bg-gradient-to-t from-paper via-paper to-transparent">
      <div className="pointer-events-auto relative mx-auto max-w-3xl">
        {sessionId && <TodoCard items={todos} />}
        {sessionId && (
          <QueuePanel items={queue} onRemove={(id) => chatStore.removeQueuedTurn(sessionId, id)} />
        )}
        {mentionQuery !== null && workspacePath && (
          <MentionMenu
            query={mentionQuery}
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
          <AskUserPrompt pending={ask} onAnswer={(answers) => void chatStore.answerAsk(sessionId, answers)} />
        ) : permission && sessionId ? (
          <PermissionPrompt
            permission={permission}
            onRespond={(decision) => void chatStore.answerPermission(sessionId, decision)}
          />
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
            {(activeSkill || attachments.length > 0) && (
              <div className="mb-2 flex flex-wrap gap-1.5">
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
            <PromptCard
              value={draft}
              onChange={setDraft}
              onSubmit={submit}
              onStop={onStop}
              sending={sending}
              placeholder="输入消息，/ 调用技能，@ 引用文件，可拖入附件…"
              disabled={disabled}
              rows={2}
              onKeyDown={(e) => {
                if ((mentionQuery !== null || slashQuery !== null) && e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  return;
                }
                if (sending && e.key === 'Enter' && !e.shiftKey && draft.trim()) {
                  e.preventDefault();
                  submit();
                }
              }}
              toolbar={
                <>
                  <ModelPicker />
                  <select
                    value={permissionMode}
                    onChange={(e) =>
                      void settingsStore.patchSettings({ permissionMode: e.target.value as PermissionMode })
                    }
                    className="max-w-[120px] truncate rounded-full bg-paper px-2 py-1 text-xs text-ink outline-none"
                    title="权限模式"
                  >
                    {(Object.keys(MODE_LABEL) as PermissionMode[]).map((mode) => (
                      <option key={mode} value={mode}>
                        {MODE_LABEL[mode]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-full p-1.5 text-ink-muted hover:bg-paper hover:text-ink"
                    title="附件"
                    onClick={() => setDraft((d) => d)}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <label className="flex cursor-pointer items-center">
                      <Paperclip size={14} />
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files) void addDroppedFiles(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </button>
                  {workspacePath && (
                    <button
                      type="button"
                      className="rounded-full p-1.5 text-ink-muted hover:bg-paper hover:text-ink"
                      title="@ 引用文件"
                      onClick={() => setDraft((d) => (d.endsWith('@') ? d : `${d}@`))}
                    >
                      <AtSign size={14} />
                    </button>
                  )}
                  {onToggleTree && workspacePath && (
                    <button
                      type="button"
                      onClick={onToggleTree}
                      className={`rounded-full p-1.5 hover:bg-paper ${treeOpen ? 'text-accent' : 'text-ink-muted hover:text-ink'}`}
                      title="右侧面板"
                    >
                      <FolderTree size={14} />
                    </button>
                  )}
                  <Shield size={13} className="ml-auto text-ink-muted" />
                </>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
