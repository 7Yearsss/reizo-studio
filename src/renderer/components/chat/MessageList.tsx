import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isCompactBoundary } from '../../../shared/compactBoundary';
import CompactDivider from './CompactDivider';
import { ArrowDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ChatMessage } from '../../../shared/chat';
import type { MemoryEventRecord, TurnOutcome } from '../../../shared/stream';
import {
  buildRenderItems,
  initialWindowStart,
  snapWindowStart,
  WINDOW_GROW_ITEMS,
} from '../../lib/buildRenderItems';
import { MessageScroller } from '../agents/message-scroller';
import { useAnchorQuestion } from '../../lib/anchorQuestionPref';
import { useChatStore } from '../../state/useChatStore';
import ErrorBoundary from '../ErrorBoundary';
import UserMessage from './UserMessage';
import AssistantMessage from './AssistantMessage';
import { parseAnchors, pickAnchor, withAnchor, type ReadingAnchor } from '../../../shared/readingAnchor';
import { unseenCount, unseenLabel } from '../../../shared/unseenCount';
import { isSteeredMessage } from '../../../shared/steerMessage';
import EmptyChatHints from './EmptyChatHints';
import MemoryEventRow from './MemoryEventRow';
import VideoEditorActivity from './VideoEditorActivity';

const GROW_TRIGGER_PX = 160;
// The composer overlay pads this much transparent-to-paper fade above its card
// (Composer.tsx `pt-16` / `pt-8`); the jump button sits inside that band so it
// never covers message text.
const COMPOSER_FADE_PX = { regular: 64, compact: 32 } as const;

export default function MessageList({
  messages,
  sending,
  searchQuery,
  currentMatchId,
  lastUserId,
  lastAssistantId,
  turnOutcome = null,
  onEditLastUser,
  onRetryLastAssistant,
  onPickHint,
  emptyContext = 'chat',
  compact = false,
  sessionId,
  bottomInset,
  loading,
  memoryEvents = [],
}: {
  messages: ChatMessage[];
  /** 已记住/想起了 rows — rendered right after the message they follow. */
  memoryEvents?: MemoryEventRecord[];
  sessionId?: string;
  sending: boolean;
  searchQuery?: string;
  currentMatchId?: string | null;
  lastUserId?: string;
  lastAssistantId?: string;
  turnOutcome?: TurnOutcome | null;
  onEditLastUser?: () => void;
  onRetryLastAssistant?: () => void;
  onPickHint?: (text: string) => void;
  emptyContext?: 'chat' | 'canvas';
  compact?: boolean;
  /** Rendered height of the composer overlay — the viewport pads this much so docked cards (plan/ask/queue) never cover scrolled content. */
  bottomInset?: number;
  /** History not fetched yet — render nothing rather than flash the empty-chat hints. */
  loading?: boolean;
}) {
  const viewportRef = useRef<HTMLElement>(null);
  const [following, setFollowing] = useState(true);
  // How many messages existed when the reader last had the live edge in view.
  const seenAtLeave = useRef(messages.length);
  if (following) seenAtLeave.current = messages.length;
  const unseen = following ? 0 : unseenCount(messages.length, seenAtLeave.current);

  const items = useMemo(() => buildRenderItems(messages), [messages]);
  const firstKey = items[0]?.key;
  const [windowStart, setWindowStart] = useState(() => initialWindowStart(items));
  // Restores scroll position after the window grows upward.
  const growAnchorRef = useRef<number | null>(null);

  // Reset the window on a session switch (the first item changes).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Set when a saved reading position was just restored, so the reset below does not drag the reader back to the end.
  const heldByRestore = useRef(false);
  useEffect(() => {
    if (heldByRestore.current) { heldByRestore.current = false; return; }
    setWindowStart(initialWindowStart(itemsRef.current));
    setFollowing(true);
  }, [firstKey]);

  // Keep the window start valid if the list shrank (truncate / regenerate).
  useEffect(() => {
    setWindowStart((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (el && growAnchorRef.current !== null) {
      el.scrollTop += el.scrollHeight - growAnchorRef.current;
      growAnchorRef.current = null;
    }
  }, [windowStart]);

  // Reading position: remember where in the history the reader is (per conversation) and put them back after a reload.
  const ANCHOR_KEY = 'reizo:reading-anchors';
  const restoredFor = useRef<string | undefined>(undefined);
  const saveTimer = useRef<number | undefined>(undefined);
  const followingRef = useRef(following);
  followingRef.current = following;

  const saveAnchor = () => {
    const el = viewportRef.current;
    if (!el || !sessionId) return;
    const top = el.getBoundingClientRect().top;
    const rects = [...el.querySelectorAll<HTMLElement>('[data-message-id]')].map((m) => {
      const r = m.getBoundingClientRect();
      return { id: m.dataset.messageId ?? '', top: r.top, bottom: r.bottom };
    });
    const anchor = pickAnchor(rects, top, followingRef.current);
    try {
      localStorage.setItem(ANCHOR_KEY, JSON.stringify(withAnchor(parseAnchors(localStorage.getItem(ANCHOR_KEY)), sessionId, anchor)));
    } catch { /* per-viewer convenience */ }
  };
  const scheduleSaveAnchor = () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(saveAnchor, 250);
  };
  const restoreRaf = useRef(0);
  useEffect(() => () => { window.clearTimeout(saveTimer.current); cancelAnimationFrame(restoreRaf.current); }, []);

  useEffect(() => {
    if (!sessionId || loading || items.length === 0 || restoredFor.current === sessionId) return;
    restoredFor.current = sessionId;
    let anchor: ReadingAnchor | undefined;
    try { anchor = parseAnchors(localStorage.getItem(ANCHOR_KEY))[sessionId]; } catch { anchor = undefined; }
    if (!anchor) return;
    const index = items.findIndex((it) => it.key === anchor.messageId);
    if (index < 0) return;
    if (index < windowStart) setWindowStart(snapWindowStart(items, index));
    heldByRestore.current = true;
    setFollowing(false);
    // Rows lay out lazily (content-visibility), so settle over a few frames instead of trusting one measurement.
    let frames = 0;
    const place = () => {
      const el = viewportRef.current;
      const target = el?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.messageId)}"]`);
      if (el && target) {
        el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset;
      }
      if (frames++ < 8) { restoreRaf.current = requestAnimationFrame(place); return; }
      // Intermediate frames ran on estimated row heights and can look "close to the end", which turns following back on;
      // once the position has settled, a reader who is clearly mid-history stays off the live edge.
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 80) setFollowing(false);
    };
    restoreRaf.current = requestAnimationFrame(place);
  }, [sessionId, loading, items, windowStart]);

  useEffect(() => {
    if (!currentMatchId) return;
    const el = viewportRef.current?.querySelector(`[data-message-id="${CSS.escape(currentMatchId)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFollowing(false);
  }, [currentMatchId, searchQuery]);

  // Search must see the whole history — widen the window to cover any match.
  useEffect(() => {
    if (!searchQuery?.trim() || !currentMatchId) return;
    const idx = items.findIndex((it) => it.key === currentMatchId);
    if (idx >= 0 && idx < windowStart) setWindowStart(snapWindowStart(items, idx));
  }, [currentMatchId, searchQuery, items, windowStart]);
  const empty = messages.length === 0 && !sending && !loading;
  const shown = items.slice(windowStart);
  const hasOlder = windowStart > 0;

  const anchorQuestion = useAnchorQuestion();
  return (
    <div className="relative min-h-0 flex-1">
      {/* Soft top fade — scrolled messages dissolve under the header instead of hitting a hard edge */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-paper via-paper/70 to-transparent"
      />
      <MessageScroller
        anchorQuestion={anchorQuestion}
        followOutput={following}
        followThreshold={80}
        smooth={false}
        onFollowChange={setFollowing}
        busy={sending}
        label="对话"
        navigation="rail"
        navigationLabel="消息导航"
        className="absolute inset-0"
        viewportRef={viewportRef}
        viewportClassName={compact ? 'px-3.5 pt-10' : 'px-5 pt-10 sm:px-8'}
        contentClassName="mx-auto max-w-3xl space-y-9"
        viewportProps={{
          style: {
            paddingBottom: (bottomInset ?? (compact ? 144 : 176)) + 12,
            transition: 'padding-bottom 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
          },
          onScroll: (event) => {
            const el = event.currentTarget;
            scheduleSaveAnchor();
            if (el.scrollTop < GROW_TRIGGER_PX && windowStart > 0 && growAnchorRef.current === null) {
              growAnchorRef.current = el.scrollHeight;
              setWindowStart((s) => snapWindowStart(items, s - WINDOW_GROW_ITEMS));
            }
          },
        }}
      >
        {empty && onPickHint ? <EmptyChatHints context={emptyContext} onPick={onPickHint} /> : null}
        {hasOlder && (
          <div className="pt-2 text-center text-[11px] text-ink-muted">向上滚动加载更早的消息…</div>
        )}
        {shown.map(({ message: m }, idx) => {
          const next = shown[idx + 1]?.message;
          const after = memoryEvents.filter(
            (ev) => ev.createdAt > m.createdAt && (!next || ev.createdAt <= next.createdAt),
          );
          return (
          <div
            key={m.id}
            data-message-id={m.id}
            data-slot="message"
            data-from={m.role}
            data-chat-search-scope=""
            // Skip layout/paint for off-screen messages — sidebar resizes and
            // scrolls otherwise reflow every rendered markdown block each frame.
            // `auto` on containIntrinsicSize keeps the last measured size so the
            // scrollbar height stays stable once a message has been rendered.
            style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' }}
            className={
              searchQuery?.trim() && !m.content.toLowerCase().includes(searchQuery.trim().toLowerCase())
                ? 'opacity-40 transition-opacity duration-150'
                : 'transition-opacity duration-150'
            }
          >
            {/* Per-message boundary: one bad message (e.g. malformed tool args
                after an upstream stall) must not blank the whole stream. */}
            <ErrorBoundary
              fallback={
                <div className="rounded-lg border border-line bg-paper-inset px-3 py-2 text-[11px] text-ink-muted">
                  这条消息渲染失败
                </div>
              }
            >
              {isCompactBoundary(m) ? (
                <CompactDivider message={m} />
              ) : m.role === 'user' ? (
                <UserMessage
                  content={m.content}
                  sessionId={sessionId}
                  searchQuery={searchQuery}
                  currentMatch={currentMatchId === m.id}
                  canEdit={!sending && m.id === lastUserId}
                  onEdit={onEditLastUser}
                  steered={isSteeredMessage(m.id)}
                />
              ) : (
                <AssistantMessage
                  content={m.content}
                  sessionId={sessionId}
                  messageId={m.id}
                  parts={m.parts}
                  reasoning={m.reasoning}
                  reasoningSegments={m.reasoningSegments}
                  reasoningMs={m.reasoningMs}
                  durationMs={m.durationMs}
                  currentMatch={currentMatchId === m.id}
                  canRetry={!sending && m.id === lastAssistantId}
                  onRetry={onRetryLastAssistant}
                  // Prefer the outcome persisted on the message itself —
                  // the session-level stamp only applies to the last
                  // assistant row, and a no-message interrupt must not
                  // mislabel the previous completed reply.
                  turnOutcome={m.turnOutcome ?? (!sending && m.id === lastAssistantId ? turnOutcome : null)}
                />
              )}
            </ErrorBoundary>
            {after.map((ev) => (
              <div key={ev.id} className="mt-1">
                <MemoryEventRow event={ev} sessionId={sessionId} />
              </div>
            ))}
          </div>
          );
        })}
        {sending && sessionId && <StreamingAssistant sessionId={sessionId} />}
        {sessionId && <VideoEditorActivity sessionId={sessionId} />}
      </MessageScroller>
      <AnimatePresence>
        {!following && (
          <motion.button
            key="jump-to-end"
            type="button"
            onClick={() => setFollowing(true)}
            aria-label={unseen > 0 ? `跳到底部，${unseen} 条新消息` : '跳到底部'}
            title={unseen > 0 ? `${unseen} 条新消息` : '跳到底部'}
            initial={{ opacity: 0, y: 8, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.85 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ y: 2 }}
            whileTap={{ scale: 0.92 }}
            className="absolute left-1/2 z-10 -ml-4 flex size-8 items-center justify-center rounded-full border border-line bg-paper-raised text-ink-muted shadow-[0_8px_30px_rgba(28,22,18,0.08)] transition-colors hover:text-ink"
            style={{
              bottom:
                (bottomInset ?? (compact ? 144 : 176)) -
                (compact ? COMPOSER_FADE_PX.compact : COMPOSER_FADE_PX.regular) +
                (compact ? 2 : 16),
            }}
          >
            <ArrowDown size={15} />
            {unseen > 0 && (
              <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-medium leading-4 text-white tabular-nums">{unseenLabel(unseen)}</span>
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

const EMPTY_PARTS: never[] = [];
const EMPTY_ACTIVITIES: never[] = [];

/**
 * The live reply bubble subscribes to the per-token store slices itself so a
 * 20fps stream commit only re-renders this row — not the whole message list,
 * ChatPage, or the composer.
 */
function StreamingAssistant({ sessionId }: { sessionId: string }) {
  const streaming = useChatStore((s) => s.streamingBySession[sessionId]) ?? '';
  const streamingTools = useChatStore((s) => s.streamingToolsBySession[sessionId]) ?? EMPTY_PARTS;
  const streamingReasoning = useChatStore((s) => s.streamingReasoningBySession[sessionId]) ?? '';
  const streamingActivities =
    useChatStore((s) => s.replyActivitiesBySession[sessionId]) ?? EMPTY_ACTIVITIES;
  return (
    <div data-message-id="streaming" data-slot="message" data-from="assistant">
      <ErrorBoundary
        fallback={
          <div className="rounded-lg border border-line bg-paper-inset px-3 py-2 text-[11px] text-ink-muted">
            回复渲染异常 — 请尝试刷新
          </div>
        }
      >
        <AssistantMessage
          content={streaming}
          sessionId={sessionId}
          parts={streamingTools}
          reasoning={streamingReasoning || undefined}
          reasoningStreaming={Boolean(streamingReasoning) && !streaming}
          streaming
          activities={streamingActivities}
        />
      </ErrorBoundary>
    </div>
  );
}
