// Protects the player's anonymous identity in this browser.
//
// supabase-js keeps the session under one storage key and, when a stored
// session can no longer be renewed (refresh token rejected, user deleted),
// deletes it while the client starts, before the app can look at it. The
// app would then see "no session" and silently create a NEW anonymous user.
//
// This storage wrapper never deletes the stored session: a removal of the
// session key only hides it for this page (so supabase-js stays consistent)
// and is remembered as "lost". The stored value stays as it was. An
// explicit "start again" (startOver) also only hides it; the old session is
// replaced only when a new one is written, i.e. once a new anonymous user
// has really been created. Writes (a new or renewed session) go through.

/** The storage API supabase-js uses (a fake in the tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** supabase-js's default session key for a project URL: sb-<ref>-auth-token. */
export function authStorageKey(projectUrl: string): string {
  return `sb-${new URL(projectUrl).hostname.split(".")[0]}-auth-token`;
}

export interface SessionGuard {
  /** Give this to supabase-js as auth.storage. */
  storage: KeyValueStorage;
  /** A session was stored here before this page started. */
  readonly hadStoredSession: boolean;
  /** supabase-js tried to delete the stored session (kept, but hidden). */
  readonly blockedRemoval: boolean;
  /**
   * Explicit "start again": hides the stored session so a new one can be
   * created. Nothing is deleted: the old session is overwritten only when
   * the new one is saved, and is still there (and lost again) after a reload
   * if creating the new one fails.
   */
  startOver(): void;
}

export function guardSession(base: KeyValueStorage, sessionKey: string): SessionGuard {
  const hadStoredSession = safeGet(base, sessionKey) !== null;
  let hidden = false;
  let blockedRemoval = false;
  return {
    hadStoredSession,
    get blockedRemoval() {
      return blockedRemoval;
    },
    storage: {
      getItem: (key) => (key === sessionKey && hidden ? null : safeGet(base, key)),
      setItem: (key, value) => {
        if (key === sessionKey) hidden = false; // a new or renewed session is real again
        base.setItem(key, value);
      },
      removeItem: (key) => {
        if (key === sessionKey) {
          hidden = true;
          blockedRemoval = true;
          return; // never deleted here: only startOver() does that
        }
        base.removeItem(key);
      },
    },
    startOver() {
      hidden = true; // supabase-js now sees no session and may create one
      blockedRemoval = false;
    },
  };
}

function safeGet(storage: KeyValueStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** window.localStorage, or an in-memory stand-in when the browser blocks it. */
export function browserStorage(): KeyValueStorage {
  try {
    const ls = window.localStorage;
    const probe = "safe-chess.storage-probe";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    };
  }
}
