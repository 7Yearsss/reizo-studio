/**
 * @deprecated Import from `src/shared/chat.ts` instead. This module now
 * re-exports the shared chat wire types for a transition period so existing
 * `../storage/ports` imports keep working.
 */
export type {
  ChatRole,
  ToolCallPart,
  ChatMessage,
  SessionSummary,
  Session,
  SessionPatch,
  SessionStore,
} from '../../../shared/chat';
