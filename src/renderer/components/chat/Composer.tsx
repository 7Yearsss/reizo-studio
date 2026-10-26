import { presentationMentions, usePresentationWorkspace, referencePresentation, selectPresentation, dropPresentationScope } from '../../state/presentationWorkspace';
import { documentMentions, documentReferences, useDocumentWorkspace, addDocumentReference, selectDocument, dropDocumentSelection, removeDocumentReference } from '../../state/documentWorkspace';
import { labelSelections } from '../../../shared/referenceLabels';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { AtSign, FileText, FileSpreadsheet, Presentation, Clapperboard, FolderTree, Paperclip, Image as ImageIcon, Video, Type, Volume2, Bot, Sparkles, BoxSelect, Layers, Pin, Quote, Wrench } from 'lucide-react';
import { isImeComposingEvent } from '../../lib/ime';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/cn';
import { PromptInput } from '../agents/prompt-input';
import type { PromptEditorHandle } from '../agents/prompt-editor';
import { renumberCitations } from '../../../shared/promptDraft';
import { loadDraft, saveDraft } from '../../../shared/composerDraft';
import { pastedTextFileName, shouldAttachPastedText } from '../../../shared/pastedText';
import { turnErrorFromMessage } from '../../../shared/turnError';
import { findPlaceholders } from '../../../shared/promptPlaceholders';
import ModelPicker from './ModelPicker';
import ContextRing from './ContextRing';
import MentionMenu, { extractMentionQuery } from './MentionMenu';
import SlashPalette, { applySlashArgs, buildSlashCommands, extractSlashQuery, type SlashCommand } from './SlashPalette';
import PendingInteraction from './PendingInteraction';
import QueuePanel from './QueuePanel';
import ComposerDock from './ComposerDock';
import WorkspaceRefChip from './WorkspaceRefChip';
import InterruptedTurnBanner from './InterruptedTurnBanner';
import SelectField from '../ui/SelectField';
import { useSettingsStore } from '../../state/useSettingsStore';
import { useSkillStore } from '../../state/useSkillStore';
import { useChatStore } from '../../state/useChatStore';
import { useCanvasStore, useCanvasStoreEq, sameNodesIgnoringGeometry } from '../../state/useCanvasStore';
import * as settingsStore from '../../state/settingsStore';
import * as chatStore from '../../state/chatStore';
import * as canvasStore from '../../state/canvasStore';
import { getCanvasNodeThumbnail } from '../canvas/canvasThumbnail';
import type { PermissionMode } from '../../../shared/settings';
import type { TurnOutcome } from '../../../shared/stream';
import { useSheetWorkspace, sheetMentions, pinSheetSelection, clearPinnedSheets, removePinnedSheet, flushSheetEdits, selectWorkbook } from '../../state/sheetWorkspace';
import { labelSheetRanges, sameSheetPlace } from '../../../shared/sheetReferences';
import { serializeSheetReference } from '../../../shared/sheetReferences';
import { MAX_SHEET_UPLOAD_BYTES } from '../../../shared/sheetFile';
import { importSheet, importDocument, importPresentation, compactSession } from '../../api';
import * as artifactStore from '../../state/artifactStore';
import * as uiStore from '../../state/uiStore';
import { Button } from '../ui/button';
import { toast } from '../../lib/toast';
import { CHAT_DROP_FILES_EVENT } from '../../lib/chatDrop';
import { isImageFile, transferredFiles } from '../../lib/fileTransfer';

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
  draggingFiles = false,
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
  /** A file drag is hovering anywhere over the chat page (ChatPage owns the drop zone). */
  draggingFiles?: boolean;
}) {
  const [draft, setDraft] = useState(() => (sessionId ? loadDraft(localStorage, sessionId) : ''));
  // Unsent text survives restarts and session switches; attachments stay in memory only.
  const draftSession = useRef(sessionId);
  useEffect(() => {
    if (draftSession.current !== sessionId) {
      draftSession.current = sessionId;
      setDraft(sessionId ? loadDraft(localStorage, sessionId) : '');
      return;
    }
    if (!sessionId) return;
    if (!draft) { saveDraft(localStorage, sessionId, ''); return; }
    const timer = setTimeout(() => saveDraft(localStorage, sessionId, draft), 400);
    return () => clearTimeout(timer);
  }, [draft, sessionId]);
  const presentationRef = usePresentationWorkspace((s) => sessionId ? s.references[sessionId] : undefined);
  const rawDocumentRefs = useDocumentWorkspace((s) => sessionId ? s.references[sessionId] : undefined);
  // Picked ranges are numbered across Doc ranges, matching the labels sent with the message.
  const documentRefs = useMemo(() => labelSelections(rawDocumentRefs ?? []), [rawDocumentRefs]);
  const editorRef = useRef<PromptEditorHandle>(null);
  // Numbered ranges in display order; the inline chips in the draft resolve against these.
  const pinnedSheets = useSheetWorkspace((s) => sessionId ? s.pinnedBySession[sessionId] : undefined);
  // Sheet ranges are numbered after the document ones, matching sheetMentions at send time.
  const sheetFirst = 1 + documentRefs.filter((r) => r.selection).length;
  const sheetRefs = useMemo(() => labelSheetRanges(pinnedSheets ?? [], sheetFirst), [pinnedSheets, sheetFirst]);
  const ranges = useMemo(() => [
    ...documentRefs.filter((r) => r.selection && r.label).map((ref) => ({ label: ref.label!, name: ref.name, text: ref.selection?.text, kind: 'doc' as const, key: `doc:${ref.artifactId}:${JSON.stringify(ref.selection)}` })),
    ...sheetRefs.filter((r) => r.range && r.label).map((ref) => ({ label: ref.label!, name: ref.name, text: `${ref.sheetName ? `${ref.sheetName}!` : ''}${ref.range}`, kind: 'sheet' as const, artifactId: ref.artifactId, key: `sheet:${ref.artifactId}:${ref.sheetId ?? ref.sheetName ?? ''}:${ref.range}` })),
  ], [documentRefs, sheetRefs]);
  const chipApi = useMemo(() => ({
    info: (label: number) => {
      const hit = ranges.find((r) => r.label === label);
      return hit ? { kind: hit.kind === 'doc' ? '文档' : '表格', name: hit.name, text: hit.text } : undefined;
    },
    open: (label: number) => {
      const hit = ranges.find((r) => r.label === label);
      if (!hit || !sessionId) return;
      if (hit.kind === 'doc') { selectDocument(sessionId, documentRefs.find((r) => r.label === label)!.artifactId); uiStore.setRightPanelTab('documents'); }
      else { selectWorkbook(sessionId, hit.artifactId); uiStore.setRightPanelTab('sheets'); }
    },
  }), [ranges, sessionId, documentRefs]);
  const activeSheet = useSheetWorkspace((s) => sessionId ? s.activeBySession[sessionId] : undefined);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const preparing = useRef(false);
  const [mentions, setMentions] = useState<string[]>([]);
  const [localSkillId, setLocalSkillId] = useState<string | undefined>();
  const [attachments, setAttachments] = useState<{ name: string; content: string }[]>([]);
  const [addingFiles, setAddingFiles] = useState(0);
  const addingFilesRef = useRef(0);
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
  const canvasNodes = useCanvasStoreEq((s) => (sessionId ? s.nodesBySession[sessionId] : undefined), sameNodesIgnoringGeometry) ?? canvasStore.EMPTY_NODES;

  const activeSelectedNodes = useMemo(() => {
    if (!selectedNodeIds.length || !canvasNodes.length) return [];
    return canvasNodes.filter((n) => selectedNodeIds.includes(n.id));
  }, [selectedNodeIds, canvasNodes]);

  const unpinnedSelectionNodes = useMemo(() => {
    return activeSelectedNodes.filter((n) => !nodeRefs.some((r) => r.id === n.id));
  }, [activeSelectedNodes, nodeRefs]);
  const hasAttachments = attachments.length > 0 || nodeRefs.length > 0 || unpinnedSelectionNodes.length > 0;

  const mentionQuery = extractMentionQuery(draft);
  const slash = extractSlashQuery(draft);
  const slashCommands = buildSlashCommands(skills);
  const activeSkill = skills.find((s) => s.id === skillId);

  useEffect(() => {
    if (!seed) return;
    setDraft(seed.text);
    replaceFromIdRef.current = seed.replaceFromId;
    // A prefilled template with ${…} slots lands the caret on the first one.
    if (findPlaceholders(seed.text).length) window.setTimeout(() => editorRef.current?.selectPlaceholder(), 0);
  }, [seed?.nonce, seed?.text, seed?.replaceFromId]);

  /** Write [n] into the draft so the instruction that follows is tied to picked range n. */
  function citeReference(label: number) {
    editorRef.current?.insertReference(label);
  }

  // Ranges come and go: a removed one takes its chip with it and the numbers after it shift down;
  // a newly added one (after "问 AI") gets its chip dropped into the sentence right away.
  useEffect(() => {
    const previous = rangeKeys.current;
    const next = ranges.map((r) => r.key);
    rangeKeys.current = next;
    const added = next.filter((key) => !previous.includes(key));
    const gone = previous.some((key) => !next.includes(key));
    const shifted = previous.some((key, index) => next.includes(key) && next.indexOf(key) !== index);
    if (gone || shifted) {
      setDraft((d) => renumberCitations(d, (label) => {
        const key = previous[label - 1];
        if (key === undefined) return undefined;
        const now = next.indexOf(key);
        return now < 0 ? null : now + 1;
      }));
    }
    if (citeNext.current && added.length) {
      citeNext.current = false;
      const label = next.indexOf(added[added.length - 1]) + 1;
      window.setTimeout(() => editorRef.current?.insertReference(label), 0);
    }
  }, [ranges]);

  function buildSubmitPayload() {
    const selectionMentions = unpinnedSelectionNodes.map((n) => `canvas:${n.id}`);
    const refMentions = nodeRefs.map((r) =>
      r.region
        ? `canvas:${r.id}@r=${[r.region.x, r.region.y, r.region.w, r.region.h].map((v) => v.toFixed(3)).join(',')}`
        : `canvas:${r.id}`,
    );
    return {
      mentions: [...mentions, ...refMentions, ...selectionMentions, ...(sessionId ? [...sheetMentions(sessionId, 1 + documentReferences(sessionId).filter((r) => r.selection).length), ...documentMentions(sessionId), ...presentationMentions(sessionId)] : [])],
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
      clearPinnedSheets(sessionId);
      // A picked range / slide / element is spent once sent; the file itself stays referenced as a whole.
      dropDocumentSelection(sessionId); dropPresentationScope(sessionId);
      chatStore.setPickingReference(sessionId, false);
    }
  }

  /** Unfilled `${…}` slots stop a send: jump to the first one and say how many are left. */
  function blockedByPlaceholders(): boolean {
    const slots = findPlaceholders(draft);
    if (slots.length === 0) return false;
    editorRef.current?.selectPlaceholder();
    toast.info(`还有 ${slots.length} 处待填写`, '按 Tab 跳到下一处');
    return true;
  }

  async function submit() {
    if ((!draft.trim() && !hasAttachments) || disabled || preparing.current || addingFilesRef.current > 0) return;
    if (blockedByPlaceholders()) return;
    preparing.current = true;
    setSyncingSheet(true);
    try {
    if (sessionId) await flushSheetEdits(sessionId);
    const { mentions: allMentions, extra } = buildSubmitPayload();
    // Busy-Enter lane: while a turn runs, Enter follows the user's preference —
    // queue (default, next turn) or steer (inject into the live turn).
    if (sessionId && sending && !interaction && busyEnter === 'steer') {
      void chatStore.steerNow(sessionId, draft.trim() || '看下这些素材', allMentions, extra);
    } else {
      onSend(draft.trim() || '看下这些素材', allMentions, extra);
    }
    resetAfterSubmit();
    } catch (error) { toast.error(error instanceof Error ? error.message : '表格同步失败'); }
    finally { preparing.current = false; setSyncingSheet(false); }
  }

  /** Ctrl/Cmd+Enter while a turn is live — the opposite of the busyEnter lane. */
  async function submitNow() {
    if ((!draft.trim() && !hasAttachments) || disabled || !sessionId || preparing.current || addingFilesRef.current > 0) return;
    if (blockedByPlaceholders()) return;
    preparing.current = true;
    setSyncingSheet(true);
    try {
    await flushSheetEdits(sessionId);
    const { mentions: allMentions, extra } = buildSubmitPayload();
    if (busyEnter === 'steer') {
      // Opposite lane = queue it like a normal send-while-busy.
      onSend(draft.trim() || '看下这些素材', allMentions, extra);
    } else {
      void chatStore.steerNow(sessionId, draft.trim() || '看下这些素材', allMentions, extra);
    }
    resetAfterSubmit();
    } catch (error) { toast.error(error instanceof Error ? error.message : '表格同步失败'); }
    finally { preparing.current = false; setSyncingSheet(false); }
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
  function recallQueuedMessages(textBeforeCaret: string) {
    if (!sessionId || queue.length === 0) return false;
    if (textBeforeCaret.includes('\n')) return false;
    const items = chatStore.recallQueue(sessionId);
    if (items.length === 0) return false;
    const recalled = items.map((i) => i.text).join('\n');
    setDraft((prev) => (prev ? `${recalled}\n${prev}` : recalled));
    return true;
  }

  useEffect(() => {
    if (!draft.includes('@')) setMentions([]);
  }, [draft]);

  async function addDroppedFiles(files: FileList | File[]) {
    if (disabled) return;
    addingFilesRef.current += 1;
    setAddingFiles(addingFilesRef.current);
    const next: { name: string; content: string }[] = [];
    try {
    for (const file of Array.from(files)) {
      if (/\.pptx$|\.reizo-ppt\.json$/i.test(file.name)) {
        try {
          if (!sessionId) throw new Error('请先打开一个会话，再导入 PPT');
          await flushSheetEdits(sessionId);
          const artifact = await importPresentation(sessionId, file);
          artifactStore.upsertArtifact(artifact); selectPresentation(sessionId, artifact.id);
          referencePresentation(sessionId, { artifactId: artifact.id, name: artifact.name, version: artifact.version });
          uiStore.setRightPanelTab('presentations');
        } catch (error) { toast.error(error instanceof Error ? error.message : 'PPT 导入失败'); }
        continue;
      }
      if (/\.docx$/i.test(file.name)) {
        try {
          if (!sessionId) throw new Error('请先打开一个会话，再导入 Doc');
          if (file.size > 8 * 1024 * 1024) throw new Error('文档超过 8 MB 上限');
          await flushSheetEdits(sessionId);
          const artifact = await importDocument(sessionId, file);
          artifactStore.upsertArtifact(artifact); selectDocument(sessionId, artifact.id);
          addDocumentReference(sessionId, { artifactId: artifact.id, name: artifact.name, version: artifact.version });
          uiStore.setRightPanelTab('documents');
        } catch (error) { toast.error(error instanceof Error ? error.message : 'Doc 导入失败'); }
        continue;
      }
      if (/\.(xlsx|xls|xlsm)$/i.test(file.name)) {
        try {
          if (!sessionId) throw new Error('请先打开一个会话，再导入 Excel');
          if (!/\.xlsx$/i.test(file.name)) throw new Error('请先另存为 .xlsx 后导入');
          if (file.size > MAX_SHEET_UPLOAD_BYTES) throw new Error('表格超过 8 MB 上限');
          const artifact = await importSheet(sessionId, file);
          artifactStore.upsertArtifact(artifact);
          selectWorkbook(sessionId, artifact.id);
          setMentions((previous) => [...previous, serializeSheetReference({ artifactId: artifact.id })]);
          uiStore.setRightPanelTab('sheets');
        } catch (error) { toast.error(error instanceof Error ? error.message : 'Excel 导入失败'); }
        continue;
      }
      // Images land on this session's canvas as a node and get @-referenced in
      // the draft — the composer text path can't carry binaries.
      if (sessionId && isImageFile(file)) {
        try {
          const nodes = canvasStore.getSnapshot().nodesBySession[sessionId] ?? [];
          const right = nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
          const node = await canvasStore.importImage(sessionId, file, { x: (right || 0) + 40, y: 60 });
          if (!node) throw new Error(`未能添加图片「${file.name}」，请重试`);
          if (node) {
            const p = (node.params as Record<string, unknown>) ?? {};
            chatStore.addNodeRef(sessionId, {
              id: node.id,
              label: (node.title || file.name).toString().slice(0, 24),
              type: 'image',
              thumbnail: getCanvasNodeThumbnail(node) ?? (p.imageUrl as string | undefined),
            });
          }
        } catch (error) { toast.error(error instanceof Error ? error.message : `图片「${file.name}」添加失败`); }
        continue;
      }
      try {
        const read = await window.reizo.readDroppedFile(file);
        next.push({ name: read.name, content: read.content });
      } catch {
        if (file.type.startsWith('text') || file.name.endsWith('.md') || file.name.endsWith('.json')) {
          next.push({ name: file.name, content: await file.text() });
        }
      }
    }
    if (next.length) setAttachments(previous => [...previous, ...next]);
    } finally { addingFilesRef.current -= 1; setAddingFiles(addingFilesRef.current); }
  }

  // ChatPage owns the drop zone (the whole conversation, not just this box) and
  // hands the dropped files over; the ref keeps the latest closure (attachments).
  const addDroppedFilesRef = useRef(addDroppedFiles);
  addDroppedFilesRef.current = addDroppedFiles;
  useEffect(() => {
    const onDrop = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; files?: File[] }>).detail;
      if (detail?.sessionId !== sessionId || !detail.files?.length) return;
      void addDroppedFilesRef.current(detail.files);
    };
    window.addEventListener(CHAT_DROP_FILES_EVENT, onDrop);
    return () => window.removeEventListener(CHAT_DROP_FILES_EVENT, onDrop);
  }, [sessionId]);

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
    editorRef.current?.focus();
  }, []);
  const citeNext = useRef(false);
  const liveSheetRef = useRef(activeSheet); liveSheetRef.current = activeSheet;
  const sheetRefsRef = useRef(sheetRefs); sheetRefsRef.current = sheetRefs;
  const rangeKeys = useRef<string[]>([]);
  // Workspace editors ask for focus right after attaching a reference ("问 AI" / Ctrl+L).
  useEffect(() => {
    const onFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; cite?: boolean }>).detail;
      if (detail?.sessionId !== sessionId) return;
      if (detail.cite) {
        citeNext.current = true;
        // A range that is already quoted adds nothing new, so cite its existing number instead of ignoring the request.
        window.setTimeout(() => {
          const live = liveSheetRef.current;
          const existing = live && sheetRefsRef.current.find((ref) => sameSheetPlace(ref, live));
          if (citeNext.current && existing?.label) editorRef.current?.insertReference(existing.label);
          citeNext.current = false;
        }, 120);
      }
      window.setTimeout(focusComposer, 0);
    };
    window.addEventListener('reizo:focus-composer', onFocus);
    return () => window.removeEventListener('reizo:focus-composer', onFocus);
  }, [sessionId, focusComposer]);

  /** The one fix this failure points at (open the model settings, compact, …); retry stays as its own button. */
  const failure = turnErrorFromMessage(turnError);
  const errorAction = failure && !sending
    ? ((): { label: string; run: () => void } | null => {
        switch (failure.action) {
          case 'open_providers': return { label: '去设置', run: () => uiStore.openSettings('providers') };
          case 'switch_model': return { label: '换模型', run: () => uiStore.openSettings('providers') };
          case 'compact_session':
            return sessionId
              ? { label: '压缩对话', run: () => { void compactSession(sessionId).then(() => { window.dispatchEvent(new Event('reizo:context-changed')); toast.success('已压缩较早的对话，可以重试了'); }, () => toast.error('压缩失败')); } }
              : null;
          default: return null;
        }
      })()
    : null;

  function pickSlash(command: SlashCommand, args: string) {
    if (command.id === 'compact') {
      setDraft('');
      if (!sessionId) return;
      const progress = toast.loading('正在压缩较早的对话…');
      void compactSession(sessionId).then(
        (result) => {
          toast.dismiss(progress);
          window.dispatchEvent(new Event('reizo:context-changed'));
          if (result.compacted) toast.success('已压缩较早的对话', '模型之后只看摘要和最近一轮；完整记录仍在这里');
          else toast.info(result.reason === 'empty_summary' ? '没有生成有效摘要，未改动' : '对话还很短，无需压缩');
        },
        (error: unknown) => { toast.dismiss(progress); toast.error('压缩失败', error instanceof Error ? error.message : undefined); },
      );
      return;
    }
    setSkillId(command.id);
    setDraft(applySlashArgs(command.prompt, args));
    // The palette button steals focus on click — hand it back to the textarea
    // so the skill chip feels like an inline token you can keep typing after.
    window.setTimeout(focusComposer, 0);
  }

  return (
    <div
      ref={overlayRef}
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-paper via-paper to-paper-a0',
        compact ? 'px-3 pb-3 pt-8' : 'px-6 pb-6 pt-16',
      )}
    >
      <div ref={composerBodyRef} className="pointer-events-auto relative mx-auto max-w-3xl"
        onPasteCapture={(event) => {
          const files = transferredFiles(event.clipboardData);
          if (!files.length) {
            const text = event.clipboardData.getData('text/plain');
            if (!shouldAttachPastedText(text)) return;
            // A very long paste becomes a text attachment (full original text is what the agent reads); undo puts it inline.
            event.preventDefault(); event.stopPropagation();
            const file = new File([text], pastedTextFileName(), { type: 'text/plain' });
            void addDroppedFiles([file]);
            toast.show({
              title: `已将 ${text.length.toLocaleString()} 字粘贴内容转为附件`,
              status: 'info',
              duration: 8000,
              action: { label: '改为直接粘贴', onClick: () => { setAttachments((list) => list.filter((a) => a.name !== file.name)); setDraft((d) => d + text); } },
            });
            return;
          }
          event.preventDefault(); event.stopPropagation();
          void addDroppedFiles(files);
        }}>
        {!sending && turnOutcome === 'error' && turnError && (
          <div className="mb-2 flex items-center gap-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-ink" role="alert">
            <span className="flex-1">回复失败：{turnError}</span>
            {errorAction ? (
              <button
                type="button"
                onClick={errorAction.run}
                className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[12px] text-paper-raised transition-opacity hover:opacity-85"
              >
                {errorAction.label}
              </button>
            ) : null}
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
            className="mb-2 rounded-lg bg-[var(--peach)] px-3 py-2 text-[12px] text-[var(--peach-ink)]"
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
            expertsEnabled={draft.trimStart() === `@${mentionQuery}`}
            onPickExpert={(expert) => {
              setDraft(`@${expert.name} `);
              window.setTimeout(focusComposer, 0);
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
        <div className="relative">
            {sessionId && <ComposerDock todos={todos} />}
            {syncingSheet && <p role="status" className="mb-2 text-xs text-ink-muted">正在保存工作区内容…</p>}
            {addingFiles > 0 && <p role="status" className="mb-2 text-xs text-ink-muted">正在添加附件…</p>}
            {(attachments.length > 0 || nodeRefs.length > 0 || mentions.length > 0 || unpinnedSelectionNodes.length > 0) && (
              <div className={cn("mb-2 flex flex-wrap gap-1.5", compact && "max-h-24 overflow-y-auto pr-0.5")}>
                {sessionId && unpinnedSelectionNodes.length > 0 && (
                  <div
                    className="group inline-flex items-center gap-1.5 rounded-lg bg-paper-inset py-0.5 pl-1.5 pr-2 text-xs text-ink transition-colors hover:bg-[var(--pss,var(--line))]"
                    title="画布当前选区 · 发送消息时自动作为上下文带入"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-paper-raised text-ink-muted shrink-0" title="画布选中">
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
                              <span className="flex h-5 w-5 items-center justify-center rounded bg-paper-raised text-ink-muted text-[11px] font-medium uppercase">
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
                    <span className="text-[11px] font-medium text-ink">
                      选区 {unpinnedSelectionNodes.length}
                    </span>
                    <button
                      type="button"
                      className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-ink-muted hover:bg-line hover:text-ink transition-colors cursor-pointer"
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
                      className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-ink-muted hover:bg-line hover:text-ink transition-colors cursor-pointer text-[12px] leading-none"
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
              'rounded-3xl border bg-paper-raised p-2 shadow-[var(--shadow-outline),0_12px_32px_rgba(30,55,85,0.05)] transition-colors',
              draggingFiles ? 'border-accent ring-2 ring-accent/40' : 'border-transparent',
            )}>
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
              {sessionId && (documentRefs.length || presentationRef || activeSheet || sheetRefs.length) ? <div className="mb-1.5 flex flex-wrap items-center gap-1 px-1">
                {documentRefs.map((ref, index) => <WorkspaceRefChip key={`doc:${index}`} icon={<FileText />} kind="文档" name={ref.name} detail={ref.selection ? `「${ref.selection.text ?? ''}」` : '全文'} label={ref.label} cite={() => citeReference(ref.label!)}
                  open={() => { selectDocument(sessionId, ref.artifactId); uiStore.setRightPanelTab('documents'); }} remove={() => removeDocumentReference(sessionId, index)} />)}
                {presentationRef && <WorkspaceRefChip icon={<Presentation />} kind=" PPT " name={presentationRef.name} detail={presentationRef.elementIds?.length ? `${presentationRef.elementIds.length} 个元素` : presentationRef.slideId ? '当前页' : '整份演示稿'}
                  open={() => { selectPresentation(sessionId, presentationRef.artifactId); uiStore.setRightPanelTab('presentations'); }} remove={() => referencePresentation(sessionId)} />}
                {sheetRefs.map((ref, index) => <WorkspaceRefChip key={`${ref.artifactId}:${index}`} icon={<Pin />} kind="表格" name={ref.name} detail={ref.range ? `${ref.sheetName ?? ''}!${ref.range}` : '整个工作簿'} label={ref.label} cite={() => citeReference(ref.label!)}
                  open={() => { selectWorkbook(sessionId, ref.artifactId); uiStore.setRightPanelTab('sheets'); }} remove={() => removePinnedSheet(sessionId, index)} />)}
                {activeSheet && !sheetRefs.some((ref) => sameSheetPlace(ref, activeSheet)) && <WorkspaceRefChip icon={<FileSpreadsheet />} kind="表格" name={activeSheet.name} detail={`${activeSheet.range ? `${activeSheet.sheetName ?? ''}!${activeSheet.range}` : '当前工作表'} · 当前选区`} pinned={false}
                  open={() => { selectWorkbook(sessionId, activeSheet.artifactId); uiStore.setRightPanelTab('sheets'); }} />}
                {activeSheet?.range && !sheetRefs.some((ref) => sameSheetPlace(ref, activeSheet)) && <Button type="button" variant="ghost" size="xs" title="把这个选区编号后写进句子里，可以和别的选区分别说明" onClick={() => { if (pinSheetSelection(sessionId)) { citeNext.current = true; window.setTimeout(() => { citeNext.current = false; }, 1500); focusComposer(); } }}><Quote data-icon="inline-start" />引用</Button>}
              </div> : null}
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
                chips={chipApi}
                editorRef={editorRef}
                onValueChange={setDraft}
                onSubmit={() => submit()}
                allowEmptySubmit={hasAttachments}
                loading={Boolean(sending && !interaction)}
                onStop={sending ? onStop : undefined}
                onSendNow={() => submitNow()}
                onEmptySendNow={queue.length > 0 ? steerAllQueued : undefined}
                busySendTitle={
                  busyEnter === 'steer'
                    ? 'Enter 插话（本轮生效）· Ctrl+Enter 排队'
                    : 'Enter 排队 · Ctrl+Enter 插话（本轮生效）'
                }
                disabled={disabled || syncingSheet || addingFiles > 0}
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
                onKeyDown={(e, { textBeforeCaret }) => {
                  if (isImeComposingEvent(e)) return;
                  if ((mentionQuery !== null || slash !== null) && e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    return;
                  }
                  // Atomic chip delete: Backspace on an empty draft unpins the
                  // skill, then the last Doc chip, mirroring how Cursor/Linear remove context chips.
                  if (e.key === 'Backspace' && draft === '' && skillId) {
                    e.preventDefault();
                    setSkillId(undefined);
                  } else if (e.key === 'Backspace' && draft === '' && sessionId && documentRefs.length) {
                    e.preventDefault();
                    removeDocumentReference(sessionId, documentRefs.length - 1);
                  }
                  // ↑ at the start of the box pulls queued messages back in for editing.
                  if (e.key === 'ArrowUp' && recallQueuedMessages(textBeforeCaret)) {
                    e.preventDefault();
                  }
                }}
                leadingAction={
                  <div className="flex min-w-0 shrink items-center gap-1">
                    <ModelPicker compact={compact} />
                    <ContextRing sessionId={sessionId} sending={sending} />
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
                  { value: 'skill', label: '使用技能', description: '等同输入 /', icon: <Wrench size={14} /> },
                  ...(sessionId
                    ? [
                        { value: 'canvas-pick', label: '从画布引用 (Insert from canvas)', description: '点击画布节点加入引用', icon: <Layers size={14} /> },
                        {
                          value: 'director',
                          label: '导演模式',
                          description: directorOn ? '已开 —— agent 会主动在画布上规划' : '已关 —— 仅在你明确要求时才碰画布',
                          icon: <Clapperboard size={14} />,
                        },
                      ]
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
                  if (action === 'director' && sessionId) {
                    void settingsStore.patchSettings({
                      directorSession: { sessionId, enabled: !directorOn },
                    });
                  }
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

