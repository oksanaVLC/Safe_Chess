// Safe Chess, friend mode: the server's chess rules (design §G, §J).
// Shared by the friend-move Edge Function (Deno, chess.js via deno.json)
// and the Vitest tests (Node, chess.js from node_modules). Both use
// chess.js 1.4.0, the version the app uses.

import { Chess, type Square } from "chess.js";

/** A move in UCI: from, to and, only for a promotion, the new piece. */
export const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export type Side = "w" | "b";

export type EndReason = "checkmate" | "stalemate" | "insufficient" | "repetition" | "fifty-move";

export interface Outcome {
  endReason: EndReason | null;
  winner: Side | null;
}

/**
 * Plays one UCI move on `chess` if it is legal. A promotion needs its
 * piece (never a silent queen) and a non-promotion must not have one.
 * Returns false and leaves `chess` unchanged otherwise.
 */
export function applyUci(chess: Chess, uci: string): boolean {
  if (!UCI_RE.test(uci)) return false;
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = uci.length === 5 ? uci[4] : undefined;
  const candidates = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (candidates.length === 0) return false;
  const promotes = candidates.some((m) => m.promotion !== undefined);
  if (promotes !== (promotion !== undefined)) return false;
  try {
    chess.move({ from, to, promotion });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rebuilds a game from the start position by replaying its stored moves,
 * so threefold repetition sees the whole history. Null if any stored
 * move is not a legal UCI move.
 */
export function replay(moves: readonly unknown[]): Chess | null {
  const chess = new Chess();
  for (const uci of moves) {
    if (typeof uci !== "string" || !applyUci(chess, uci)) return null;
  }
  return chess;
}

/**
 * Game over, in the order of GameController.status() in the app:
 * checkmate, stalemate, insufficient material, threefold repetition,
 * fifty-move rule. The winner of a mate is the side that just moved.
 */
export function outcome(chess: Chess): Outcome {
  if (chess.isCheckmate()) return { endReason: "checkmate", winner: chess.turn() === "w" ? "b" : "w" };
  if (chess.isStalemate()) return { endReason: "stalemate", winner: null };
  if (chess.isInsufficientMaterial()) return { endReason: "insufficient", winner: null };
  if (chess.isThreefoldRepetition()) return { endReason: "repetition", winner: null };
  if (chess.isDrawByFiftyMoves()) return { endReason: "fifty-move", winner: null };
  return { endReason: null, winner: null };
}
