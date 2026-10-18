import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The browser side of Play with a friend against fake Supabase objects: no
// network. The module reads the public settings when imported, so they are
// set (made-up values) before each import.
const URL = "https://abcdefghijklmnopqrst.supabase.co";
const KEY = "sb_publishable_TESTONLY";
const TOKEN = "user-token-TESTONLY";
const GAME = "aaaaaaaa-0000-4000-8000-000000000001";
const ROW = {
  id: GAME, join_code: "ABCDEFGH", status: "active",
  white_id: "11111111-1111-4111-8111-111111111111", black_id: "22222222-2222-4222-8222-222222222222",
  moves: [], fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", version: 1, end_reason: null, winner: null,
};

async function load() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY);
  return import("./supabaseClient");
}

function fakeSupabase(over: Record<string, unknown> = {}) {
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  const supabase = {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: TOKEN } }, error: null })) },
    realtime: { setAuth: vi.fn(async () => undefined) },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => "ok"),
    from: vi.fn(),
    ...over,
  };
  return { supabase: supabase as unknown as SupabaseClient, raw: supabase, channel };
}

// The first import of supabase-js is slow; warm it up outside the tests' time limit.
beforeAll(async () => {
  await load();
}, 60_000);

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sending a move", () => {
  it("follows friend-move's contract exactly: POST {gameId, expectedVersion, uci} with the player's token", async () => {
    const { sendMove } = await load();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: "ok", game: { ...ROW, moves: ["e2e4"], version: 2, fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { supabase } = fakeSupabase();
    const result = await sendMove(supabase, { gameId: GAME, expectedVersion: 1, uci: "e2e4" });
    expect(result.kind).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL}/functions/v1/friend-move`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ apikey: KEY, authorization: `Bearer ${TOKEN}`, "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ gameId: GAME, expectedVersion: 1, uci: "e2e4" });
  });

  it("reports a stale version with the server's game, and a network error as an error", async () => {
    const { sendMove } = await load();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ result: "stale", game: { ...ROW, version: 3, moves: ["e2e4", "e7e5"], fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2" } }), { status: 409 })));
    const { supabase } = fakeSupabase();
    const stale = await sendMove(supabase, { gameId: GAME, expectedVersion: 1, uci: "e2e4" });
    expect(stale.kind).toBe("resync");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect(await sendMove(supabase, { gameId: GAME, expectedVersion: 1, uci: "e2e4" })).toEqual({ kind: "error" });
  });

  it("sends nothing without a session, and reports permissions denied", async () => {
    const { sendMove } = await load();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: "unauthorized" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const noSession = fakeSupabase({ auth: { getSession: vi.fn(async () => ({ data: { session: null }, error: null })) } });
    expect(await sendMove(noSession.supabase, { gameId: GAME, expectedVersion: 1, uci: "e2e4" })).toEqual({ kind: "denied" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await sendMove(fakeSupabase().supabase, { gameId: GAME, expectedVersion: 1, uci: "e2e4" })).toEqual({ kind: "denied" });
  });
});

describe("reading a game", () => {
  function fromReturning(result: { data: unknown; error: unknown }) {
    const eq = vi.fn(async () => result);
    const select = vi.fn(() => ({ eq }));
    return { from: vi.fn(() => ({ select })), select, eq };
  }

  it("reads only the requested game, through RLS", async () => {
    const { readGame } = await load();
    const q = fromReturning({ data: [ROW], error: null });
    const result = await readGame(fakeSupabase({ from: q.from }).supabase, GAME);
    expect(result.kind).toBe("ok");
    expect(q.from).toHaveBeenCalledWith("games");
    expect(q.eq).toHaveBeenCalledWith("id", GAME);
  });

  it("treats no row as 'gone' (not a player, or deleted) and failures as errors", async () => {
    const { readGame } = await load();
    expect(await readGame(fakeSupabase({ from: fromReturning({ data: [], error: null }).from }).supabase, GAME)).toEqual({ kind: "gone" });
    expect(await readGame(fakeSupabase({ from: fromReturning({ data: null, error: { code: "42501" } }).from }).supabase, GAME)).toEqual({ kind: "error" });
    expect(await readGame(fakeSupabase({ from: fromReturning({ data: [{ id: "x" }], error: null }).from }).supabase, GAME)).toEqual({ kind: "error" });
  });
});

describe("the game channel", () => {
  it("joins the private channel game:<id> with the player's token and leaves it on cleanup", async () => {
    const { subscribeToGame } = await load();
    const { supabase, raw, channel } = fakeSupabase();
    const onEvent = vi.fn();
    const leave = subscribeToGame(supabase, GAME, onEvent, vi.fn());
    await new Promise((r) => setTimeout(r, 0));
    expect(raw.channel).toHaveBeenCalledWith(`game:${GAME}`, { config: { private: true } });
    expect(raw.realtime.setAuth).toHaveBeenCalledWith(TOKEN);
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    const handler = channel.on.mock.calls[0][2] as (m: { payload: unknown }) => void;
    handler({ payload: { game_id: GAME, version: 2, op: "UPDATE" } });
    expect(onEvent).toHaveBeenCalledWith({ game_id: GAME, version: 2, op: "UPDATE" });
    leave();
    expect(raw.removeChannel).toHaveBeenCalledWith(channel);
  });

  it("with presence: keys it by player, announces only the seat once joined, and reports the state", async () => {
    const { subscribeToGame } = await load();
    const { supabase, raw, channel } = fakeSupabase();
    const state = { me: [{ seat: "w" }], friend: [{ seat: "b" }] };
    Object.assign(channel, { track: vi.fn(async () => "ok"), presenceState: vi.fn(() => state) });
    const onChange = vi.fn();
    const onStatus = vi.fn();
    subscribeToGame(supabase, GAME, vi.fn(), onStatus, { key: "user-1", seat: "w", onChange });
    await new Promise((r) => setTimeout(r, 0));
    expect(raw.channel).toHaveBeenCalledWith(`game:${GAME}`, { config: { private: true, presence: { key: "user-1" } } });
    const track = (channel as unknown as { track: ReturnType<typeof vi.fn> }).track;
    expect(track).not.toHaveBeenCalled(); // not before the channel is joined
    const statusCb = channel.subscribe.mock.calls[0][0] as (s: string) => void;
    statusCb("SUBSCRIBED");
    expect(track).toHaveBeenCalledWith({ seat: "w" });
    expect(onStatus).toHaveBeenCalledWith("SUBSCRIBED");
    const presenceCall = channel.on.mock.calls.find((c) => c[0] === "presence");
    expect(presenceCall?.[1]).toEqual({ event: "sync" });
    (presenceCall?.[2] as () => void)();
    expect(onChange).toHaveBeenCalledWith(state);
  });

  it("without presence, sends nothing on the channel", async () => {
    const { subscribeToGame } = await load();
    const { supabase, channel } = fakeSupabase();
    const track = vi.fn();
    Object.assign(channel, { track });
    subscribeToGame(supabase, GAME, vi.fn(), vi.fn());
    await new Promise((r) => setTimeout(r, 0));
    (channel.subscribe.mock.calls[0][0] as (s: string) => void)("SUBSCRIBED");
    expect(track).not.toHaveBeenCalled();
    expect(channel.on.mock.calls.map((c) => c[0])).toEqual(["broadcast"]);
  });

  it("does not join if the screen is left before the token is ready", async () => {
    const { subscribeToGame } = await load();
    const { supabase, raw, channel } = fakeSupabase();
    const leave = subscribeToGame(supabase, GAME, vi.fn(), vi.fn());
    leave();
    await new Promise((r) => setTimeout(r, 0));
    expect(channel.subscribe).not.toHaveBeenCalled();
    expect(raw.removeChannel).toHaveBeenCalledTimes(1);
  });
});
