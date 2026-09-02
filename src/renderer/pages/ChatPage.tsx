import { useEffect, useMemo, useState } from 'react';
import { FolderKanban, Search } from 'lucide-react';
import * as chatStore from '../state/chatStore';
import * as uiStore from '../state/uiStore';
import { useChatStore } from '../state/useChatStore';
import { useUiStore } from '../state/useUiStore';
import MessageList from '../components/chat/MessageList';
import Composer from '../components/chat/Composer';
import ChatSearchPanel from '../components/chat/ChatSearchPanel';
import { collectMessageMatches } from '../lib/highlightText';
import { cn } from '../lib/cn';
import type { ReplyPhase } from '../components/chat/ReplyStatusBar';
import { liveReplyPhase } from '../state/liveReply';

export default function ChatPage({
  sessionId,
  active = true,
  onToggleTree,
  treeOpen,
}: {
  sessionId: string;
  active?: boolean;
  onToggleTree?: () => void;
  treeOpen?: boolean;
}) {
  const session = useChatStore((s) => s.sessions.find((x) => x.id === sessionId));
  const messages = useChatStore((s) => s.messagesBySession[sessionId]) ?? [];
  const streaming = useChatStore((s) => s.streamingBySession[sessionId]) ?? '';
  const streamingTools = useChatStore((s) => s.streamingToolsBySession[sessionId]) ?? [];
  const streamingReasoning = useChatStore((s) => s.streamingReasoningBySession[sessionId]) ?? '';
  const streamingActivities = useChatStore((s) => s.replyActivitiesBySession[sessionId]) ?? [];
  const reasoningStartedAt = useChatStore((s) => s.reasoningStartedAtBySession[sessionId]);
  const lastTextAt = useChatStore((s) => s.lastTextAtBySession[sessionId]);
  const turnStartedAt = useChatStore((s) => s.turnStartedAtBySession[sessionId]);
  const sending = useChatStore((s) => s.sendingBySession[sessionId]) ?? false;
  const error = useChatStore((s) => s.errorBySession[sessionId]) ?? null;
  const turnOutcome = useChatStore((s) => s.turnOutcomeBySession[sessionId]) ?? null;
  const interruptRequested = useChatStore((s) => s.interruptRequestedBySession[sessionId]) ?? false;
  const interaction = useChatStore((s) => s.interactionBySession[sessionId]) ?? null;
  const showInterruptBanner = useChatStore((s) => {
    const summary = s.sessions.find((x) => x.id === sessionId);
    if (s.sendingBySession[sessionId]) return false;
    if (s.interruptDismissedBySession[sessionId]) return false;
    if (s.turnOutcomeBySession[sessionId] === 'interrupted' || summary?.lastTurnOutcome === 'interrupted') return true;
    if (!summary?.activeTurnStartedAt) return false;
    const started = Date.parse(summary.activeTurnStartedAt);
    const ended = summary.lastTurnEndedAt ? Date.parse(summary.lastTurnEndedAt) : 0;
    return started > ended && !s.sendingBySession[sessionId] && !s.interruptDismissedBySession[sessionId];
  });
  const artifactsOpen = useUiStore((s) => s.artifactsOpen);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session?.title ?? '');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchCursor, setMatchCursor] = useState(0);

  useEffect(() => {
    void chatStore.ensureSessionMessages(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!renaming) setTitleDraft(session?.title ?? '');
  }, [session?.title, renaming]);

  const matches = useMemo(() => collectMessageMatches(messages, searchQuery), [messages, searchQuery]);
  const currentMatch = matches.length ? matches[((matchCursor % matches.length) + matches.length) % matches.length] : undefined;

  useEffect(() => {
    setMatchCursor(0);
  }, [searchQuery, sessionId]);

  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape' && searchOpen) {
        event.preventDefault();
        setSearchOpen(false);
        setSearchQuery('');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, searchOpen]);

  const lastUserId = [...messages].reverse().find((m) => m.role === 'user')?.id;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const activeToolCount = streamingTools.filter((part) => part.result === undefined && part.error === undefined).length;
  const derivedReplyPhase: ReplyPhase | undefined = liveReplyPhase({
    sending,
    waitingOnUser: Boolean(interaction),
    activeToolCount,
    lastTextAt,
  });
  const replyPhase: ReplyPhase | undefined = sending
    ? interaction
      ? 'waiting'
      : derivedReplyPhase
    : undefined;
  const replyStartedAt = turnStartedAt;

  function commitRename() {
    const next = titleDraft.trim();
    setRenaming(false);
    if (next && next !== session?.title) void chatStore.renameSession(sessionId, next);
    else setTitleDraft(session?.title ?? '');
  }

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 px-8 pt-4 pb-2">
        {renaming ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setTitleDraft(session?.title ?? '');
                setRenaming(false);
              }
            }}
            className="min-w-0 flex-1 rounded-md bg-paper-inset/70 px-2 py-0.5 text-lg font-semibold tracking-tight text-ink outline-none"
            aria-label="会话标题"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setTitleDraft(session?.title ?? '');
              setRenaming(true);
            }}
            className="min-w-0 flex-1 truncate text-left text-lg font-semibold tracking-tight"
            title="点击重命名"
          >
            {session?.title ?? '对话'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setSearchOpen((open) => !open)}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors duration-150',
            searchOpen ? 'bg-paper-inset text-ink' : 'text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
          )}
          title="搜索对话 (Ctrl/⌘F)"
        >
          <Search size={13} />
          搜索
        </button>
        <button
          type="button"
          onClick={() => uiStore.toggleArtifacts()}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors duration-150',
            artifactsOpen ? 'bg-paper-inset text-ink' : 'text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
          )}
          title="本会话作品"
        >
          <FolderKanban size={13} />
          作品
        </button>
      </header>
      {searchOpen && (
        <ChatSearchPanel
          query={searchQuery}
          onQuery={setSearchQuery}
          matchCount={matches.length}
          currentIndex={matches.length ? ((matchCursor % matches.length) + matches.length) % matches.length : 0}
          onNext={() => setMatchCursor((i) => i + 1)}
          onPrev={() => setMatchCursor((i) => i - 1)}
          onClose={() => {
            setSearchOpen(false);
            setSearchQuery('');
          }}
        />
      )}
      <MessageList
        messages={messages}
        streaming={streaming}
        streamingTools={streamingTools}
        streamingReasoning={streamingReasoning}
        streamingActivities={streamingActivities}
        reasoningStartedAt={reasoningStartedAt}
        sending={sending}
        searchQuery={searchOpen ? searchQuery : ''}
        currentMatchId={searchOpen ? currentMatch?.messageId : null}
        lastUserId={lastUserId}
        lastAssistantId={lastAssistantId}
        turnOutcome={turnOutcome}
        onEditLastUser={() => chatStore.editLastUserMessage(sessionId)}
        onRetryLastAssistant={() => void chatStore.retryLastAssistant(sessionId)}
        onPickHint={(text) => chatStore.seedComposer(sessionId, text)}
      />
      <Composer
        sessionId={sessionId}
        disabled={false}
        sending={sending}
        onSend={(text, mentions, extra) => void chatStore.sendMessage(sessionId, text, mentions, extra)}
        onStop={() => void chatStore.stopMessage(sessionId)}
        onToggleTree={onToggleTree}
        treeOpen={treeOpen}
        autoFocus={active}
        replyPhase={replyPhase}
        replyStartedAt={replyStartedAt}
        replyToolCount={streamingTools.length}
        interruptRequested={interruptRequested}
        turnOutcome={turnOutcome}
        turnError={error}
        showInterruptBanner={showInterruptBanner}
        onRetryTurn={() => void chatStore.retryInterruptedTurn(sessionId)}
        onDismissInterrupt={() => chatStore.dismissInterrupt(sessionId)}
      />
    </div>
  );
}
