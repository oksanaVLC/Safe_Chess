import { describe, expect, it, vi } from "vitest";
import { parseGameRow, type FriendGame } from "./friendGame";
import { GameSync, POLL_MS, type FetchResult, type SyncDeps } from "./gameSync";

const GAME = "aaaaaaaa-0000-4000-8000-000000000001";
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

function game(version: number, moves: string[] = [], fen = START): FriendGame {
  return parseGameRow({
    id: GAME, join_code: "ABCDEFGH", status: "active",
    white_id: "11111111-1111-4111-8111-111111111111", black_id: "22222222-2222-4222-8222-222222222222",
    moves, fen, version, end_reason: null, winner: null,
  }) as FriendGame;
}

/** A GameSync with fake Supabase, channel and timers, recording what happens. */
function setup(initial = game(1)) {
  const updates: FriendGame[] = [];
  const connection: string[] = [];
  let onEvent: (p: unknown) => void = () => {};
  let onStatus: (s: string) => void = () => {};
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let fetchResult: FetchResult = { kind: "ok", game: initial };
  const fetchGame = vi.fn(async () => fetchResult);
  const leave = vi.fn();
  const gone = vi.fn();
  const deps: SyncDeps = {
    fetchGame,
    subscribe: (e, s) => {
      onEvent = e;
      onStatus = s;
      return leave;
    },
    onUpdate: (g) => updates.push(g),
    onGone: gone,
    onConnection: (c) => connection.push(c),
    setTimer: (fn, ms) => {
      expect(ms).toBe(POLL_MS);
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => timers.delete(id as number),
  };
  const sync = new GameSync(deps, initial);
  sync.start();
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    sync, updates, connection, fetchGame, leave, gone, timers,
    event: (p: unknown) => onEvent(p),
    status: (s: string) => onStatus(s),
    serverHas: (r: FetchResult) => (fetchResult = r),
    runTimers: async () => {
      const fns = [...timers.entries()];
      for (const [id, fn] of fns) {
        timers.delete(id);
        fn();
      }
      await flush();
      await flush();
    },
    flush,
  };
}

describe("game sync", () => {
  it("re-reads the game on a newer event and shows the server's row, never the event", async () => {
    const s = setup();
    s.serverHas({ kind: "ok", game: game(2, ["e2e4"], AFTER_E4) });
    s.event({ game_id: GAME, version: 2, op: "UPDATE" });
    await s.flush();
    expect(s.fetchGame).toHaveBeenCalledTimes(1);
    expect(s.updates.map((g) => g.version)).toEqual([2]);
    expect(s.sync.game.moves).toEqual(["e2e4"]);
  });

  it("ignores repeated or old events, and events of another game", async () => {
    const s = setup(game(3));
    s.event({ game_id: GAME, version: 3, op: "UPDATE" }); // already shown
    s.event({ game_id: GAME, version: 2, op: "UPDATE" }); // older
    s.event({ game_id: "bbbbbbbb-0000-4000-8000-000000000002", version: 9, op: "UPDATE" });
    await s.flush();
    expect(s.fetchGame).not.toHaveBeenCalled();
  });

  it("reads once for a burst of events, then once more for the latest", async () => {
    const s = setup();
    s.serverHas({ kind: "ok", game: game(3) });
    for (let i = 0; i < 5; i++) s.event({ game_id: GAME, version: 2 + (i % 2), op: "UPDATE" });
    await s.flush();
    await s.flush();
    expect(s.fetchGame.mock.calls.length).toBeLessThanOrEqual(2);
    expect(s.updates.map((g) => g.version)).toEqual([3]);
  });

  it("never goes back to an older row", () => {
    const s = setup(game(5));
    expect(s.sync.adopt(game(4))).toBe(false);
    expect(s.sync.adopt(game(5))).toBe(false);
    expect(s.sync.adopt(game(6))).toBe(true);
    expect(s.updates.map((g) => g.version)).toEqual([6]);
  });

  it("catches up on every (re)join and polls while the channel is down", async () => {
    const s = setup();
    s.status("SUBSCRIBED");
    await s.flush();
    expect(s.fetchGame).toHaveBeenCalledTimes(1); // catch-up read
    expect(s.connection).toEqual(["connecting", "live"]);

    s.status("CHANNEL_ERROR");
    expect(s.connection.at(-1)).toBe("reconnecting");
    expect(s.timers.size).toBe(1);
    s.serverHas({ kind: "ok", game: game(2, ["e2e4"], AFTER_E4) });
    await s.runTimers();
    expect(s.updates.map((g) => g.version)).toEqual([2]); // the rival's move arrives by polling
    expect(s.timers.size).toBe(1); // still polling

    s.status("SUBSCRIBED");
    await s.flush();
    expect(s.timers.size).toBe(0); // polling stops once joined again
    expect(s.connection.at(-1)).toBe("live");
  });

  it("keeps the shown game when a read fails, and reports a game that is gone", async () => {
    const s = setup();
    s.serverHas({ kind: "error" });
    await s.sync.refresh();
    expect(s.updates).toEqual([]);
    expect(s.gone).not.toHaveBeenCalled();
    s.serverHas({ kind: "gone" });
    await s.sync.refresh();
    expect(s.gone).toHaveBeenCalledTimes(1);
  });

  it("checks a DELETE event by reading", async () => {
    const s = setup(game(4));
    s.serverHas({ kind: "gone" });
    s.event({ game_id: GAME, version: 4, op: "DELETE" });
    await s.flush();
    expect(s.gone).toHaveBeenCalledTimes(1);
  });

  it("leaves the channel and stops timers when disposed; later events do nothing", async () => {
    const s = setup();
    s.status("TIMED_OUT");
    expect(s.timers.size).toBe(1);
    s.sync.dispose();
    expect(s.leave).toHaveBeenCalledTimes(1);
    expect(s.timers.size).toBe(0);
    s.event({ game_id: GAME, version: 9, op: "UPDATE" });
    s.status("SUBSCRIBED");
    expect(s.sync.adopt(game(9))).toBe(false);
    await s.flush();
    expect(s.fetchGame).not.toHaveBeenCalled();
    s.sync.dispose(); // twice is harmless
    expect(s.leave).toHaveBeenCalledTimes(1);
  });
});
