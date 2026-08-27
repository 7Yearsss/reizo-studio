/**
 * Desktop is single-user and local-only — there's nothing to authenticate
 * against, so this replaces winlume's NextAuth session lookup
 * (src/lib/auth/session.ts) with a constant identity. Kept as its own
 * module (rather than inlined) so route handlers read the same "current
 * user" seam winlume's routes do, in case multi-profile support is ever
 * added later.
 */
export const LOCAL_USER_ID = 'local';

export function getCurrentUserId(): string {
  return LOCAL_USER_ID;
}
