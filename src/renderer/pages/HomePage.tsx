import { useCallback, useState } from 'react';
import { FolderOpen, FolderPlus } from 'lucide-react';
import ReizoWordmark from '../components/home/ReizoWordmark';
import PromptCard from '../components/chat/PromptCard';
import ModelPicker from '../components/chat/ModelPicker';
import MentionMenu, { extractMentionQuery } from '../components/chat/MentionMenu';
import TopRightToolbar from '../components/chat/TopRightToolbar';
import * as chatStore from '../state/chatStore';
import * as tabStore from '../state/tabStore';
import * as settingsStore from '../state/settingsStore';
import * as uiStore from '../state/uiStore';
import * as api from '../api';
import { useSettingsStore } from '../state/useSettingsStore';

export default function HomePage({ active = true }: { active?: boolean }) {
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentions, setMentions] = useState<string[]>([]);
  const [composerReady, setComposerReady] = useState(false);
  const handleWordmarkSettled = useCallback(() => setComposerReady(true), []);
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
      uiStore.setMode('chat');
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

  async function handleOpenCanvas() {
    if (creating) return;
    setCreating(true);
    try {
      const session = await chatStore.createSession('新分镜画布');
      uiStore.setMode('chat');
      tabStore.openChatTab(session.id, session.title, true);
      uiStore.setRightPanelTab('canvas');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-end px-8 pt-2">
        <TopRightToolbar onOpenCanvas={() => void handleOpenCanvas()} />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-12">
        <div className="relative">
          <ReizoWordmark active={active} onSettled={handleWordmarkSettled} />
        </div>

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
            placeholder="输入消息，/ 调用技能，@ 引用文件…"
            disabled={creating}
            autoFocus={composerReady}
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
                onClick={() => uiStore.setMode('settings')}
                className="ml-1 text-accent hover:opacity-80"
              >
                去设置
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
