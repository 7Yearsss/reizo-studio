const VALID = /^[\w-]{8,64}$/;

/** A client-chosen id for one user send; anything else is ignored rather than trusted. */
export function parseClientTurnId(value: unknown): string | undefined {
  return typeof value === 'string' && VALID.test(value) ? value : undefined;
}

export function newClientTurnId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `t-${random}`.slice(0, 64);
}

/** True when a user message with this client turn id is already in the session: the send is a retry, not a new turn. */
export function isDuplicateTurn(messages: ReadonlyArray<{ role: string; clientId?: string }>, clientTurnId: string | undefined): boolean {
  return Boolean(clientTurnId) && messages.some((m) => m.role === 'user' && m.clientId === clientTurnId);
}
