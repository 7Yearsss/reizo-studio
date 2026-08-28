import { useState } from 'react';
import { FolderOpen, FolderPlus } from 'lucide-react';
import PromptCard from '../components/chat/PromptCard';
import ModelPicker from '../components/chat/ModelPicker';
import MentionMenu, { extractMentionQuery } from '../components/chat/MentionMenu';
import * as chatStore from '../state/chatStore';
import * as tabStore from '../state/tabStore';
import * as settingsStore from '../state/settingsStore';
import * as api from '../api';
import { useSettingsStore } from '../state/useSettingsStore';

export default function HomePage() {
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentions, setMentions] = useState<string[]>([]);
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const mentionQuery = extractMentionQuery(draft);
  const folderName = workspacePath?.split(/[/\\]/).filter(Boolean).pop();
  const hasAnyKey = useSettingsStore((s) => s.settings.providers.some((p) => p.hasKey));

  async function handleSubmit(text = draft, extra: { skillId?: string } = {}) {
    if (!text.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const session = await chatStore.createSession(text.slice(0, 60));
      tabStore.openChatTab(session.id, session.title, true);
      void chatStore.sendMessage(session.id, text, mentions, extra);
      setDraft('');
      setMentions([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  const pills = [
    { label: '审查代码', skillId: 'review-code', text: '请审查当前工作区里最值得修的问题。' },
    { label: '解释代码', skillId: 'explain', text: '解释当前工作区的核心流程。' },
    { label: '写 commit', skillId: 'commit-message', text: '根据 git diff 写一条 commit message。' },
    { label: '修 bug', skillId: 'fix-bug', text: '找出并修复当前工作区里最明确的一个 bug。' },
  ];

  async function handlePickWorkspace() {
    const path = await api.pickFolder();
    if (path) await settingsStore.patchSettings({ workspacePath: path });
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <h1 className="text-[56px] font-semibold tracking-tight text-ink">Reizo</h1>
      <p className="mt-3 text-sm text-ink-muted">今天，想干点啥？</p>

      <div className="relative mt-10 w-full max-w-2xl">
        {mentionQuery !== null && workspacePath && (
          <MentionMenu
            query={mentionQuery}
            onPick={(path) => {
              setDraft((d) => d.replace(/@([^\s@]*)$/, `@${path} `));
              setMentions((m) => (m.includes(path) ? m : [...m, path]));
            }}
          />
        )}
        <PromptCard
          value={draft}
          onChange={setDraft}
          onSubmit={() => void handleSubmit()}
          placeholder="今天，想干点啥？"
          disabled={creating}
          autoFocus
          toolbar={
            <>
              <button
                type="button"
                onClick={() => void handlePickWorkspace()}
                className="flex max-w-[220px] items-center gap-1.5 rounded-full bg-paper px-3 py-1 text-xs text-ink hover:bg-paper-inset"
              >
                {folderName ? <FolderOpen size={13} /> : <FolderPlus size={13} />}
                <span className="truncate">{folderName ?? '选择工作区'}</span>
              </button>
              <ModelPicker />
            </>
          }
        />
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {pills.map((pill) => (
            <button
              key={pill.skillId}
              type="button"
              disabled={creating}
              onClick={() => void handleSubmit(pill.text, { skillId: pill.skillId })}
              className="rounded-full bg-paper-inset px-3 py-1 text-xs text-ink hover:bg-paper-inset/80"
            >
              {pill.label}
            </button>
          ))}
        </div>
        {error && (
          <p className="mt-4 text-center text-xs text-danger">
            发送失败：{error}
          </p>
        )}
        {!hasAnyKey && (
          <p className="mt-4 text-center text-xs text-ink-muted">
            还没有 API Key。
            <button
              type="button"
              onClick={() => tabStore.openSettingsTab()}
              className="ml-1 text-accent hover:opacity-80"
            >
              去设置
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
