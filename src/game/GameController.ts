import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

export type { Color, PieceSymbol, Square };

export interface Piece {
  type: PieceSymbol;
  color: Color;
}

export interface Target {
  to: Square;
  capture: boolean;
}

export interface LastMove {
  from: Square;
  to: Square;
}

export type GameStatus =
  | { kind: "playing"; turn: Color; check: boolean }
  | { kind: "checkmate"; winner: Color }
  | { kind: "draw"; reason: "stalemate" | "insufficient" | "repetition" | "fifty-move" };

export interface SquareView {
  square: Square;
  piece: Piece | null;
  dark: boolean;
  selected: boolean;
  lastMove: boolean;
  target: "move" | "capture" | null;
}

const FILES = "abcdefgh";

/** Squares in display order: a8 … h8, a7 … h1 (White at the bottom). */
export const SQUARES: Square[] = Array.from({ length: 64 }, (_, i) => {
  const file = FILES[i % 8];
  const rank = 8 - Math.floor(i / 8);
  return `${file}${rank}` as Square;
});

export function isDarkSquare(square: Square): boolean {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return (file + rank) % 2 === 0; // a1 is dark
}

/**
 * Owns the game state (through chess.js) and the tap-to-move interaction.
 * The UI only renders what this class reports and forwards taps to it.
 */
export class GameController {
  private chess: Chess;
  private selected: Square | null = null;
  private last: LastMove | null = null;

  constructor(fen?: string) {
    this.chess = fen ? new Chess(fen) : new Chess();
  }

  get fen(): string {
    return this.chess.fen();
  }

  get selectedSquare(): Square | null {
    return this.selected;
  }

  get lastMove(): LastMove | null {
    return this.last;
  }

  get status(): GameStatus {
    const c = this.chess;
    if (c.isCheckmate()) return { kind: "checkmate", winner: c.turn() === "w" ? "b" : "w" };
    if (c.isStalemate()) return { kind: "draw", reason: "stalemate" };
    if (c.isInsufficientMaterial()) return { kind: "draw", reason: "insufficient" };
    if (c.isThreefoldRepetition()) return { kind: "draw", reason: "repetition" };
    if (c.isDrawByFiftyMoves()) return { kind: "draw", reason: "fifty-move" };
    return { kind: "playing", turn: c.turn(), check: c.inCheck() };
  }

  get isOver(): boolean {
    return this.status.kind !== "playing";
  }

  pieceAt(square: Square): Piece | null {
    return this.chess.get(square) ?? null;
  }

  /** Legal destinations of the selected piece. */
  targets(): Target[] {
    if (!this.selected) return [];
    return this.chess.moves({ square: this.selected, verbose: true }).map((m) => ({
      to: m.to,
      capture: m.isCapture() || m.isEnPassant(),
    }));
  }

  /**
   * Handles a tap on a square. Returns true if anything changed.
   * - Tap own piece: select it (tap again to deselect).
   * - Tap a legal target of the selected piece: play the move.
   * - Tap anything else: clear the selection.
   */
  tap(square: Square): boolean {
    if (this.isOver) return false;

    if (this.selected && this.targets().some((t) => t.to === square)) {
      return this.move(this.selected, square);
    }

    const piece = this.pieceAt(square);
    if (piece && piece.color === this.chess.turn()) {
      this.selected = this.selected === square ? null : square;
      return true;
    }

    if (this.selected) {
      this.selected = null;
      return true;
    }
    return false;
  }

  /** Plays a move if legal. Pawns reaching the last rank become queens. */
  move(from: Square, to: Square): boolean {
    try {
      const m = this.chess.move({ from, to, promotion: "q" });
      this.last = { from: m.from, to: m.to };
      this.selected = null;
      return true;
    } catch {
      return false;
    }
  }

  board(): SquareView[] {
    const targets = new Map(this.targets().map((t) => [t.to, t]));
    return SQUARES.map((square) => {
      const t = targets.get(square);
      return {
        square,
        piece: this.pieceAt(square),
        dark: isDarkSquare(square),
        selected: square === this.selected,
        lastMove: !!this.last && (square === this.last.from || square === this.last.to),
        target: t ? (t.capture ? "capture" : "move") : null,
      };
    });
  }
}
