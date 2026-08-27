import { useEffect } from 'react';
import * as chatStore from '../state/chatStore';
import { useChatStore } from '../state/useChatStore';
import MessageList from '../components/chat/MessageList';
import Composer from '../components/chat/Composer';

export default function ChatPage({
  sessionId,
  onToggleTree,
  treeOpen,
}: {
  sessionId: string;
  onToggleTree?: () => void;
  treeOpen?: boolean;
}) {
  const session = useChatStore((s) => s.sessions.find((x) => x.id === sessionId));
  const messages = useChatStore((s) => s.messagesBySession[sessionId]) ?? [];
  const streaming = useChatStore((s) => s.streamingBySession[sessionId]) ?? '';
  const streamingTools = useChatStore((s) => s.streamingToolsBySession[sessionId]) ?? [];
  const sending = useChatStore((s) => s.sendingBySession[sessionId]) ?? false;
  const error = useChatStore((s) => s.errorBySession[sessionId]) ?? null;

  useEffect(() => {
    void chatStore.ensureSessionMessages(sessionId);
  }, [sessionId]);

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      <header className="flex shrink-0 items-center px-8 pt-4 pb-2">
        <h1 className="truncate text-lg font-semibold tracking-tight">{session?.title ?? '对话'}</h1>
      </header>
      <MessageList
        messages={messages}
        streaming={streaming}
        streamingTools={streamingTools}
        sending={sending}
      />
      {error && <p className="px-8 pb-2 text-sm text-danger">{error}</p>}
      <Composer
        sessionId={sessionId}
        disabled={false}
        sending={sending}
        onSend={(text, mentions, extra) => void chatStore.sendMessage(sessionId, text, mentions, extra)}
        onStop={() => void chatStore.stopMessage(sessionId)}
        onToggleTree={onToggleTree}
        treeOpen={treeOpen}
      />
    </div>
  );
}
