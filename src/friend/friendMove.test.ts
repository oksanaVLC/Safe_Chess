import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { GameController } from "@/game/GameController";
import { applyUci, outcome, replay, type Outcome } from "../../supabase/functions/_shared/friendRules";
import {
  apiKeysFrom,
  configErrorResponse,
  handleFriendMove,
  parseMoveRequest,
  type FriendMoveDeps,
} from "../../supabase/functions/friend-move/handler";

// The friend-move Edge Function, run in Node against a fake Supabase:
// Auth answers for known tokens, PostgREST applies the games_select_players
// rule (players only) and the RPC imitates apply_friend_move's checks.
// No network, no Deno, no database.

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const SUPABASE = "https://project.supabase.test";
const ANON = "anon-publishable-key";
/** A JWT-shaped test value with the given payload and a made-up signature. */
function fakeJwt(payload: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}.TESTONLY-signature`;
}
const FAR_FUTURE = 4102444800; // 2100-01-01, seconds
const SERVICE = fakeJwt({ iss: "supabase-test", role: "service_role", exp: FAR_FUTURE }); // legacy service_role JWT
const SB_SECRET = "sb_secret_TESTONLY-marker"; // a modern secret key (not a JWT)
const ORIGIN = "http://localhost:3000";
const GAME = "aaaaaaaa-0000-4000-8000-000000000001";
const WHITE = "11111111-1111-4111-8111-111111111111";
const BLACK = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const REGISTERED = "44444444-4444-4444-8444-444444444444";

const USERS: Record<string, { id: string; is_anonymous: boolean }> = {
  "token-white": { id: WHITE, is_anonymous: true },
  "token-black": { id: BLACK, is_anonymous: true },
  "token-stranger": { id: STRANGER, is_anonymous: true },
  "token-registered": { id: REGISTERED, is_anonymous: false },
};

type Row = Record<string, unknown> & { id: string; moves: string[]; fen: string; version: number };

/** An active game after the given moves (version: join 1, then +1 per move). */
function game(moves: string[] = [], extra: Partial<Row> = {}): Row {
  const chess = replay(moves);
  if (!chess) throw new Error("bad fixture");
  return {
    id: GAME,
    join_code: "ABCDEFGH",
    status: "active",
    white_id: WHITE,
    black_id: BLACK,
    moves,
    fen: chess.fen(),
    version: 1 + moves.length,
    end_reason: null,
    winner: null,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ended_at: null,
    ...extra,
  };
}

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

interface FakeOptions {
  rpc?: (params: Record<string, unknown>) => unknown;
  /** Replaces Auth's answer to /auth/v1/user. */
  auth?: () => Response;
  /** Replaces PostgREST's answer to the game read. */
  read?: () => Response;
}

const errorReply = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
// The API gateway's answer to a wrong or missing API key
const INVALID_API_KEY = { message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." };

function fakeSupabase(rows: Row[], opts: FakeOptions = {}) {
  const calls: Call[] = [];
  let serviceKeyReads = 0;

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ url, headers, body });
    const token = headers.authorization?.replace(/^Bearer /, "") ?? "";
    const reply = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

    if (url === `${SUPABASE}/auth/v1/user`) {
      if (opts.auth) return opts.auth();
      if (headers.apikey !== ANON) return reply(401, INVALID_API_KEY);
      const user = USERS[token];
      return user ? reply(200, user) : reply(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
    }
    if (url.startsWith(`${SUPABASE}/rest/v1/games?`)) {
      if (opts.read) return opts.read();
      const user = USERS[token];
      if (headers.apikey !== ANON) return reply(401, INVALID_API_KEY);
      if (!user) return reply(401, { code: "PGRST301", message: "No suitable key or wrong key type" });
      const id = new URL(url).searchParams.get("id")?.replace(/^eq\./, "");
      // games_select_players: only the two players see the row
      return reply(200, rows.filter((r) => r.id === id && (r.white_id === user.id || r.black_id === user.id)));
    }
    if (url === `${SUPABASE}/rest/v1/rpc/apply_friend_move`) {
      // gateway: a known API key; an sb_ key is never a valid Bearer token
      if (headers.authorization?.startsWith("Bearer sb_")) return reply(401, { message: "Invalid JWT" });
      if (headers.apikey !== SERVICE && headers.apikey !== SB_SECRET) return reply(401, INVALID_API_KEY);
      // apply_friend_move check A: the JWT's role must be service_role
      if (token !== SERVICE) return reply(400, { code: "P0001", message: "apply_friend_move: forbidden" });
      const p = JSON.parse(body ?? "{}") as Record<string, unknown>;
      if (opts.rpc) return reply(200, opts.rpc(p));
      const o = rows.find((r) => r.id === p.p_game);
      if (!o || (p.p_uid !== o.white_id && p.p_uid !== o.black_id)) return reply(200, [{ result: "not_found", game: null }]);
      if (o.status !== "active") return reply(200, [{ result: "not_active", game: o }]);
      if (o.version !== p.p_expected_version) return reply(200, [{ result: "stale", game: o }]);
      const side = o.fen.split(" ")[1];
      if ((side === "w" ? o.white_id : o.black_id) !== p.p_uid) return reply(200, [{ result: "not_your_turn", game: o }]);
      const n: Row = {
        ...o,
        moves: [...o.moves, p.p_uci as string],
        version: o.version + 1,
        fen: p.p_new_fen as string,
        status: p.p_end_reason ? "finished" : "active",
        end_reason: p.p_end_reason,
        winner: p.p_winner,
      };
      rows[rows.indexOf(o)] = n;
      return reply(200, [{ result: "ok", game: n }]);
    }
    return reply(404, {});
  }) as typeof fetch;

  const deps: FriendMoveDeps = {
    supabaseUrl: SUPABASE,
    anonKey: ANON,
    serverCredentials: () => {
      serviceKeyReads += 1;
      return { apikey: SERVICE, jwt: SERVICE };
    },
    allowedOrigins: [ORIGIN],
    fetch: fakeFetch,
    now: () => Date.now(),
  };
  return {
    deps,
    calls,
    rows,
    rpcCalls: () => calls.filter((c) => c.url.endsWith("/rpc/apply_friend_move")),
    serviceKeyReads: () => serviceKeyReads,
  };
}

function request(
  body: unknown,
  { token = "token-white", origin = ORIGIN, method = "POST" }: { token?: string | null; origin?: string | null; method?: string } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (origin !== null) headers.origin = origin;
  return new Request(`${SUPABASE}/functions/v1/friend-move`, {
    method,
    headers,
    body: method === "GET" || method === "OPTIONS" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function send(rows: Row[], body: unknown, options?: Parameters<typeof request>[1], fakeOpts?: Parameters<typeof fakeSupabase>[1]) {
  const fake = fakeSupabase(rows, fakeOpts);
  const res = await handleFriendMove(request(body, options), fake.deps);
  const text = await res.text();
  return { res, text, data: text ? (JSON.parse(text) as Record<string, unknown>) : null, ...fake };
}

const move = (uci: string, expectedVersion = 1) => ({ gameId: GAME, expectedVersion, uci });

// ---------------------------------------------------------------------

describe("friend-move: legal moves", () => {
  it("writes a legal move with values computed on the server", async () => {
    const r = await send([game()], move("e2e4"));
    expect(r.res.status).toBe(200);
    expect(r.data?.result).toBe("ok");
    const [rpc] = r.rpcCalls();
    expect(JSON.parse(rpc.body!)).toEqual({
      p_game: GAME,
      p_uid: WHITE,
      p_expected_version: 1,
      p_uci: "e2e4",
      p_new_fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      p_end_reason: null,
      p_winner: null,
    });
    expect((r.data?.game as Row).version).toBe(2);
  });

  it("lets Black answer on the next version", async () => {
    const r = await send([game(["e2e4"])], move("e7e5", 2), { token: "token-black" });
    expect(r.res.status).toBe(200);
    expect(JSON.parse(r.rpcCalls()[0].body!).p_uid).toBe(BLACK);
  });

  it("finishes the game on checkmate, winner = the side that moved", async () => {
    const r = await send([game(["f2f3", "e7e5", "g2g4"])], move("d8h4", 4), { token: "token-black" });
    expect(r.res.status).toBe(200);
    const p = JSON.parse(r.rpcCalls()[0].body!);
    expect([p.p_end_reason, p.p_winner]).toEqual(["checkmate", "b"]);
    expect((r.data?.game as Row).status).toBe("finished");
  });

  it("detects threefold repetition from the replayed history", async () => {
    const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1"];
    const r = await send([game(shuffle)], move("f6g8", 1 + shuffle.length), { token: "token-black" });
    expect(JSON.parse(r.rpcCalls()[0].body!).p_end_reason).toBe("repetition");
  });

  it("accepts a promotion only with its piece", async () => {
    // White pawn reaches b7; b7a8 captures the rook and promotes
    const path = ["b2b4", "a7a5", "b4a5", "b7b6", "a5b6", "c7c6", "b6b7", "c6c5"];
    const promo = await send([game(path)], move("b7a8q", 1 + path.length));
    expect(promo.res.status).toBe(200);
    const plain = await send([game(path)], move("b7a8", 1 + path.length));
    expect([plain.res.status, plain.data?.result]).toEqual([422, "illegal"]);
    expect(plain.rpcCalls()).toHaveLength(0);
  });
});

describe("friend-move: rejected moves", () => {
  it("rejects an illegal move without writing", async () => {
    const r = await send([game()], move("e2e5"));
    expect([r.res.status, r.data?.result]).toEqual([422, "illegal"]);
    expect(r.rpcCalls()).toHaveLength(0);
    expect(r.serviceKeyReads()).toBe(0);
  });

  it("rejects a move from an empty square or of the opponent's piece", async () => {
    for (const uci of ["e3e4", "e7e5"]) {
      const r = await send([game()], move(uci));
      expect(r.res.status, uci).toBe(422);
    }
  });

  it("rejects a promotion piece on a move that is not a promotion", async () => {
    const r = await send([game()], move("e2e4q"));
    expect(r.res.status).toBe(422);
  });

  it("rejects a move when it is not the caller's turn", async () => {
    const r = await send([game()], move("e7e5"), { token: "token-black" });
    expect([r.res.status, r.data?.result]).toEqual([403, "not_your_turn"]);
    expect(r.rpcCalls()).toHaveLength(0);
  });

  it("answers 404 to a user who is not a player, the same as a missing game", async () => {
    const stranger = await send([game()], move("e2e4"), { token: "token-stranger" });
    const missing = await send([], move("e2e4"));
    expect([stranger.res.status, stranger.text]).toEqual([404, missing.text]);
    expect(stranger.rpcCalls()).toHaveLength(0);
  });

  it("rejects a move in a finished or expired game", async () => {
    const finished = game(["f2f3", "e7e5", "g2g4", "d8h4"], { status: "finished", end_reason: "checkmate", winner: "b" });
    const r1 = await send([finished], move("e1f2", 5));
    expect([r1.res.status, r1.data?.result]).toEqual([409, "not_active"]);
    const expired = await send([game([], { status: "expired", end_reason: "expired", version: 2 })], move("e2e4", 2));
    expect(expired.data?.result).toBe("not_active");
    const overdue = await send([game([], { expires_at: new Date(Date.now() - 1000).toISOString() })], move("e2e4"));
    expect(overdue.data?.result).toBe("not_active");
    for (const r of [r1, expired, overdue]) expect(r.rpcCalls()).toHaveLength(0);
  });

  it("rejects a waiting game (no Black yet)", async () => {
    const r = await send([game([], { status: "waiting", black_id: null, version: 0 })], move("e2e4", 0));
    expect(r.data?.result).toBe("not_active");
  });

  it("answers stale for an old or future version", async () => {
    for (const v of [0, 2]) {
      const r = await send([game()], move("e2e4", v));
      expect([r.res.status, r.data?.result]).toEqual([409, "stale"]);
      expect(r.rpcCalls()).toHaveLength(0);
    }
  });

  it("passes on the database's answer when it loses a race", async () => {
    const r = await send([game()], move("e2e4"), {}, { rpc: () => [{ result: "stale", game: game(["d2d4"]) }] });
    expect([r.res.status, r.data?.result]).toEqual([409, "stale"]);
  });

  it("refuses to move when the stored history does not give the stored position", async () => {
    const tampered = game(["e2e4"], { fen: START.replace(" w ", " b ") });
    const r = await send([tampered], move("e7e5", 2), { token: "token-black" });
    expect([r.res.status, r.data?.result]).toEqual([500, "server_error"]);
    expect(r.rpcCalls()).toHaveLength(0);
  });

  it("refuses an illegal move hidden in the stored history", async () => {
    const r = await send([{ ...game(), moves: ["e2e5"], version: 2 }], move("e7e5", 2), { token: "token-black" });
    expect(r.res.status).toBe(500);
    expect(r.rpcCalls()).toHaveLength(0);
  });
});

describe("friend-move: identity and access", () => {
  it("needs a token", async () => {
    const r = await send([game()], move("e2e4"), { token: null });
    expect([r.res.status, r.data?.result]).toEqual([401, "unauthorized"]);
    expect(r.calls).toHaveLength(0);
  });

  it("rejects a token Supabase Auth does not accept", async () => {
    const r = await send([game()], move("e2e4"), { token: "token-unknown" });
    expect(r.res.status).toBe(401);
    expect(r.rpcCalls()).toHaveLength(0);
  });

  it("rejects a user who is not anonymous", async () => {
    const r = await send([game([], { white_id: REGISTERED })], move("e2e4"), { token: "token-registered" });
    expect([r.res.status, r.data?.result]).toEqual([403, "not_anonymous"]);
  });

  it("answers 401 to every session error Auth reports", async () => {
    for (const status of [401, 403]) {
      for (const code of ["bad_jwt", "no_authorization", "session_not_found", "session_expired", "user_not_found", "user_banned"]) {
        const r = await send([game()], move("e2e4"), {}, { auth: () => errorReply(status, { code: status, error_code: code, msg: "x" }) });
        expect([r.res.status, r.data?.result], `${status} ${code}`).toEqual([401, "unauthorized"]);
        expect(r.rpcCalls()).toHaveLength(0);
      }
    }
  });

  it("lets a session error code win over a message that mentions the API key", async () => {
    const r = await send([game()], move("e2e4"), {}, {
      auth: () => errorReply(403, { error_code: "session_not_found", msg: "Session not found", hint: "check the API key" }),
    });
    expect(r.res.status).toBe(401);
  });

  it("keeps an unrecognised Auth refusal a session error (documented default)", async () => {
    for (const body of [{}, { msg: "something else" }, "not json"]) {
      const r = await send([game()], move("e2e4"), {}, {
        auth: () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 401 }),
      });
      expect(r.res.status, JSON.stringify(body)).toBe(401);
    }
  });

  it("answers 503, not 401, when Auth refuses the function's own API key", async () => {
    const fake = fakeSupabase([game()]);
    fake.deps.anonKey = "wrong-anon-key";
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      const res = await handleFriendMove(request(move("e2e4")), fake.deps);
      expect([res.status, (await res.json()).result]).toEqual([503, "unavailable"]);
    } finally {
      console.error = original;
    }
    expect(fake.rpcCalls()).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors)).not.toMatch(/wrong-anon-key|token-white/);
    const noKey = await send([game()], move("e2e4"), {}, { auth: () => errorReply(401, { message: "No API key found in request" }) });
    expect(noKey.res.status).toBe(503);
  });

  it("answers 503 when the game read is refused after Auth accepted the token", async () => {
    const refusals: [number, unknown][] = [
      [401, INVALID_API_KEY],
      [401, { code: "PGRST301", message: "No suitable key or wrong key type" }],
      [401, { code: "PGRST302", message: "Anonymous access is disabled" }],
      [403, { code: "42501", message: "permission denied for table games" }],
      [401, {}],
    ];
    for (const [status, body] of refusals) {
      const r = await send([game()], move("e2e4"), {}, { read: () => errorReply(status, body) });
      expect([r.res.status, r.data?.result], JSON.stringify(body)).toEqual([503, "unavailable"]);
      expect(r.rpcCalls()).toHaveLength(0);
    }
  });

  it("answers 401 when the token expired between the Auth check and the read", async () => {
    const r = await send([game()], move("e2e4"), {}, { read: () => errorReply(401, { code: "PGRST303", message: "JWT expired" }) });
    expect([r.res.status, r.data?.result]).toEqual([401, "unauthorized"]);
    const notExpired = await send([game()], move("e2e4"), {}, { read: () => errorReply(403, { code: "PGRST303", message: "JWT expired" }) });
    expect(notExpired.res.status).toBe(503);
  });

  it("answers 503, not 401, when Auth cannot be reached", async () => {
    const fake = fakeSupabase([game()]);
    fake.deps.fetch = (async () => {
      throw new TypeError("network");
    }) as typeof fetch;
    const res = await handleFriendMove(request(move("e2e4")), fake.deps);
    expect(res.status).toBe(503);
  });

  it("takes identity, colour and position only from the server", async () => {
    for (const extra of [{ uid: BLACK }, { color: "b" }, { fen: START }, { endReason: "checkmate" }, { winner: "w" }]) {
      const r = await send([game()], { ...move("e2e4"), ...extra });
      expect([r.res.status, r.data?.result], JSON.stringify(extra)).toEqual([400, "bad_request"]);
      expect(r.calls).toHaveLength(0);
    }
  });

  it("uses the caller's token to read and the service key only for the write", async () => {
    const r = await send([game()], move("e2e4"));
    const [auth, read, write] = r.calls;
    expect(auth.headers).toMatchObject({ apikey: ANON, authorization: "Bearer token-white" });
    expect(read.headers).toMatchObject({ apikey: ANON, authorization: "Bearer token-white" });
    expect(write.headers).toMatchObject({ apikey: SERVICE, authorization: `Bearer ${SERVICE}` });
    expect(r.serviceKeyReads()).toBe(1);
    expect(r.text).not.toContain(SERVICE);
    expect(JSON.stringify(r.res.headers)).not.toContain(SERVICE);
  });

  it("never reads the service key before the move is known to be valid", async () => {
    for (const [body, token] of [
      [move("e2e5"), "token-white"],
      [move("e7e5"), "token-black"],
      [move("e2e4"), "token-stranger"],
      [move("e2e4", 3), "token-white"],
      ["{}", "token-white"],
    ] as const) {
      const r = await send([game()], body, { token });
      expect(r.serviceKeyReads(), JSON.stringify(body)).toBe(0);
    }
  });
});

describe("friend-move: request checks", () => {
  it("rejects malformed bodies", async () => {
    const bad: unknown[] = [
      "not json",
      "",
      "[]",
      "null",
      "42",
      { gameId: GAME, uci: "e2e4" },
      { gameId: GAME, expectedVersion: 1 },
      { gameId: "not-a-uuid", expectedVersion: 1, uci: "e2e4" },
      { gameId: GAME, expectedVersion: -1, uci: "e2e4" },
      { gameId: GAME, expectedVersion: 1.5, uci: "e2e4" },
      { gameId: GAME, expectedVersion: "1", uci: "e2e4" },
      { gameId: GAME, expectedVersion: 2147483648, uci: "e2e4" },
      { gameId: GAME, expectedVersion: 1, uci: "e2e9" },
      { gameId: GAME, expectedVersion: 1, uci: "E2E4" },
      { gameId: GAME, expectedVersion: 1, uci: "e2e4k" },
      { gameId: GAME, expectedVersion: 1, uci: "e2-e4" },
      { gameId: GAME, expectedVersion: 1, uci: ["e2e4"] },
    ];
    for (const body of bad) {
      const r = await send([game()], body);
      expect([r.res.status, r.data?.result], JSON.stringify(body)).toEqual([400, "bad_request"]);
      expect(r.calls).toHaveLength(0);
    }
  });

  it("rejects a body over 1 KB", async () => {
    const r = await send([game()], JSON.stringify(move("e2e4")).replace("{", `{${" ".repeat(1100)}`));
    expect(r.res.status).toBe(400);
  });

  it("accepts a well-formed body and normalises the game id", () => {
    expect(parseMoveRequest(JSON.stringify({ gameId: GAME.toUpperCase(), expectedVersion: 0, uci: "a7a8n" }))).toEqual({
      gameId: GAME,
      expectedVersion: 0,
      uci: "a7a8n",
    });
  });

  it("allows only the listed origins, and only POST", async () => {
    const foreign = await send([game()], move("e2e4"), { origin: "https://evil.example" });
    expect(foreign.res.status).toBe(403);
    expect(foreign.res.headers.get("access-control-allow-origin")).toBeNull();
    const none = await send([game()], move("e2e4"), { origin: null });
    expect(none.res.status).toBe(403);
    const get = await send([game()], null, { method: "GET" });
    expect(get.res.status).toBe(405);
    for (const r of [foreign, none, get]) expect(r.calls).toHaveLength(0);
  });

  it("answers a CORS preflight from an allowed origin", async () => {
    const fake = fakeSupabase([game()]);
    const res = await handleFriendMove(request(null, { method: "OPTIONS" }), fake.deps);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(fake.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// Rules (design §J): the same answers as the app's GameController

function controllerOutcome(c: GameController): Outcome {
  const s = c.status;
  if (s.kind === "checkmate") return { endReason: "checkmate", winner: s.winner };
  if (s.kind === "draw") return { endReason: s.reason, winner: null };
  return { endReason: null, winner: null };
}

describe("friend rules", () => {
  const games: Record<string, string[]> = {
    "Fool's mate": ["f2f3", "e7e5", "g2g4", "d8h4"],
    "Scholar's mate": ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"],
    "knight shuffle repetition": ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"],
    "castling both sides": ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "d7d6", "e1g1", "c8e6", "d2d3", "d8d7", "b1c3", "e8c8"],
    "en passant": ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"],
    "losing castling rights": ["e2e4", "e7e5", "e1e2", "e8e7", "e2e1", "e7e8"],
  };

  it("replays to the same position as playing move by move (FEN round trip)", () => {
    for (const [name, moves] of Object.entries(games)) {
      const c = new GameController();
      for (const uci of moves) expect(c.playUci(uci), `${name} ${uci}`).toBe(true);
      expect(replay(moves)?.fen(), name).toBe(c.fen);
      expect(outcome(replay(moves)!), name).toEqual(controllerOutcome(c));
    }
  });

  it("agrees with GameController.status() on end positions", () => {
    const cases: [string, Outcome["endReason"]][] = [
      ["7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", "stalemate"],
      ["8/8/8/4k3/8/8/8/4K3 w - - 0 1", "insufficient"], // K v K
      ["8/8/8/4k3/8/8/8/3BK3 w - - 0 1", "insufficient"], // K+B v K
      ["8/8/8/4k3/8/8/8/3NK3 w - - 0 1", "insufficient"], // K+N v K
      ["8/8/8/4kb2/8/8/8/3BK3 w - - 0 1", "insufficient"], // K+B v K+B, same colour
      ["4k3/8/8/8/8/8/8/R3K3 w Q - 99 80", "fifty-move"], // after one quiet move
      ["rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3", "checkmate"],
    ];
    const fens = cases.map(([fen]) => fen);
    for (const [fen, reason] of cases) {
      const c = new GameController(fen);
      const chess = new Chess(fen);
      if (fen.includes(" 99 ")) {
        expect(c.playUci("a1a2")).toBe(true);
        expect(applyUci(chess, "a1a2")).toBe(true);
      }
      expect(outcome(chess).endReason, fen).toBe(reason);
      expect(outcome(chess), fen).toEqual(controllerOutcome(c));
    }
    expect(outcome(new Chess(fens[5])).endReason).toBeNull();
  });

  it("detects a mate delivered by a promotion", () => {
    const chess = new Chess("7k/P7/6K1/8/8/8/8/8 w - - 0 1");
    expect(applyUci(chess, "a7a8q")).toBe(true);
    expect(outcome(chess)).toEqual({ endReason: "checkmate", winner: "w" });
  });

  it("requires the promotion piece exactly on promotions, for each piece", () => {
    for (const p of ["q", "r", "b", "n"]) {
      const chess = new Chess("8/P6k/8/8/8/8/8/K7 w - - 0 1");
      expect(applyUci(chess, `a7a8${p}`), p).toBe(true);
      expect(chess.get("a8")?.type).toBe(p);
    }
    expect(applyUci(new Chess("8/P6k/8/8/8/8/8/K7 w - - 0 1"), "a7a8")).toBe(false);
    expect(applyUci(new Chess(), "e2e4q")).toBe(false);
  });
});

describe("friend-move versions (design §J)", () => {
  it("pins chess.js 1.4.0 in the Edge Function, the version the tests run with", () => {
    const denoJson = readFileSync(
      fileURLToPath(new URL("../../supabase/functions/friend-move/deno.json", import.meta.url)),
      "utf8",
    );
    expect(JSON.parse(denoJson).imports["chess.js"]).toBe("npm:chess.js@1.4.0");
    const installed = readFileSync(
      fileURLToPath(new URL("../../node_modules/chess.js/package.json", import.meta.url)),
      "utf8",
    );
    expect(JSON.parse(installed).version).toBe("1.4.0");
  });
});

// ---------------------------------------------------------------------
// Credentials from the Edge Function environment: the publishable key for
// the player's calls; for the write, a service_role JWT (required) plus an
// API key (modern sb_secret_ when present, else the same JWT)

function fakeEnv(vars: Record<string, string>) {
  const reads: string[] = [];
  return {
    reads,
    get: (name: string) => {
      reads.push(name);
      return vars[name];
    },
  };
}

const SERVER_VARS = ["SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"];

describe("friend-move credentials", () => {
  it("takes the publishable key from the \"default\" entry, else the legacy anon key", () => {
    const modern = apiKeysFrom(
      fakeEnv({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_P" }), SUPABASE_ANON_KEY: "legacy-anon" }).get,
    );
    expect(modern.publishable()).toEqual({ key: "sb_publishable_P" });
    for (const value of [undefined, "", "   ", "{}"]) {
      const vars: Record<string, string> = { SUPABASE_ANON_KEY: "legacy-anon" };
      if (value !== undefined) vars.SUPABASE_PUBLISHABLE_KEYS = value;
      expect(apiKeysFrom(fakeEnv(vars).get).publishable(), JSON.stringify(value)).toEqual({ key: "legacy-anon" });
    }
    expect(apiKeysFrom(fakeEnv({}).get).publishable()).toEqual({
      error: "SUPABASE_PUBLISHABLE_KEYS and SUPABASE_ANON_KEY are both missing",
    });
  });

  it("uses the modern secret as API key and the service_role JWT in Authorization", () => {
    const keys = apiKeysFrom(
      fakeEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SB_SECRET }), SUPABASE_SERVICE_ROLE_KEY: SERVICE }).get,
    );
    expect(keys.server()).toEqual({ apikey: SB_SECRET, jwt: SERVICE });
  });

  it("uses the legacy JWT for both when there is no modern secret", () => {
    for (const value of [undefined, "", "{}"]) {
      const vars: Record<string, string> = { SUPABASE_SERVICE_ROLE_KEY: SERVICE };
      if (value !== undefined) vars.SUPABASE_SECRET_KEYS = value;
      expect(apiKeysFrom(fakeEnv(vars).get).server(), JSON.stringify(value)).toEqual({ apikey: SERVICE, jwt: SERVICE });
    }
  });

  it("fails closed without a service_role JWT, even with a valid modern secret", () => {
    const keys = apiKeysFrom(fakeEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SB_SECRET }) }).get);
    expect(keys.server()).toEqual({ error: "SUPABASE_SERVICE_ROLE_KEY is missing: apply_friend_move needs a service_role JWT" });
  });

  it("never accepts something other than an unexpired service_role JWT as the JWT", () => {
    const cases: [string, string][] = [
      ["sb_secret_TESTONLY-VALUE-x", "is not a JWT"], // a modern key in the legacy variable
      ["not-a-jwt-VALUE", "is not a JWT"],
      ["aaa.VALUE.bbb", "is not a JWT"], // payload is not JSON
      [fakeJwt({ role: "anon", exp: FAR_FUTURE, v: "VALUE" }), "is not a service_role JWT"],
      [fakeJwt({ exp: FAR_FUTURE, v: "VALUE" }), "is not a service_role JWT"],
      [fakeJwt({ role: "service_role", exp: 1_000_000, v: "VALUE" }), "has expired"],
    ];
    for (const [value, reason] of cases) {
      const result = apiKeysFrom(fakeEnv({ SUPABASE_SERVICE_ROLE_KEY: value }).get).server();
      expect(result, value).toEqual({ error: `SUPABASE_SERVICE_ROLE_KEY ${reason}` });
      expect(JSON.stringify(result)).not.toMatch(/VALUE|TESTONLY/);
    }
  });

  it("treats a present but unusable SUPABASE_SECRET_KEYS as a configuration error, never guessing an entry", () => {
    const bad = [
      "not json",
      "[]",
      '"sb_secret_VALUE-a"',
      JSON.stringify({ backend: "sb_secret_VALUE-a", other: "sb_secret_VALUE-b" }),
      JSON.stringify({ default: 42 }),
      JSON.stringify({ default: "" }),
    ];
    for (const value of bad) {
      const result = apiKeysFrom(fakeEnv({ SUPABASE_SECRET_KEYS: value, SUPABASE_SERVICE_ROLE_KEY: SERVICE }).get).server();
      expect("error" in result, value).toBe(true);
      expect(JSON.stringify(result), value).toContain("SUPABASE_SECRET_KEYS");
      expect(JSON.stringify(result), value).not.toMatch(/VALUE|TESTONLY/);
    }
  });

  /** The wiring of index.ts, with a recorded environment and the fake Supabase. */
  function wired(rows: Row[], vars: Record<string, string>) {
    const env = fakeEnv(vars);
    const fake = fakeSupabase(rows);
    const keys = apiKeysFrom(env.get);
    const publishable = keys.publishable();
    if ("error" in publishable) throw new Error(publishable.error);
    const deps: FriendMoveDeps = { ...fake.deps, anonKey: publishable.key, serverCredentials: keys.server };
    return { env, fake, deps };
  }
  const modernAndJwt = {
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: ANON }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: SB_SECRET }),
    SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  };

  async function captureErrors<T>(fn: () => Promise<T>): Promise<[T, unknown[][]]> {
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      return [await fn(), errors];
    } finally {
      console.error = original;
    }
  }

  it("writes with apikey = modern secret and Authorization = the service_role JWT", async () => {
    const { fake, deps } = wired([game()], modernAndJwt);
    const res = await handleFriendMove(request(move("e2e4")), deps);
    expect([res.status, (await res.json()).result]).toEqual([200, "ok"]);
    const [rpc] = fake.rpcCalls();
    expect(rpc.headers).toMatchObject({ apikey: SB_SECRET, authorization: `Bearer ${SERVICE}` });
    const [auth, read] = fake.calls;
    expect(auth.headers).toMatchObject({ apikey: ANON, authorization: "Bearer token-white" });
    expect(read.headers).toMatchObject({ apikey: ANON, authorization: "Bearer token-white" });
  });

  it("never sends an sb_ key as a Bearer token", async () => {
    for (const vars of [modernAndJwt, { SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE }]) {
      const { fake, deps } = wired([game()], vars);
      await handleFriendMove(request(move("e2e4")), deps);
      expect(fake.rpcCalls()).toHaveLength(1);
      for (const c of fake.calls) expect(c.headers.authorization ?? "").not.toMatch(/^Bearer sb_/);
    }
  });

  it("fails closed, without calling the RPC, when only a modern secret is configured", async () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _omit, ...modernOnly } = modernAndJwt;
    void _omit;
    const { fake, deps } = wired([game()], modernOnly);
    const [res, errors] = await captureErrors(() => handleFriendMove(request(move("e2e4")), deps));
    expect([res.status, (await res.json()).result]).toEqual([500, "server_error"]);
    expect(fake.rpcCalls()).toHaveLength(0);
    expect(errors).toEqual([["friend-move: SUPABASE_SERVICE_ROLE_KEY is missing: apply_friend_move needs a service_role JWT"]]);
  });

  it("never reads a server credential before a valid move is ready to be written", async () => {
    for (const [body, token] of [
      [move("e2e5"), "token-white"],
      [move("e7e5"), "token-black"],
      [move("e2e4"), "token-stranger"],
      [move("e2e4", 3), "token-white"],
      ["{}", "token-white"],
    ] as const) {
      const { env, deps } = wired([game()], modernAndJwt);
      await handleFriendMove(request(body, { token }), deps);
      expect(env.reads.filter((n) => SERVER_VARS.includes(n)), JSON.stringify(body)).toEqual([]);
    }
    const { env, deps } = wired([game()], modernAndJwt);
    await handleFriendMove(request(move("e2e4")), deps);
    expect(env.reads.filter((n) => SERVER_VARS.includes(n))).toEqual(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"]);
  });

  it("answers 500 and writes nothing when SUPABASE_SECRET_KEYS is misconfigured", async () => {
    const { fake, deps } = wired([game()], {
      ...modernAndJwt,
      SUPABASE_SECRET_KEYS: JSON.stringify({ backend: "sb_secret_VALUE-a" }),
    });
    const [res, errors] = await captureErrors(() => handleFriendMove(request(move("e2e4")), deps));
    expect([res.status, (await res.json()).result]).toEqual([500, "server_error"]);
    expect(fake.rpcCalls()).toHaveLength(0);
    expect(errors).toEqual([['friend-move: SUPABASE_SECRET_KEYS has no "default" key']]);
    expect(JSON.stringify(errors)).not.toMatch(/VALUE|sb_secret|TESTONLY/);
  });

  it("is refused by the fake check A when the JWT is not sent (as apply_friend_move would)", async () => {
    const fake = fakeSupabase([game()]);
    const deps: FriendMoveDeps = { ...fake.deps, serverCredentials: () => ({ apikey: SB_SECRET, jwt: "" }) };
    const [res] = await captureErrors(() => handleFriendMove(request(move("e2e4")), deps));
    expect(res.status).toBe(500);
    expect(fake.rows[0].version).toBe(1);
  });
});

describe("friend-move configuration errors (CORS)", () => {
  it("lets a listed origin read the 500", async () => {
    const res = configErrorResponse(request(move("e2e4")), [ORIGIN]);
    expect([res.status, await res.json()]).toEqual([500, { result: "server_error" }]);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("still answers a preflight from a listed origin", () => {
    const res = configErrorResponse(request(null, { method: "OPTIONS" }), [ORIGIN]);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("gives an unlisted or missing origin no CORS headers", () => {
    for (const origin of ["https://evil.example", null]) {
      for (const method of ["POST", "OPTIONS"]) {
        const res = configErrorResponse(request(move("e2e4"), { origin, method }), [ORIGIN]);
        expect(res.status, `${origin} ${method}`).toBe(403);
        expect(res.headers.get("access-control-allow-origin"), `${origin} ${method}`).toBeNull();
      }
    }
  });
});
