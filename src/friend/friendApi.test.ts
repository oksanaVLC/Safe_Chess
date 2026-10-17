import { describe, expect, it, vi } from "vitest";
import { sharedSession, type AnonymousAuth } from "./anonymousSession";
import { cancelFriendGame, createFriendGame, displayJoinCode, joinLink, type Rpc } from "./friendApi";

const GAME = "aaaaaaaa-0000-4000-8000-000000000001";

function rpcReturning(data: unknown, error: unknown = null) {
  return vi.fn<Rpc>(async () => ({ data, error }));
}

describe("create_friend_game", () => {
  it("returns the game for 'created' and for 'existing' (a repeat is the same game)", async () => {
    for (const result of ["created", "existing"]) {
      const rpc = rpcReturning([{ result, id: GAME, join_code: "ABCDEFGH", expires_at: "2026-10-17T12:00:00Z" }]);
      expect(await createFriendGame(rpc)).toEqual({ status: "ok", gameId: GAME, code: "ABCDEFGH", expiresAt: "2026-10-17T12:00:00Z" });
      expect(rpc).toHaveBeenCalledWith("create_friend_game", {});
    }
  });

  it("treats anything else as an error", async () => {
    for (const rpc of [
      rpcReturning(null, { code: "42501" }),
      rpcReturning([]),
      rpcReturning([{ result: "already_joined", id: GAME, join_code: "ABCDEFGH", expires_at: "x" }]),
      rpcReturning([{ result: "created", id: 1, join_code: "ABCDEFGH", expires_at: "x" }]),
      vi.fn<Rpc>(async () => {
        throw new Error("offline");
      }),
    ]) {
      expect(await createFriendGame(rpc)).toEqual({ status: "error" });
    }
  });
});

describe("cancel_friend_game", () => {
  it("passes the game id and returns the server's answer", async () => {
    for (const result of ["cancelled", "already_joined", "ended", "not_found"] as const) {
      const rpc = rpcReturning([{ result, game_id: GAME }]);
      expect(await cancelFriendGame(rpc, GAME)).toBe(result);
      expect(rpc).toHaveBeenCalledWith("cancel_friend_game", { p_game: GAME });
    }
  });

  it("reports an error, never a guess", async () => {
    expect(await cancelFriendGame(rpcReturning(null, { message: "x" }), GAME)).toBe("error");
    expect(await cancelFriendGame(rpcReturning([{ result: "deleted" }]), GAME)).toBe("error");
  });
});

describe("join code display and link", () => {
  it("shows the code in two groups of four", () => {
    expect(displayJoinCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });

  it("builds the join link from the page's own origin", () => {
    expect(joinLink("https://safechess.example", "ABCDEFGH")).toBe("https://safechess.example/j?c=ABCDEFGH");
  });
});

describe("shared session", () => {
  it("creates at most one anonymous user for calls made at the same time", async () => {
    let resolveSignIn: (v: Awaited<ReturnType<AnonymousAuth["signInAnonymously"]>>) => void = () => {};
    const auth = {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      signInAnonymously: vi.fn(() => new Promise<Awaited<ReturnType<AnonymousAuth["signInAnonymously"]>>>((r) => (resolveSignIn = r))),
    };
    const get = sharedSession(auth);
    const [a, b] = [get(), get()];
    await vi.waitFor(() => expect(auth.signInAnonymously).toHaveBeenCalled());
    resolveSignIn({ data: { user: { id: "u1", is_anonymous: true } }, error: null });
    expect(await a).toEqual({ status: "ok", userId: "u1", created: true });
    expect(await b).toEqual({ status: "ok", userId: "u1", created: true });
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed attempt so a later tap can try again", async () => {
    const auth = {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      signInAnonymously: vi
        .fn()
        .mockResolvedValueOnce({ data: { user: null }, error: { message: "offline" } })
        .mockResolvedValueOnce({ data: { user: { id: "u2", is_anonymous: true } }, error: null }),
    };
    const get = sharedSession(auth);
    expect(await get()).toEqual({ status: "error" });
    expect(await get()).toEqual({ status: "ok", userId: "u2", created: true });
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(2);
  });
});
