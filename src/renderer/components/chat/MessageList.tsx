import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { ChatMessage, ToolCallPart } from '../../../main/server/storage/ports';
import UserMessage from './UserMessage';
import AssistantMessage from './AssistantMessage';

export default function MessageList({
  messages,
  streaming,
  streamingTools,
  sending,
}: {
  messages: ChatMessage[];
  streaming: string;
  streamingTools?: ToolCallPart[];
  sending: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    else setShowJump(true);
  }, [messages, streaming, streamingTools]);

  return (
    <div
      ref={scrollerRef}
      className="relative flex-1 overflow-y-auto px-8 pt-4 pb-40"
      onScroll={(e) => {
        const el = e.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        stickRef.current = atBottom;
        if (atBottom) setShowJump(false);
      }}
    >
      <div className="mx-auto max-w-3xl space-y-8">
        {messages.map((m) =>
          m.role === 'user' ? (
            <UserMessage key={m.id} content={m.content} />
          ) : (
            <AssistantMessage key={m.id} content={m.content} parts={m.parts} />
          ),
        )}
        {sending && (
          <AssistantMessage content={streaming} parts={streamingTools} streaming />
        )}
        <div ref={bottomRef} />
      </div>
      {showJump && (
        <button
          type="button"
          onClick={() => {
            stickRef.current = true;
            setShowJump(false);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="sticky bottom-4 left-1/2 z-10 mx-auto flex -translate-x-0 items-center gap-1 rounded-full border border-line bg-paper-raised px-3 py-1.5 text-xs text-ink shadow-[0_8px_30px_rgba(28,22,18,0.08)]"
        >
          <ArrowDown size={14} />
          跳到底部
        </button>
      )}
    </div>
  );
}
