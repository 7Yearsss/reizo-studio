/** ChatPage → Composer hand-off for files dropped anywhere on the conversation. */
export const CHAT_DROP_FILES_EVENT = 'reizo:chat-drop-files';

export function dispatchChatDrop(sessionId: string, files: File[]) {
  window.dispatchEvent(new CustomEvent(CHAT_DROP_FILES_EVENT, { detail: { sessionId, files } }));
}
