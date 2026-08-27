import { useEffect } from 'react';
import { FolderKanban } from 'lucide-react';
import * as chatStore from '../state/chatStore';
import * as uiStore from '../state/uiStore';
import { useChatStore } from '../state/useChatStore';
import { useUiStore } from '../state/useUiStore';
import MessageList from '../components/chat/MessageList';
import Composer from '../components/chat/Composer';
import { cn } from '../lib/cn';

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
  const sending = useChatStore((s) => s.sendingBySession[sessionId]) ?? false;
  const error = useChatStore((s) => s.errorBySession[sessionId]) ?? null;
  const artifactsOpen = useUiStore((s) => s.artifactsOpen);

  useEffect(() => {
    void chatStore.ensureSessionMessages(sessionId);
  }, [sessionId]);

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 px-8 pt-4 pb-2">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{session?.title ?? '对话'}</h1>
        <button
          type="button"
          onClick={() => uiStore.toggleArtifacts()}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]',
            artifactsOpen ? 'bg-paper-inset text-ink' : 'text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
          )}
          title="本会话作品"
        >
          <FolderKanban size={13} />
          作品
        </button>
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
        autoFocus={active}
      />
    </div>
  );
}
