// The player's anonymous session: no name, e-mail or account. It is reused
// while it lasts (supabase-js keeps it in this browser), and a new one is
// created only on a first visit, when no session was ever stored here.
// Creating one makes an anonymous user in the project, so it is attempted
// ONCE per call, never retried. A stored session that cannot be restored is
// reported as "session_lost" and never replaced silently (see sessionGuard).

/** The part of supabase-js's auth API this needs (a fake in the tests). */
export interface AnonymousAuth {
  getSession(): Promise<{
    data: { session: { user: { id: string; is_anonymous?: boolean } } | null };
    error: unknown;
  }>;
  signInAnonymously(): Promise<{
    data: { user: { id: string; is_anonymous?: boolean } | null };
    error: unknown;
  }>;
}

export type SessionResult =
  | { status: "ok"; userId: string; created: boolean }
  /** A non-anonymous session is in this browser: friend mode will not use it. */
  | { status: "not_anonymous" }
  /** A session stored here could not be restored; only "start again" may replace it. */
  | { status: "session_lost" }
  | { status: "error" };

/** When a new anonymous user may be created (default: always, as on a first visit). */
export interface SessionPolicy {
  /** False once a session had been stored in this browser. */
  mayCreate(): boolean;
  /** True when the stored session could not be restored (supabase-js tried to delete it). */
  lost(): boolean;
}

const FIRST_VISIT: SessionPolicy = { mayCreate: () => true, lost: () => false };

/**
 * One session lookup at a time for the whole page: calls made while one is
 * in progress share it, so two quick taps (or React running an effect twice
 * in development) can never create two anonymous users. A failed lookup is
 * forgotten, so a later, deliberate attempt can try again.
 */
export function sharedSession(auth: AnonymousAuth, policy: SessionPolicy = FIRST_VISIT): () => Promise<SessionResult> {
  let pending: Promise<SessionResult> | null = null;
  return () => {
    pending ??= ensureAnonymousSession(auth, policy).then((result) => {
      if (result.status !== "ok") pending = null;
      return result;
    });
    return pending;
  };
}

export async function ensureAnonymousSession(auth: AnonymousAuth, policy: SessionPolicy = FIRST_VISIT): Promise<SessionResult> {
  try {
    const current = await auth.getSession();
    if (policy.lost()) return { status: "session_lost" };
    if (current.error) return { status: "error" }; // e.g. offline: the stored session is kept
    const user = current.data.session?.user;
    if (user) {
      return user.is_anonymous === true ? { status: "ok", userId: user.id, created: false } : { status: "not_anonymous" };
    }
    if (!policy.mayCreate()) return { status: "session_lost" };
    const created = await auth.signInAnonymously(); // once, never retried
    const newUser = created.data.user;
    if (created.error || !newUser || newUser.is_anonymous !== true) return { status: "error" };
    return { status: "ok", userId: newUser.id, created: true };
  } catch {
    return { status: "error" };
  }
}
