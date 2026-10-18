import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authStorageKey, guardSession, type KeyValueStorage } from "./sessionGuard";

// The session guard with the REAL supabase-js / auth-js (2.117.2): only the
// network (fetch) and the browser storage are fakes. Nothing leaves the
// process. These show what happens to a stored session whose access token
// has expired, for every answer the server could give to its renewal.

const URL = "https://abcdefghijklmnopqrst.supabase.co";
const KEY = "sb_publishable_TESTONLY";
const SESSION_KEY = authStorageKey(URL); // sb-abcdefghijklmnopqrst-auth-token
const OLD_USER = "27dbe869-6deb-47bf-a9de-dbd865c99266";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
  return { storage, map };
}

const nowSec = () => Math.floor(Date.now() / 1000);
function storedSession(userId: string, expiresAt: number, refresh = "refresh-TESTONLY-old") {
  return JSON.stringify({
    access_token: "access-TESTONLY-old",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: refresh,
    user: { id: userId, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} },
  });
}
function serverSession(userId: string, refresh: string) {
  return {
    access_token: `access-TESTONLY-${refresh}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: nowSec() + 3600,
    refresh_token: refresh,
    user: { id: userId, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} },
  };
}

type TokenAnswer = "renewed" | "rejected" | "offline";

/** A fake Supabase Auth: counts sign-ups and answers the renewal (and sign-up) as asked. */
function fakeAuthServer(token: TokenAnswer, signup: "ok" | "fail" = "ok") {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = url.slice(URL.length).replace(/\?.*$/, "");
    calls.push(path);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (path === "/auth/v1/token") {
      if (token === "offline") throw new TypeError("fetch failed");
      if (token === "rejected") {
        return json(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
      }
      return json(200, serverSession(OLD_USER, "refresh-TESTONLY-renewed"));
    }
    if (path === "/auth/v1/signup") {
      if (signup === "fail") return json(500, { code: 500, msg: "fake: sign-up failed" });
      return json(200, serverSession("99999999-9999-4999-8999-999999999999", "refresh-TESTONLY-new"));
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, signups: () => calls.filter((c) => c === "/auth/v1/signup").length };
}

let createFriendClient: typeof import("./supabaseClient").createFriendClient;
beforeAll(async () => {
  ({ createFriendClient } = await import("./supabaseClient"));
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("session guard (storage wrapper)", () => {
  it("uses supabase-js's default key, so sessions stored before are found", () => {
    expect(authStorageKey("https://xdlogeybfclsmqizuaal.supabase.co")).toBe("sb-xdlogeybfclsmqizuaal-auth-token");
  });

  it("never deletes the stored session: removal and startOver only hide it", () => {
    const { storage, map } = memoryStorage({ [SESSION_KEY]: "stored", other: "x" });
    const guard = guardSession(storage, SESSION_KEY);
    expect(guard.hadStoredSession).toBe(true);
    guard.storage.removeItem(SESSION_KEY);
    expect(map.get(SESSION_KEY)).toBe("stored"); // still there
    expect(guard.storage.getItem(SESSION_KEY)).toBeNull(); // hidden for this page
    expect(guard.blockedRemoval).toBe(true);
    guard.storage.removeItem("other"); // other keys behave normally
    expect(map.has("other")).toBe(false);
    guard.startOver();
    expect(map.get(SESSION_KEY)).toBe("stored"); // still not deleted
    expect(guard.storage.getItem(SESSION_KEY)).toBeNull();
    expect(guard.blockedRemoval).toBe(false);
  });

  it("lets a new or renewed session be written", () => {
    const { storage, map } = memoryStorage({ [SESSION_KEY]: "stored" });
    const guard = guardSession(storage, SESSION_KEY);
    guard.storage.removeItem(SESSION_KEY);
    guard.storage.setItem(SESSION_KEY, "renewed");
    expect(map.get(SESSION_KEY)).toBe("renewed");
    expect(guard.storage.getItem(SESSION_KEY)).toBe("renewed");
  });
});

describe("a stored session whose access token has expired (real auth-js, fake network)", () => {
  const expired = () => storedSession(OLD_USER, nowSec() - 600);

  it("renewal accepted: the same player continues, no sign-up", async () => {
    const server = fakeAuthServer("renewed");
    const { storage, map } = memoryStorage({ [SESSION_KEY]: expired() });
    const friend = createFriendClient(URL, KEY, storage, server.fetchImpl);
    expect(await friend.session()).toEqual({ status: "ok", userId: OLD_USER, created: false });
    expect(server.signups()).toBe(0);
    expect(JSON.parse(map.get(SESSION_KEY)!).refresh_token).toBe("refresh-TESTONLY-renewed"); // rotated token kept
  });

  it("renewal rejected for good: no new player, the stored session left untouched", async () => {
    const server = fakeAuthServer("rejected");
    const before = expired();
    const { storage, map } = memoryStorage({ [SESSION_KEY]: before });
    const friend = createFriendClient(URL, KEY, storage, server.fetchImpl);
    const [a, b] = await Promise.all([friend.session(), friend.session()]); // two calls at the same time
    expect(a).toEqual({ status: "session_lost" });
    expect(b).toEqual({ status: "session_lost" });
    expect(await friend.session()).toEqual({ status: "session_lost" }); // asking again changes nothing
    expect(server.signups()).toBe(0);
    expect(map.get(SESSION_KEY)).toBe(before); // byte for byte
  });

  it("offline during renewal: an error, no new player, the stored session left untouched", async () => {
    const server = fakeAuthServer("offline");
    const before = expired();
    const { storage, map } = memoryStorage({ [SESSION_KEY]: before });
    const friend = createFriendClient(URL, KEY, storage, server.fetchImpl);
    const result = await friend.session();
    expect(["error", "session_lost"]).toContain(result.status);
    expect(result.status).toBe("error");
    expect(server.signups()).toBe(0);
    expect(map.get(SESSION_KEY)).toBe(before);
  }, 60_000); // auth-js retries an offline renewal for about 30 s

  it("only 'Start again' creates a new player, once, after a lost session", async () => {
    const server = fakeAuthServer("rejected");
    const { storage, map } = memoryStorage({ [SESSION_KEY]: expired() });
    const friend = createFriendClient(URL, KEY, storage, server.fetchImpl);
    expect((await friend.session()).status).toBe("session_lost");
    expect(server.signups()).toBe(0);
    const fresh = await friend.startOver();
    expect(fresh).toEqual({ status: "ok", userId: "99999999-9999-4999-8999-999999999999", created: true });
    expect(server.signups()).toBe(1);
    expect(JSON.parse(map.get(SESSION_KEY)!).user.id).toBe("99999999-9999-4999-8999-999999999999");
    expect(await friend.session()).toEqual(fresh); // no second sign-up
    expect(server.signups()).toBe(1);
  });
});

describe("after a lost session (real auth-js, fake network)", () => {
  const expired = () => storedSession(OLD_USER, nowSec() - 600);

  it("stays lost after a reload: a new page on the same storage creates nobody", async () => {
    const server = fakeAuthServer("rejected");
    const before = expired();
    const { storage, map } = memoryStorage({ [SESSION_KEY]: before });
    expect((await createFriendClient(URL, KEY, storage, server.fetchImpl).session()).status).toBe("session_lost");
    // the reload: a brand-new client on the same browser storage
    const reloaded = createFriendClient(URL, KEY, storage, server.fetchImpl);
    expect(await reloaded.session()).toEqual({ status: "session_lost" });
    expect(server.signups()).toBe(0);
    expect(map.get(SESSION_KEY)).toBe(before);
  });

  it("a failed 'Start again' keeps the old session, and a reload shows the loss again", async () => {
    const server = fakeAuthServer("rejected", "fail");
    const before = expired();
    const { storage, map } = memoryStorage({ [SESSION_KEY]: before });
    const friend = createFriendClient(URL, KEY, storage, server.fetchImpl);
    expect((await friend.session()).status).toBe("session_lost");
    expect(await friend.startOver()).toEqual({ status: "error" });
    expect(server.signups()).toBe(1); // the one requested attempt
    expect(map.get(SESSION_KEY)).toBe(before); // not deleted, not replaced
    const reloaded = createFriendClient(URL, KEY, storage, server.fetchImpl);
    expect(await reloaded.session()).toEqual({ status: "session_lost" }); // not a "first visit"
    expect(server.signups()).toBe(1);
  });

  it("two 'Start again' taps at once, or one after it worked, create one player only", async () => {
    const server = fakeAuthServer("rejected");
    const { storage } = memoryStorage({ [SESSION_KEY]: expired() });
    const friend = createFriendClient(URL, KEY, storage, server.fetchImpl);
    expect((await friend.session()).status).toBe("session_lost");
    const [a, b] = await Promise.all([friend.startOver(), friend.startOver()]);
    expect(a.status).toBe("ok");
    expect(b).toEqual(a);
    expect(await friend.startOver()).toEqual(a);
    expect(server.signups()).toBe(1);
  });
});

describe("other cases (real auth-js, fake network)", () => {
  it("first visit (nothing stored): one anonymous player is created, as before", async () => {
    const server = fakeAuthServer("renewed");
    const { storage } = memoryStorage();
    const friend = createFriendClient(URL, KEY, storage, server.fetchImpl);
    const [a, b] = await Promise.all([friend.session(), friend.session()]);
    expect(a.status).toBe("ok");
    expect(b).toEqual(a);
    expect(server.signups()).toBe(1);
  });

  it("a stored session still valid: used as is, no network call at all", async () => {
    const server = fakeAuthServer("rejected");
    const { storage } = memoryStorage({ [SESSION_KEY]: storedSession(OLD_USER, nowSec() + 3000) });
    const friend = createFriendClient(URL, KEY, storage, server.fetchImpl);
    expect(await friend.session()).toEqual({ status: "ok", userId: OLD_USER, created: false });
    expect(server.calls).toEqual([]);
  });

  it("a corrupted stored session is not replaced silently", async () => {
    const server = fakeAuthServer("renewed");
    const { storage, map } = memoryStorage({ [SESSION_KEY]: JSON.stringify({ not: "a session" }) });
    const friend = createFriendClient(URL, KEY, storage, server.fetchImpl);
    expect(await friend.session()).toEqual({ status: "session_lost" });
    expect(server.signups()).toBe(0);
    expect(map.get(SESSION_KEY)).toBe(JSON.stringify({ not: "a session" }));
  });
});
