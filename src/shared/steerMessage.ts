/** Mid-turn steers are created with a `steer-` client id and the persisted user message keeps it. */
export const STEER_ID_PREFIX = 'steer-';

export function isSteeredMessage(id: string | undefined): boolean {
  return typeof id === 'string' && id.startsWith(STEER_ID_PREFIX);
}
