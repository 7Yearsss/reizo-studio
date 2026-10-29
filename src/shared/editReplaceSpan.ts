/** How many messages (the edited one included) a resend from `fromId` will replace; 0 when it is not in the list. */
export function replacedMessageCount(messages: readonly { id: string }[], fromId: string | undefined): number {
  if (!fromId) return 0;
  const index = messages.findIndex((m) => m.id === fromId);
  return index < 0 ? 0 : messages.length - index;
}
