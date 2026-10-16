import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTitleBarSlot } from '../components/layout/titleBarSlots';
import { FolderOpen, FolderPlus, Sparkles, X } from 'lucide-react';
import HomeWelcome from '../components/home/HomeWelcome';
import ConversationGuide from '../components/home/ConversationGuide';
import { insertGuidePrompt, type GuideTool } from '../components/home/conversationGuideData';
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

export default function HomePage({ active = true }: { active?: boolean }) {
  const titleBarSlot = useTitleBarSlot('center');
  const [draft, setDraft] = useState('');
  const [selectedGuideTool, setSelectedGuideTool] = useState<GuideTool | null>(null);
  const composerContainer = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentions, setMentions] = useState<string[]>([]);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepth = useRef(0);
  const fileThumbs = useRef(new Map<File, string>());
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
      const guideSkillId = selectedGuideTool?.skillId;
      if (guideSkillId) chatStore.setSessionSkill(session.id, guideSkillId);
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
          const read = await window.reizo.readDroppedFile(file);
          attachments.push({ name: read.name, content: read.content });
        } catch {
          if (file.type.startsWith('text') || file.name.endsWith('.md') || file.name.endsWith('.json')) {
            attachments.push({ name: file.name, content: await file.text() });
          }
        }
      }
      const message = text.trim() || (files.length ? '看下这些素材' : text);
      void chatStore.sendMessage(session.id, message, mentions, {
        ...(guideSkillId ? { skillId: guideSkillId } : {}),
        ...extra,
        attachments: attachments.length ? attachments : undefined,
      });
      setDraft('');
      setSelectedGuideTool(null);
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
  async function handlePickWorkspace() {
    const path = await api.pickFolder();
    if (path) await settingsStore.patchSettings({ workspacePath: path });
  }

  async function handleOpenPanel(tab: uiStore.RightPanelTab) {
    if (creating) return;
    setCreating(true);
    uiStore.setMode('chat');
    uiStore.setRightPanelTab(tab);
    try {
      const session = await chatStore.createSession('新对话');
      tabStore.openChatTab(session.id, session.title, true);
    } catch (err) {
      uiStore.closeRightPanel();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
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
            <TopRightToolbar
              onOpenCanvas={() => void handleOpenCanvas()}
              onOpenPanel={(tab) => void handleOpenPanel(tab)}
            />
          </div>,
          titleBarSlot,
        )}
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-10 max-sm:px-4">
        <div className="my-auto flex w-full max-w-[760px] shrink-0 flex-col items-center">
        <HomeWelcome active={active} />

        <div ref={composerContainer} className="relative mt-7 w-full">
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
            className={draggingFiles ? 'rounded-3xl ring-2 ring-accent/60' : undefined}
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
            placeholder="说说你的想法，或选择下方工具开始…"
            rows={4}
            className="rounded-[22px] px-6 py-5 shadow-[0_4px_24px_rgba(28,29,30,0.04)] max-sm:px-4"
            disabled={creating}
            autoFocus={active}
            selection={selectedGuideTool && (
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-paper-inset px-2.5 py-1 text-xs text-ink">
                <Sparkles size={12} className="shrink-0" />
                <span className="truncate">{selectedGuideTool.label}</span>
                <button type="button" disabled={creating} aria-label="移除已选工具" title="取消工具选择，保留输入内容" onClick={() => setSelectedGuideTool(null)} className="rounded-full p-0.5 hover:bg-line focus-visible:outline-2 focus-visible:outline-accent"><X size={12} /></button>
              </span>
            )}
            toolbar={
              <>
                <button
                  type="button"
                  onClick={() => void handlePickWorkspace()}
                  className="flex max-w-[220px] items-center gap-1.5 rounded-full bg-paper px-3 py-1.5 text-[13px] text-ink hover:bg-paper-inset"
                >
                  {folderName ? <FolderOpen size={13} /> : <FolderPlus size={13} />}
                  <span className="truncate">{folderName ?? '选择工作区'}</span>
                </button>
                <ModelPicker />
              </>
            }
          />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-xs leading-5 text-ink-muted">
            <span>可拖入图片或文件，补充创作素材</span>
            <span><kbd className="font-sans">Enter</kbd> 发送<span className="mx-2 text-line">/</span><kbd className="font-sans">Shift + Enter</kbd> 换行</span>
          </div>
          <ConversationGuide
            disabled={creating}
            skills={skills}
            selectedToolId={selectedGuideTool?.id}
            onChoose={(tool) => {
              setDraft((current) => insertGuidePrompt(current, selectedGuideTool, tool));
              setSelectedGuideTool(tool);
              requestAnimationFrame(() => composerContainer.current?.querySelector('textarea')?.focus());
            }}
            onManageSkills={() => uiStore.setMode('skills')}
          />
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
    </div>
  );
}
