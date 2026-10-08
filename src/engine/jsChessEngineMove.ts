import { Chess } from "chess.js";
import { ai, type AILevel } from "js-chess-engine";
import type { Level } from "./ChessEngine";

/**
 * Levels 2–5 mapped to js-chess-engine's own settings (README, "Computer AI").
 * `randomness`: the engine picks among moves within this many centipawns of
 * its best move, so weaker levels vary and make human-like slips.
 */
export const ENGINE_SETTINGS: Record<Exclude<Level, 1>, { level: AILevel; randomness: number }> = {
  2: { level: 1, randomness: 40 }, // 1 ply: grabs material, no plans
  3: { level: 2, randomness: 15 }, // up to 3 ply
  4: { level: 3, randomness: 0 }, // up to 5 ply
  5: { level: 5, randomness: 0 }, // strongest setting, up to 12 ply
};

/** Scores above this are forced mates (the engine uses ±999999 minus plies). */
const MATE_SCORE = 999_000;

/** Asks js-chess-engine for a move and returns it as UCI. */
export function jsChessEngineMove(fen: string, level: Exclude<Level, 1>): string {
  const settings = ENGINE_SETTINGS[level];
  const result = ai(fen, { ...settings, play: false, analysis: true });

  // With randomness, "mate now" and "mate in a few moves" score alike, so the
  // robot could keep postponing a mate. Always play the fastest mate.
  const best = result.analysis?.[0];
  const entry = best && best.score > MATE_SCORE ? best.move : result.move;

  const [[from, to]] = Object.entries(entry);
  return toUci(fen, from.toLowerCase(), to.toLowerCase());
}

/** Adds the promotion piece (the engine always promotes to a queen). */
function toUci(fen: string, from: string, to: string): string {
  const legal = new Chess(fen)
    .moves({ verbose: true })
    .find((m) => m.from === from && m.to === to);
  if (!legal) throw new Error(`Engine suggested an illegal move ${from}${to}`);
  return legal.isPromotion() ? `${from}${to}q` : `${from}${to}`;
}
