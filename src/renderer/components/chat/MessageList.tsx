import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { ChatMessage, ToolCallPart } from '../../../main/server/storage/ports';
import UserMessage from './UserMessage';
import AssistantMessage from './AssistantMessage';
import EmptyChatHints from './EmptyChatHints';

function nearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

export default function MessageList({
  messages,
  streaming,
  streamingTools,
  sending,
  searchQuery,
  currentMatchId,
  lastUserId,
  lastAssistantId,
  onEditLastUser,
  onRetryLastAssistant,
  onPickHint,
}: {
  messages: ChatMessage[];
  streaming: string;
  streamingTools?: ToolCallPart[];
  sending: boolean;
  searchQuery?: string;
  currentMatchId?: string | null;
  lastUserId?: string;
  lastAssistantId?: string;
  onEditLastUser?: () => void;
  onRetryLastAssistant?: () => void;
  onPickHint?: (text: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const frozenRef = useRef(false);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (frozenRef.current) {
      setShowJump(true);
      return;
    }
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
    } else {
      setShowJump(true);
    }
  }, [messages, streaming, streamingTools]);

  useEffect(() => {
    if (!currentMatchId) return;
    const el = scrollerRef.current?.querySelector(`[data-message-id="${CSS.escape(currentMatchId)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    frozenRef.current = true;
    stickRef.current = false;
    setShowJump(true);
  }, [currentMatchId, searchQuery]);

  const empty = messages.length === 0 && !sending;

  return (
    <div
      ref={scrollerRef}
      className="relative flex-1 overflow-y-auto px-8 pt-4 pb-40"
      onScroll={(e) => {
        const el = e.currentTarget;
        const atBottom = nearBottom(el);
        stickRef.current = atBottom;
        if (atBottom) {
          frozenRef.current = false;
          setShowJump(false);
        }
      }}
      onWheel={(e) => {
        if (e.deltaY < 0) {
          frozenRef.current = true;
          stickRef.current = false;
          setShowJump(true);
        } else {
          const el = scrollerRef.current;
          if (el && nearBottom(el)) {
            frozenRef.current = false;
            stickRef.current = true;
          }
        }
      }}
    >
      <div className="mx-auto max-w-3xl space-y-8">
        {empty && onPickHint ? <EmptyChatHints onPick={onPickHint} /> : null}
        {messages.map((m) => (
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
                currentMatch={currentMatchId === m.id}
                canRetry={!sending && m.id === lastAssistantId}
                onRetry={onRetryLastAssistant}
              />
            )}
          </div>
        ))}
        {sending && (
          <div data-message-id="streaming">
            <AssistantMessage content={streaming} parts={streamingTools} streaming />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {showJump && (
        <button
          type="button"
          onClick={() => {
            frozenRef.current = false;
            stickRef.current = true;
            setShowJump(false);
            const el = scrollerRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
          className="anim-jump sticky bottom-4 z-10 mx-auto flex items-center gap-1 rounded-full border border-line bg-paper-raised px-3 py-1.5 text-xs text-ink shadow-[0_8px_30px_rgba(28,22,18,0.08)] transition-opacity duration-200"
        >
          <ArrowDown size={14} />
          跳到底部
        </button>
      )}
    </div>
  );
}
