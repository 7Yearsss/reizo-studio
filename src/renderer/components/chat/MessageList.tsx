import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { ChatMessage, ReplyActivity, ToolCallPart } from '../../../shared/chat';
import type { TurnOutcome } from '../../../shared/stream';
import {
  buildRenderItems,
  initialWindowStart,
  snapWindowStart,
  WINDOW_GROW_ITEMS,
} from '../../lib/buildRenderItems';
import { MessageScroller } from '../agents/message-scroller';
import UserMessage from './UserMessage';
import AssistantMessage from './AssistantMessage';
import EmptyChatHints from './EmptyChatHints';

const GROW_TRIGGER_PX = 160;

export default function MessageList({
  messages,
  streaming,
  streamingTools,
  streamingReasoning,
  streamingActivities,
  reasoningStartedAt,
  sending,
  searchQuery,
  currentMatchId,
  lastUserId,
  lastAssistantId,
  turnOutcome = null,
  onEditLastUser,
  onRetryLastAssistant,
  onPickHint,
}: {
  messages: ChatMessage[];
  streaming: string;
  streamingTools?: ToolCallPart[];
  streamingReasoning?: string;
  streamingActivities?: ReplyActivity[];
  reasoningStartedAt?: number;
  sending: boolean;
  searchQuery?: string;
  currentMatchId?: string | null;
  lastUserId?: string;
  lastAssistantId?: string;
  turnOutcome?: TurnOutcome | null;
  onEditLastUser?: () => void;
  onRetryLastAssistant?: () => void;
  onPickHint?: (text: string) => void;
}) {
  const viewportRef = useRef<HTMLElement>(null);
  const [following, setFollowing] = useState(true);

  const items = useMemo(() => buildRenderItems(messages), [messages]);
  const firstKey = items[0]?.key;
  const [windowStart, setWindowStart] = useState(() => initialWindowStart(items));
  // Restores scroll position after the window grows upward.
  const growAnchorRef = useRef<number | null>(null);

  // Reset the window on a session switch (the first item changes).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
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

  const empty = messages.length === 0 && !sending;
  const shown = items.slice(windowStart);
  const hasOlder = windowStart > 0;

  return (
    <div className="relative min-h-0 flex-1">
      <MessageScroller
        followOutput={following}
        followThreshold={80}
        smooth={false}
        onFollowChange={setFollowing}
        busy={sending}
        label="对话"
        className="absolute inset-0"
        viewportRef={viewportRef}
        viewportClassName={`px-8 pt-4 ${sending ? 'pb-56' : 'pb-44'}`}
        contentClassName="mx-auto max-w-3xl space-y-8"
        viewportProps={{
          onScroll: (event) => {
            const el = event.currentTarget;
            if (el.scrollTop < GROW_TRIGGER_PX && windowStart > 0 && growAnchorRef.current === null) {
              growAnchorRef.current = el.scrollHeight;
              setWindowStart((s) => snapWindowStart(items, s - WINDOW_GROW_ITEMS));
            }
          },
        }}
      >
        {empty && onPickHint ? <EmptyChatHints onPick={onPickHint} /> : null}
        {hasOlder && (
          <div className="pt-2 text-center text-[11px] text-ink-muted">向上滚动加载更早的消息…</div>
        )}
        {shown.map(({ message: m }) => (
          <div
            key={m.id}
            data-message-id={m.id}
            data-chat-search-scope=""
            className={
              searchQuery?.trim() && !m.content.toLowerCase().includes(searchQuery.trim().toLowerCase())
                ? 'opacity-40 transition-opacity duration-150'
                : 'transition-opacity duration-150'
            }
          >
            {m.role === 'user' ? (
              <UserMessage
                content={m.content}
                searchQuery={searchQuery}
                currentMatch={currentMatchId === m.id}
                canEdit={!sending && m.id === lastUserId}
                onEdit={onEditLastUser}
              />
            ) : (
              <AssistantMessage
                content={m.content}
                parts={m.parts}
                reasoning={m.reasoning}
                reasoningMs={m.reasoningMs}
                durationMs={m.durationMs}
                currentMatch={currentMatchId === m.id}
                canRetry={!sending && m.id === lastAssistantId}
                onRetry={onRetryLastAssistant}
                turnOutcome={!sending && m.id === lastAssistantId ? turnOutcome : null}
              />
            )}
          </div>
        ))}
        {sending && (
          <div data-message-id="streaming">
            <AssistantMessage
              content={streaming}
              parts={streamingTools}
              reasoning={streamingReasoning || undefined}
              reasoningStreaming={Boolean(streamingReasoning) && !streaming}
              reasoningStartedAt={reasoningStartedAt}
              streaming
              activities={streamingActivities}
            />
          </div>
        )}
      </MessageScroller>
      {!following && (
        <button
          type="button"
          onClick={() => setFollowing(true)}
          className="anim-jump absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-paper-raised px-3 py-1.5 text-xs text-ink shadow-[0_8px_30px_rgba(28,22,18,0.08)]"
        >
          <ArrowDown size={14} />
          跳到底部
        </button>
      )}
    </div>
  );
}
