import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as chatStore from '../state/chatStore';
import * as tabStore from '../state/tabStore';
import { useChatStore } from '../state/useChatStore';
import MessageList from '../components/chat/MessageList';
import Composer from '../components/chat/Composer';
import ChatSearchPanel from '../components/chat/ChatSearchPanel';
import TopRightToolbar from '../components/chat/TopRightToolbar';
import { collectMessageMatches } from '../lib/highlightText';
import type { ReplyPhase } from '../components/chat/ReplyStatusBar';
import { liveReplyPhase } from '../state/liveReply';
import { useTitleBarSlot } from '../components/layout/titleBarSlots';

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
  const lastTextAt = useChatStore((s) => s.lastTextAtBySession[sessionId]);
  const turnStartedAt = useChatStore((s) => s.turnStartedAtBySession[sessionId]);
  const sending = useChatStore((s) => s.sendingBySession[sessionId]) ?? false;
  const error = useChatStore((s) => s.errorBySession[sessionId]) ?? null;
  const loopNotice = useChatStore((s) => s.loopNoticeBySession[sessionId]) ?? null;
  const turnOutcome = useChatStore((s) => s.turnOutcomeBySession[sessionId]) ?? null;
  const memoryEvents = useChatStore((s) => s.memoryEventsBySession[sessionId]) ?? [];
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
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session?.title ?? '');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchCursor, setMatchCursor] = useState(0);

  useEffect(() => {
    // Hidden tabs skip the resume stream — it holds a socket the whole time a
    // turn is suspended, and every mounted tab pays it.
    void chatStore.ensureSessionMessages(sessionId, { resume: active });
  }, [sessionId, active]);

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

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isCompact = containerWidth < 460;
  const titleBarSlot = useTitleBarSlot('center');
  const titleBarRight = useTitleBarSlot('right');
  // Composer floats over the stream; its rendered height (docked plan / ask /
  // queue cards included) is what the list pads below so content can always
  // scroll fully clear — cards never sit on top of messages.
  const [composerH, setComposerH] = useState(176);

  function commitRename() {
    const next = titleDraft.trim();
    setRenaming(false);
    if (next && next !== session?.title) void chatStore.renameSession(sessionId, next);
    else setTitleDraft(session?.title ?? '');
  }

  return (
    <div ref={containerRef} className="relative flex h-full min-w-0 flex-col">
      {active &&
        titleBarSlot &&
        createPortal(
          <>
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
            className="min-w-0 max-w-64 rounded-md bg-paper-inset/70 px-2 py-0.5 text-[13px] font-semibold tracking-tight text-ink outline-none"
            aria-label="会话标题"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setTitleDraft(session?.title ?? '');
              setRenaming(true);
            }}
            className="min-w-0 max-w-64 truncate px-1 text-left text-[13px] font-semibold tracking-tight transition-colors"
            title={session?.title ? `${session.title} (点击重命名)` : '点击重命名'}
          >
            {session?.title ?? '对话'}
          </button>
        )}
          </>,
          titleBarSlot,
        )}
      {active &&
        titleBarRight &&
        createPortal(
          <TopRightToolbar
            sessionId={sessionId}
            compact={isCompact}
            onSearch={() => setSearchOpen((open) => !open)}
            searchOpen={searchOpen}
            onRename={() => {
              setTitleDraft(session?.title ?? '');
              setRenaming(true);
            }}
            onDelete={() => {
              if (confirm('确定要删除此对话吗？')) {
                tabStore.closeSessionTabs(sessionId);
                void chatStore.deleteSession(sessionId);
              }
            }}
          />,
          titleBarRight,
        )}
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
        sessionId={sessionId}
        compact={isCompact}
        streaming={streaming}
        streamingTools={streamingTools}
        streamingReasoning={streamingReasoning}
        streamingActivities={streamingActivities}
        sending={sending}
        searchQuery={searchOpen ? searchQuery : ''}
        currentMatchId={searchOpen ? currentMatch?.messageId : null}
        lastUserId={lastUserId}
        lastAssistantId={lastAssistantId}
        turnOutcome={turnOutcome}
        memoryEvents={memoryEvents}
        onEditLastUser={() => chatStore.editLastUserMessage(sessionId)}
        onRetryLastAssistant={() => void chatStore.retryLastAssistant(sessionId)}
        onPickHint={(text) => chatStore.seedComposer(sessionId, text)}
        bottomInset={composerH}
      />
      <Composer
        sessionId={sessionId}
        compact={isCompact}
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
        loopNotice={loopNotice}
        showInterruptBanner={showInterruptBanner}
        onRetryTurn={() => void chatStore.retryInterruptedTurn(sessionId)}
        onRetryStalled={() => void chatStore.retryStalledTurn(sessionId)}
        onDismissInterrupt={() => chatStore.dismissInterrupt(sessionId)}
        onOverlayHeight={setComposerH}
      />
    </div>
  );
}
