import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTitleBarSlot } from '../components/layout/titleBarSlots';
import { FolderOpen, FolderPlus } from 'lucide-react';
import ReizoWordmark from '../components/home/ReizoWordmark';
import PromptCard from '../components/chat/PromptCard';
import ModelPicker from '../components/chat/ModelPicker';
import MentionMenu, { extractMentionQuery } from '../components/chat/MentionMenu';
import TopRightToolbar from '../components/chat/TopRightToolbar';
import * as chatStore from '../state/chatStore';
import * as canvasStore from '../state/canvasStore';
import { getCanvasNodeThumbnail } from '../components/canvas/canvasThumbnail';
import * as tabStore from '../state/tabStore';
import * as settingsStore from '../state/settingsStore';
import * as uiStore from '../state/uiStore';
import * as api from '../api';
import { useSettingsStore } from '../state/useSettingsStore';
import { useSkillStore } from '../state/useSkillStore';
import { getRecentSkillIds } from '../state/skillStore';
import type { SkillSummary } from '../state/skillStore';

export default function HomePage({ active = true }: { active?: boolean }) {
  const titleBarSlot = useTitleBarSlot('center');
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentions, setMentions] = useState<string[]>([]);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepth = useRef(0);
  const fileThumbs = useRef(new Map<File, string>());
  const [composerReady, setComposerReady] = useState(false);
  const handleWordmarkSettled = useCallback(() => setComposerReady(true), []);
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const mentionQuery = extractMentionQuery(draft);
  const folderName = workspacePath?.split(/[/\\]/).filter(Boolean).pop();
  const hasAnyKey = useSettingsStore((s) => s.settings.providers.some((p) => p.hasKey));

  function fileThumb(file: File): string | undefined {
    if (!file.type.startsWith('image/')) return undefined;
    let url = fileThumbs.current.get(file);
    if (!url) {
      url = URL.createObjectURL(file);
      fileThumbs.current.set(file, url);
    }
    return url;
  }

  useEffect(() => {
    const thumbs = fileThumbs.current;
    return () => {
      for (const url of thumbs.values()) URL.revokeObjectURL(url);
      thumbs.clear();
    };
  }, []);

  function addDroppedFiles(files: FileList | File[]) {
    const next = [...droppedFiles];
    for (const file of Array.from(files)) {
      if (!next.includes(file)) next.push(file);
    }
    setDroppedFiles(next);
  }

  function removeDroppedFile(file: File) {
    const url = fileThumbs.current.get(file);
    if (url) {
      URL.revokeObjectURL(url);
      fileThumbs.current.delete(file);
    }
    setDroppedFiles((prev) => prev.filter((f) => f !== file));
  }

  async function handleSubmit(text = draft, extra: { skillId?: string } = {}) {
    if ((!text.trim() && droppedFiles.length === 0) || creating) return;
    setCreating(true);
    setError(null);
    const files = [...droppedFiles];
    try {
      const session = await chatStore.createSession(text.slice(0, 60) || '新会话');
      uiStore.setMode('chat');
      tabStore.openChatTab(session.id, session.title, true);
      // Mirror the session composer's drop semantics: images land on this
      // session's canvas as nodes + an @-ref chip; text-like files ride along
      // as message attachments.
      const attachments: { name: string; content: string }[] = [];
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          try {
            const nodes = canvasStore.getSnapshot().nodesBySession[session.id] ?? [];
            const right = nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
            const node = await canvasStore.importImage(session.id, file, {
              x: (right || 0) + 40,
              y: 60,
            });
            if (node) {
              const p = (node.params as Record<string, unknown>) ?? {};
              chatStore.addNodeRef(session.id, {
                id: node.id,
                label: (node.title || file.name).toString().slice(0, 24),
                type: 'image',
                thumbnail: getCanvasNodeThumbnail(node) ?? (p.imageUrl as string | undefined),
              });
            }
          } catch {
            /* image import failed — skip this file */
          }
          continue;
        }
        try {
          const filePath = window.reizo.getPathForFile(file);
          const read = await window.reizo.readDroppedFile(filePath);
          attachments.push({ name: read.name, content: read.content });
        } catch {
          if (file.type.startsWith('text') || file.name.endsWith('.md') || file.name.endsWith('.json')) {
            attachments.push({ name: file.name, content: await file.text() });
          }
        }
      }
      const message = text.trim() || (files.length ? '看下这些素材' : text);
      void chatStore.sendMessage(session.id, message, mentions, {
        ...extra,
        attachments: attachments.length ? attachments : undefined,
      });
      setDraft('');
      setMentions([]);
      setDroppedFiles([]);
      for (const url of fileThumbs.current.values()) URL.revokeObjectURL(url);
      fileThumbs.current.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  const skills = useSkillStore().skills;
  const pills: SkillSummary[] = (() => {
    const recent = getRecentSkillIds();
    const byId = new Map(skills.map((s) => [s.id, s]));
    const ordered = [
      ...recent.map((id) => byId.get(id)).filter((s): s is SkillSummary => Boolean(s)),
      ...skills.filter((s) => !recent.includes(s.id)),
    ];
    return ordered.slice(0, 6);
  })();

  async function handlePickSkill(skill: SkillSummary) {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const session = await chatStore.createSession(`/${skill.id}`);
      uiStore.setMode('chat');
      tabStore.openChatTab(session.id, session.title, true);
      chatStore.setSessionSkill(session.id, skill.id);
      chatStore.seedComposer(session.id, skill.prompt ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handlePickWorkspace() {
    const path = await api.pickFolder();
    if (path) await settingsStore.patchSettings({ workspacePath: path });
  }

  async function handleOpenCanvas() {
    if (creating) return;
    setCreating(true);
    // Open the drawer first so the click responds instantly; the panel shows
    // its skeleton until the session exists and the chat tab takes over.
    uiStore.setMode('chat');
    uiStore.setRightPanelTab('canvas');
    try {
      const session = await chatStore.createSession('新分镜画布');
      tabStore.openChatTab(session.id, session.title, true);
    } catch (err) {
      uiStore.closeRightPanel();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      {active &&
        titleBarSlot &&
        createPortal(
          <div className="ml-auto shrink-0">
            <TopRightToolbar onOpenCanvas={() => void handleOpenCanvas()} />
          </div>,
          titleBarSlot,
        )}
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
          <div
            className={draggingFiles ? 'rounded-[28px] ring-2 ring-accent/60' : undefined}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) e.preventDefault();
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
              if (e.dataTransfer.files.length && !creating) addDroppedFiles(e.dataTransfer.files);
            }}
          >
          <PromptCard
            value={draft}
            onChange={setDraft}
            onSubmit={() => void handleSubmit()}
            canSubmit={Boolean(draft.trim()) || droppedFiles.length > 0}
            files={droppedFiles.map((file, i) => ({
              key: `${file.name}-${i}`,
              name: file.name,
              imageUrl: fileThumb(file),
              onRemove: () => removeDroppedFile(file),
            }))}
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
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {pills.map((pill) => (
              <button
                key={pill.id}
                type="button"
                disabled={creating}
                title={pill.description || `/${pill.id}`}
                onClick={() => void handlePickSkill(pill)}
                className="rounded-full bg-paper-inset px-3 py-1 text-xs text-ink hover:bg-paper-inset/80"
              >
                /{pill.name}
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
