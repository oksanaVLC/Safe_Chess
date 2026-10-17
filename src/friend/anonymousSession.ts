// The player's anonymous session: no name, e-mail or account. It is reused
// while it lasts (supabase-js keeps it in this browser), and a new one is
// created only when there is none. Creating one makes an anonymous user in
// the project, so it is attempted ONCE per call, never retried.

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
  | { status: "error" };

/**
 * One session lookup at a time for the whole page: calls made while one is
 * in progress share it, so two quick taps (or React running an effect twice
 * in development) can never create two anonymous users. A failed lookup is
 * forgotten, so a later, deliberate attempt can try again.
 */
export function sharedSession(auth: AnonymousAuth): () => Promise<SessionResult> {
  let pending: Promise<SessionResult> | null = null;
  return () => {
    pending ??= ensureAnonymousSession(auth).then((result) => {
      if (result.status !== "ok") pending = null;
      return result;
    });
    return pending;
  };
}

export async function ensureAnonymousSession(auth: AnonymousAuth): Promise<SessionResult> {
  try {
    const current = await auth.getSession();
    if (current.error) return { status: "error" };
    const user = current.data.session?.user;
    if (user) {
      return user.is_anonymous === true ? { status: "ok", userId: user.id, created: false } : { status: "not_anonymous" };
    }
    const created = await auth.signInAnonymously(); // once, never retried
    const newUser = created.data.user;
    if (created.error || !newUser || newUser.is_anonymous !== true) return { status: "error" };
    return { status: "ok", userId: newUser.id, created: true };
  } catch {
    return { status: "error" };
  }
}
