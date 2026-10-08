import { Chess, type Move } from "chess.js";

/** How often Level 1 takes a free piece when it can see one. */
const TAKE_FREE_PIECE_CHANCE = 0.3;

/** A capture whose capturing piece cannot be taken back on that square. */
function isFreeCapture(fen: string, m: Move): boolean {
  if (!m.isCapture() && !m.isEnPassant()) return false;
  const after = new Chess(fen);
  after.move(m.lan);
  return !after.isAttacked(m.to, after.turn());
}

/**
 * Level 1 ("Snoozy"): not an engine. Plays a random legal move, and now and
 * then takes a piece that is left completely undefended.
 */
export function randomMove(fen: string, random: () => number = Math.random): string {
  const moves = new Chess(fen).moves({ verbose: true });
  if (moves.length === 0) throw new Error("No legal moves");

  if (random() < TAKE_FREE_PIECE_CHANCE) {
    const free = moves.filter((m) => isFreeCapture(fen, m));
    if (free.length > 0) return free[Math.floor(random() * free.length)].lan;
  }
  return moves[Math.floor(random() * moves.length)].lan;
}
