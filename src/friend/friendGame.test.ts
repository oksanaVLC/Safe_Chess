import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { SQUARES, type Square } from "@/game/GameController";
import {
  canMove,
  classifyMoveResponse,
  controllerFor,
  isGameId,
  opponentPresent,
  orientSquares,
  outcomeFor,
  parseGameRow,
  seatOf,
  uciOf,
  type FriendGame,
} from "./friendGame";

const GAME = "aaaaaaaa-0000-4000-8000-000000000001";
const WHITE = "11111111-1111-4111-8111-111111111111";
const BLACK = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";

/** A stored row (snake_case) after the given moves, as RLS or friend-move returns it. */
function row(moves: string[] = [], extra: Record<string, unknown> = {}) {
  const chess = new Chess();
  for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
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
    expires_at: "2100-01-01T00:00:00Z",
    ...extra,
  };
}
const game = (moves: string[] = [], extra: Record<string, unknown> = {}) => parseGameRow(row(moves, extra)) as FriendGame;
const FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"];

describe("loading a game", () => {
  it("accepts a well-formed row", () => {
    expect(game(["e2e4"])).toMatchObject({ id: GAME, code: "ABCDEFGH", status: "active", moves: ["e2e4"], version: 2 });
  });

  it("rejects malformed rows instead of guessing", () => {
    for (const bad of [
      null,
      "x",
      { ...row(), id: "not-a-uuid" },
      { ...row(), status: "playing" },
      { ...row(), moves: ["e2e9"] },
      { ...row(), version: "2" },
      { ...row(), winner: "white" },
      { ...row(), end_reason: "resigned" },
      { ...row(), black_id: 7 },
    ]) {
      expect(parseGameRow(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("checks the ?g= parameter is a game id", () => {
    expect(isGameId(GAME)).toBe(true);
    for (const bad of [null, undefined, "", "abc", `${GAME}x`, "'; drop table games"]) expect(isGameId(bad)).toBe(false);
  });

  it("knows which side each player has, and nobody else", () => {
    const g = game();
    expect(seatOf(g, WHITE)).toBe("w");
    expect(seatOf(g, BLACK.toUpperCase())).toBe("b");
    expect(seatOf(g, STRANGER)).toBeNull();
  });

  it("rebuilds the position from the stored moves, and refuses a row whose moves and position disagree", () => {
    const ctl = controllerFor(game(["e2e4", "e7e5"]), "w");
    expect(ctl?.history().map(uciOf)).toEqual(["e2e4", "e7e5"]);
    expect(ctl?.lastMove).toEqual({ from: "e7", to: "e5" });
    expect(controllerFor(game(["e2e4"], { fen: new Chess().fen() }), "w")).toBeNull();
  });
});

describe("whose move it is", () => {
  it("White moves first; Black waits", () => {
    const g = game();
    expect(outcomeFor(g, "w", controllerFor(g, "w"))).toEqual({ kind: "playing", myTurn: true, check: false });
    expect(outcomeFor(g, "b", controllerFor(g, "b"))).toEqual({ kind: "playing", myTurn: false, check: false });
    expect(canMove(g, "w", controllerFor(g, "w"), false)).toBe(true);
    expect(canMove(g, "b", controllerFor(g, "b"), false)).toBe(false);
  });

  it("allows a legal move of one's own piece and turns it into UCI", () => {
    const ctl = controllerFor(game(), "w")!;
    expect(ctl.tap("e2")).toBe(true);
    expect(ctl.tap("e4")).toBe(true);
    expect(uciOf(ctl.history().at(-1)!)).toBe("e2e4");
  });

  it("ignores an illegal destination, the rival's pieces and taps out of turn", () => {
    const white = controllerFor(game(), "w")!;
    white.tap("e2");
    white.tap("e5"); // illegal: only clears the selection
    expect(white.plyCount).toBe(0);
    expect(white.tap("e7")).toBe(false); // a Black piece
    const black = controllerFor(game(), "b")!;
    expect(black.tap("e7")).toBe(false); // not Black's turn
    expect(black.plyCount).toBe(0);
  });

  it("asks for the promotion piece and sends it in the UCI", () => {
    const g = game(["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "c8b7", "a6b7", "g8f6"]);
    const ctl = controllerFor(g, "w")!;
    ctl.tap("b7");
    ctl.tap("a8");
    expect(ctl.pendingPromotion).toMatchObject({ from: "b7", to: "a8" });
    ctl.promote("n");
    expect(uciOf(ctl.history().at(-1)!)).toBe("b7a8n");
  });

  it("shows check only from the confirmed position", () => {
    const g = game(["e2e4", "f7f6", "d1h5"]); // check, not mate: g7g6 blocks
    expect(outcomeFor(g, "b", controllerFor(g, "b"))).toEqual({ kind: "playing", myTurn: true, check: true });
  });

  it("allows nothing while a move is being sent", () => {
    const g = game();
    expect(canMove(g, "w", controllerFor(g, "w"), true)).toBe(false);
  });
});

describe("the end of a game", () => {
  it("reports checkmate as a win for the winner and a loss for the other", () => {
    const g = game(FOOLS_MATE, { status: "finished", end_reason: "checkmate", winner: "b" });
    expect(outcomeFor(g, "b", controllerFor(g, "b"))).toEqual({ kind: "win" });
    expect(outcomeFor(g, "w", controllerFor(g, "w"))).toEqual({ kind: "loss" });
  });

  it("reports the server's draws and expiry, and blocks every move", () => {
    for (const end_reason of ["stalemate", "insufficient", "repetition", "fifty-move"]) {
      const g = game(["e2e4"], { status: "finished", end_reason });
      expect(outcomeFor(g, "b", controllerFor(g, "b"))).toEqual({ kind: "draw" });
      expect(canMove(g, "b", controllerFor(g, "b"), false)).toBe(false);
    }
    const expired = game(["e2e4"], { status: "expired", end_reason: "expired", version: 3 });
    expect(outcomeFor(expired, "b", controllerFor(expired, "b"))).toEqual({ kind: "expired" });
    expect(canMove(expired, "b", controllerFor(expired, "b"), false)).toBe(false);
  });

  it("shows an active game as expired as soon as its time is up, before the cleanup job", () => {
    const expiresAt = Date.parse("2026-10-18T09:16:35Z");
    const g = game(["e2e4"], { expires_at: "2026-10-18T09:16:35Z" });
    const ctl = controllerFor(g, "b");
    expect(outcomeFor(g, "b", ctl, expiresAt - 1)).toEqual({ kind: "playing", myTurn: true, check: false });
    expect(canMove(g, "b", ctl, false, expiresAt - 1)).toBe(true);
    expect(outcomeFor(g, "b", ctl, expiresAt)).toEqual({ kind: "expired" });
    expect(canMove(g, "b", ctl, false, expiresAt)).toBe(false);
    // a finished game stays finished, whatever the time
    const done = game(FOOLS_MATE, { status: "finished", end_reason: "checkmate", winner: "b", expires_at: "2026-10-18T09:16:35Z" });
    expect(outcomeFor(done, "b", controllerFor(done, "b"), expiresAt + 1)).toEqual({ kind: "win" });
  });

  it("reads expires_at when present, and rejects a malformed one", () => {
    expect(game().expiresAt).toBe(Date.parse("2100-01-01T00:00:00Z"));
    const { expires_at: _omit, ...withoutExpiry } = row();
    void _omit;
    expect(parseGameRow(withoutExpiry)?.expiresAt).toBeNull();
    expect(parseGameRow({ ...row(), expires_at: "soon" })).toBeNull();
  });

  it("keeps a waiting game unplayable", () => {
    const g = game([], { status: "waiting", black_id: null, version: 0 });
    expect(outcomeFor(g, "w", controllerFor(g, "w"))).toEqual({ kind: "waiting" });
    expect(canMove(g, "w", controllerFor(g, "w"), false)).toBe(false);
  });
});

describe("friend presence", () => {
  it("is true only when the other seat is in the channel's presence state", () => {
    expect(opponentPresent({}, "w")).toBe(false);
    expect(opponentPresent({ [WHITE]: [{ seat: "w" }] }, "w")).toBe(false); // only me
    expect(opponentPresent({ [WHITE]: [{ seat: "w" }], [BLACK]: [{ seat: "b" }] }, "w")).toBe(true);
    expect(opponentPresent({ [WHITE]: [{ seat: "w" }] }, "b")).toBe(true);
    expect(opponentPresent({ x: [null, "b", { seat: "x" }] } as Record<string, unknown[]>, "w")).toBe(false);
  });
});

describe("board orientation", () => {
  it("puts each player's own pieces at the bottom", () => {
    const squares = controllerFor(game(), "w")!.board();
    const white = orientSquares(squares, "w").map((s) => s.square);
    const black = orientSquares(squares, "b").map((s) => s.square);
    expect(white.slice(0, 1)).toEqual(["a8"]);
    expect(white.slice(-1)).toEqual(["h1"]);
    expect(black.slice(0, 1)).toEqual(["h1"]);
    expect(black.slice(-1)).toEqual(["a8"]);
    expect([...black].reverse()).toEqual(SQUARES as Square[]);
  });
});

describe("friend-move answers", () => {
  const moved = row(["e2e4"]);

  it("takes an accepted move's game as the new state", () => {
    expect(classifyMoveResponse(200, { result: "ok", game: moved })).toEqual({ kind: "ok", game: parseGameRow(moved) });
    expect(classifyMoveResponse(200, { result: "ok", game: { broken: true } })).toEqual({ kind: "error" });
  });

  it("re-syncs on a stale version, not your turn, an illegal move or a finished game", () => {
    expect(classifyMoveResponse(409, { result: "stale", game: moved })).toEqual({ kind: "resync", game: parseGameRow(moved) });
    expect(classifyMoveResponse(409, { result: "not_active", game: moved })).toEqual({ kind: "resync", game: parseGameRow(moved) });
    expect(classifyMoveResponse(403, { result: "not_your_turn", game: moved })).toEqual({ kind: "resync", game: parseGameRow(moved) });
    expect(classifyMoveResponse(422, { result: "illegal" })).toEqual({ kind: "resync", game: null });
  });

  it("treats refused permissions as denied", () => {
    expect(classifyMoveResponse(401, { result: "unauthorized" })).toEqual({ kind: "denied" });
    expect(classifyMoveResponse(401, { code: "UNAUTHORIZED_INVALID_JWT_FORMAT" })).toEqual({ kind: "denied" });
    expect(classifyMoveResponse(403, { result: "not_anonymous" })).toEqual({ kind: "denied" });
    expect(classifyMoveResponse(403, { result: "forbidden_origin" })).toEqual({ kind: "denied" });
    expect(classifyMoveResponse(404, { result: "not_found" })).toEqual({ kind: "denied" });
  });

  it("treats server trouble and anything unknown as an error (read the game again)", () => {
    for (const [status, body] of [
      [500, { result: "server_error" }],
      [503, { result: "unavailable" }],
      [400, { result: "bad_request" }],
      [200, null],
      [418, "teapot"],
    ] as const) {
      expect(classifyMoveResponse(status, body)).toEqual({ kind: "error" });
    }
  });
});
