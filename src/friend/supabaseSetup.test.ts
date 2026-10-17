import { describe, expect, it, vi } from "vitest";
import { ensureAnonymousSession, type AnonymousAuth } from "./anonymousSession";
import { checkPublicConfig } from "./publicConfig";

const URL = "https://abcdefghijklmnopqrst.supabase.co";
const KEY = "sb_publishable_TESTONLY-value";

describe("public Supabase settings", () => {
  it("accepts the project URL and a publishable key", () => {
    expect(checkPublicConfig(URL, KEY)).toEqual({ status: "ok", url: URL, publishableKey: KEY });
    expect(checkPublicConfig(` ${URL} `, ` ${KEY}\n`)).toEqual({ status: "ok", url: URL, publishableKey: KEY });
  });

  it("treats no settings as 'missing' (robot modes still build)", () => {
    expect(checkPublicConfig(undefined, undefined)).toEqual({ status: "missing" });
    expect(checkPublicConfig("", "  ")).toEqual({ status: "missing" });
  });

  it("never lets a secret key or a JWT through, and never repeats the value", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.TESTONLY";
    for (const bad of ["sb_secret_TESTONLY-value", jwt, "TESTONLY-random", ""]) {
      const result = checkPublicConfig(URL, bad);
      expect(result.status, bad).toBe("invalid");
      expect(JSON.stringify(result)).not.toMatch(/TESTONLY|eyJ/);
    }
    expect(checkPublicConfig(URL, "sb_secret_TESTONLY")).toEqual({
      status: "invalid",
      error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a SECRET key",
    });
  });

  it("accepts only an https project URL on supabase.co", () => {
    for (const bad of ["http://abcdefghijklmnopqrst.supabase.co", "https://evil.example", `${URL}/`, `${URL}/rest/v1`, "", undefined]) {
      expect(checkPublicConfig(bad, KEY).status, String(bad)).toBe("invalid");
    }
  });
});

function fakeAuth(session: { id: string; is_anonymous?: boolean } | null, signIn?: Partial<Awaited<ReturnType<AnonymousAuth["signInAnonymously"]>>>) {
  return {
    getSession: vi.fn(async () => ({ data: { session: session ? { user: session } : null }, error: null })),
    signInAnonymously: vi.fn(async () => ({ data: { user: { id: "new-user", is_anonymous: true } }, error: null, ...signIn })),
  };
}

describe("anonymous session", () => {
  it("reuses the session already in this browser", async () => {
    const auth = fakeAuth({ id: "u1", is_anonymous: true });
    expect(await ensureAnonymousSession(auth)).toEqual({ status: "ok", userId: "u1", created: false });
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("creates one only when there is none", async () => {
    const auth = fakeAuth(null);
    expect(await ensureAnonymousSession(auth)).toEqual({ status: "ok", userId: "new-user", created: true });
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("never retries a failed sign-in", async () => {
    const auth = fakeAuth(null, { data: { user: null }, error: { message: "rate limited" } });
    expect(await ensureAnonymousSession(auth)).toEqual({ status: "error" });
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
    const throwing = { getSession: auth.getSession, signInAnonymously: vi.fn(async () => { throw new Error("offline"); }) };
    expect(await ensureAnonymousSession(throwing)).toEqual({ status: "error" });
    expect(throwing.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("does not use a non-anonymous session, and does not replace it", async () => {
    const auth = fakeAuth({ id: "registered", is_anonymous: false });
    expect(await ensureAnonymousSession(auth)).toEqual({ status: "not_anonymous" });
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("rejects a sign-in that does not return an anonymous user", async () => {
    const auth = fakeAuth(null, { data: { user: { id: "x", is_anonymous: false } } });
    expect(await ensureAnonymousSession(auth)).toEqual({ status: "error" });
  });
});
