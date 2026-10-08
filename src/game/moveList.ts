import { DEFAULT_POSITION, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import type { LastMove } from "./GameController";

/** One half-move of a finished or ongoing game, as shown on the Game moves screen. */
export interface MoveEntry {
  /** 1 = White's first move, 2 = Black's first move, … */
  ply: number;
  color: Color;
  piece: PieceSymbol;
  from: Square;
  to: Square;
  castles: boolean;
  promotion?: PieceSymbol;
  /** Position after this move. */
  fen: string;
}

/** A row of the moves table: move number with White's and Black's move. */
export interface MoveRow {
  number: number;
  white?: MoveEntry;
  black?: MoveEntry;
}

export function toEntries(history: Move[]): MoveEntry[] {
  return history.map((m, i) => ({
    ply: i + 1,
    color: m.color,
    piece: m.piece,
    from: m.from,
    to: m.to,
    castles: m.isKingsideCastle() || m.isQueensideCastle(),
    promotion: m.promotion,
    fen: m.after,
  }));
}

export function toRows(entries: MoveEntry[]): MoveRow[] {
  const rows: MoveRow[] = [];
  for (const e of entries) {
    const number = Math.ceil(e.ply / 2);
    if (e.color === "w" || rows.length === 0) rows.push({ number });
    rows[rows.length - 1][e.color === "w" ? "white" : "black"] = e;
  }
  return rows;
}

/**
 * Position after `ply` half-moves (0 = the starting position), with the
 * move that led to it for the last-move tint.
 */
export function positionAt(
  entries: MoveEntry[],
  ply: number,
  startFen: string = DEFAULT_POSITION,
): { fen: string; lastMove: LastMove | null } {
  if (ply <= 0) return { fen: startFen, lastMove: null };
  const e = entries[Math.min(ply, entries.length) - 1];
  return { fen: e.fen, lastMove: { from: e.from, to: e.to } };
}

/** Full-move number shown for a ply ("Move 3"); 0 for the start. */
export function moveNumberOf(ply: number): number {
  return Math.ceil(ply / 2);
}
