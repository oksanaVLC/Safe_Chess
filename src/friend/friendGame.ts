// A friend game as the browser sees it: the row read under RLS (only the
// two players can read it) or returned by friend-move. Everything shown
// comes from that row: the position is rebuilt from its moves, and the
// result from its status, end_reason and winner. Nothing here talks to the
// network.

import type { Color, Move } from "chess.js";
import { GameController, type SquareView } from "@/game/GameController";

export interface FriendGame {
  id: string;
  code: string;
  status: "waiting" | "active" | "finished" | "expired";
  whiteId: string;
  blackId: string | null;
  moves: string[];
  fen: string;
  version: number;
  endReason: "checkmate" | "stalemate" | "insufficient" | "repetition" | "fifty-move" | "expired" | null;
  winner: Color | null;
}

const STATUSES = ["waiting", "active", "finished", "expired"];
const END_REASONS = ["checkmate", "stalemate", "insufficient", "repetition", "fifty-move", "expired"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** A game id as the address carries it (?g=). */
export function isGameId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** The row as stored (snake_case), or null if anything is missing or malformed. */
export function parseGameRow(value: unknown): FriendGame | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  const ok =
    isGameId(r.id as string) &&
    typeof r.join_code === "string" &&
    STATUSES.includes(r.status as string) &&
    isGameId(r.white_id as string) &&
    (r.black_id === null || isGameId(r.black_id as string)) &&
    Array.isArray(r.moves) &&
    r.moves.every((m) => typeof m === "string" && UCI_RE.test(m)) &&
    typeof r.fen === "string" &&
    Number.isInteger(r.version) &&
    (r.end_reason === null || END_REASONS.includes(r.end_reason as string)) &&
    (r.winner === null || r.winner === "w" || r.winner === "b");
  if (!ok) return null;
  return {
    id: (r.id as string).toLowerCase(),
    code: r.join_code as string,
    status: r.status as FriendGame["status"],
    whiteId: (r.white_id as string).toLowerCase(),
    blackId: r.black_id === null ? null : (r.black_id as string).toLowerCase(),
    moves: r.moves as string[],
    fen: r.fen as string,
    version: r.version as number,
    endReason: r.end_reason as FriendGame["endReason"],
    winner: r.winner as Color | null,
  };
}

/** The colour this user plays in the game, or null if not a player. */
export function seatOf(game: FriendGame, userId: string): Color | null {
  const uid = userId.toLowerCase();
  if (uid === game.whiteId) return "w";
  if (uid === game.blackId) return "b";
  return null;
}

/**
 * The position for the board, rebuilt from the stored moves (so the move
 * list, the last-move tint and the legal targets are right). The person can
 * move only their own pieces, on their turn. Null if the stored moves do
 * not lead to the stored position: then nothing is shown as playable.
 */
export function controllerFor(game: FriendGame, seat: Color): GameController | null {
  const ctl = new GameController(undefined, seat);
  for (const uci of game.moves) if (!ctl.playUci(uci)) return null;
  return ctl.fen === game.fen ? ctl : null;
}

/** UCI of a chess.js move, as friend-move expects it ("e2e4", "e7e8q"). */
export function uciOf(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

export type Outcome =
  | { kind: "waiting" } // nobody has joined yet
  | { kind: "playing"; myTurn: boolean; check: boolean }
  | { kind: "win" }
  | { kind: "loss" }
  | { kind: "draw" }
  | { kind: "expired" };

/** What the status line says, from the server's row (and the replayed position for check). */
export function outcomeFor(game: FriendGame, seat: Color, ctl: GameController | null): Outcome {
  if (game.status === "waiting") return { kind: "waiting" };
  if (game.status === "expired") return { kind: "expired" };
  if (game.status === "finished") {
    if (game.endReason === "checkmate") return game.winner === seat ? { kind: "win" } : { kind: "loss" };
    return { kind: "draw" };
  }
  const turn = game.fen.split(" ")[1] === "b" ? "b" : "w";
  return { kind: "playing", myTurn: turn === seat, check: ctl?.status.kind === "playing" && ctl.status.check };
}

/** Whether the person may touch the board now. */
export function canMove(game: FriendGame, seat: Color, ctl: GameController | null, sending: boolean): boolean {
  const o = outcomeFor(game, seat, ctl);
  return !sending && ctl !== null && o.kind === "playing" && o.myTurn;
}

/** Squares in display order with the person's own pieces at the bottom. */
export function orientSquares(squares: SquareView[], seat: Color): SquareView[] {
  return seat === "b" ? [...squares].reverse() : squares;
}

export type MoveResult =
  /** Accepted: the confirmed game after the move. */
  | { kind: "ok"; game: FriendGame }
  /** Not applied (stale version, not your turn, illegal, game over): show the server's game. */
  | { kind: "resync"; game: FriendGame | null }
  /** The session or the game cannot be used any more. */
  | { kind: "denied" }
  /** Server or network trouble: nothing is known, read the game again. */
  | { kind: "error" };

/** friend-move's answer ({result, game?} with the HTTP status) as one of the cases above. */
export function classifyMoveResponse(status: number, body: unknown): MoveResult {
  const b = (typeof body === "object" && body !== null ? body : {}) as { result?: unknown; game?: unknown };
  const game = parseGameRow(b.game);
  if (status === 200 && b.result === "ok") return game ? { kind: "ok", game } : { kind: "error" };
  if (status === 409 && (b.result === "stale" || b.result === "not_active")) return { kind: "resync", game };
  if (status === 403 && b.result === "not_your_turn") return { kind: "resync", game };
  if (status === 422 && b.result === "illegal") return { kind: "resync", game: null };
  if (status === 401 || status === 404 || (status === 403 && (b.result === "not_anonymous" || b.result === "forbidden_origin"))) {
    return { kind: "denied" };
  }
  return { kind: "error" };
}
