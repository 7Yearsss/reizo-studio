import * as chatStore from '../../state/chatStore';
import { useChatStore } from '../../state/useChatStore';
import AskUserPrompt from './AskUserPrompt';
import PermissionPrompt from './PermissionPrompt';

/**
 * The pending ask/permission card, docked above the composer so it stays
 * reachable no matter where the message stream is scrolled (T3-style).
 */
export default function PendingInteraction({ sessionId }: { sessionId: string }) {
  const interaction = useChatStore((s) => s.interactionBySession[sessionId]) ?? null;
  if (!interaction) return null;

  return (
    <div data-message-id="pending-interaction">
      {interaction.kind === 'ask' ? (
        <AskUserPrompt
          pending={interaction}
          onAnswer={(answers) => void chatStore.answerAsk(sessionId, answers)}
          sessionId={sessionId}
        />
      ) : (
        <PermissionPrompt
          permission={interaction}
          onRespond={(decision) => void chatStore.answerPermission(sessionId, decision)}
        />
      )}
    </div>
  );
}
