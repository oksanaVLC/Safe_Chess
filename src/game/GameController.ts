import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

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

/** Pieces a pawn can become. */
export type PromotionPiece = "q" | "r" | "b" | "n";
export const PROMOTION_PIECES: PromotionPiece[] = ["q", "r", "b", "n"];

export interface PendingPromotion {
  from: Square;
  to: Square;
  color: Color;
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

/** Squares of a position for display only (no selection or move markers). */
export function positionSquares(fen: string, last: LastMove | null): SquareView[] {
  const chess = new Chess(fen);
  return SQUARES.map((square) => ({
    square,
    piece: chess.get(square) ?? null,
    dark: isDarkSquare(square),
    selected: false,
    lastMove: !!last && (square === last.from || square === last.to),
    target: null,
  }));
}

/**
 * Owns the game state (through chess.js) and the tap-to-move interaction.
 * The UI only renders what this class reports and forwards taps to it.
 */
export class GameController {
  private chess: Chess;
  private selected: Square | null = null;
  private last: LastMove | null = null;
  private pending: PendingPromotion | null = null;

  /**
   * @param humanColor The side the person plays; taps on the other side's
   *   turn are ignored. `null` lets one person play both sides.
   */
  constructor(
    fen?: string,
    readonly humanColor: Color | null = null,
  ) {
    this.chess = fen ? new Chess(fen) : new Chess();
  }

  get fen(): string {
    return this.chess.fen();
  }

  get turn(): Color {
    return this.chess.turn();
  }

  /** All moves played so far, oldest first. */
  history(): Move[] {
    return this.chess.history({ verbose: true });
  }

  /** Number of half-moves played. */
  get plyCount(): number {
    return this.chess.history().length;
  }

  get selectedSquare(): Square | null {
    return this.selected;
  }

  get lastMove(): LastMove | null {
    return this.last;
  }

  /** Set while a pawn move waits for the player to choose a piece. */
  get pendingPromotion(): PendingPromotion | null {
    return this.pending;
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

  /** Legal destinations of the selected piece (a promotion square appears once). */
  targets(): Target[] {
    if (!this.selected) return [];
    const byTarget = new Map<Square, Target>();
    for (const m of this.chess.moves({ square: this.selected, verbose: true })) {
      byTarget.set(m.to, { to: m.to, capture: m.isCapture() || m.isEnPassant() });
    }
    return [...byTarget.values()];
  }

  private isPromotion(from: Square, to: Square): boolean {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to && m.isPromotion());
  }

  /**
   * Handles a tap on a square. Returns true if anything changed.
   * - Tap own piece: select it (tap again to deselect).
   * - Tap a legal target of the selected piece: play the move, or, for a
   *   pawn reaching the last rank, wait for the promotion choice.
   * - Tap anything else: clear the selection.
   * Taps are ignored while a promotion choice is pending.
   */
  tap(square: Square): boolean {
    if (this.isOver || this.pending) return false;
    if (this.humanColor && this.chess.turn() !== this.humanColor) return false;

    if (this.selected && this.targets().some((t) => t.to === square)) {
      if (this.isPromotion(this.selected, square)) {
        this.pending = { from: this.selected, to: square, color: this.chess.turn() };
        return true;
      }
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

  /** Completes the pending pawn move with the chosen piece. */
  promote(piece: PromotionPiece): boolean {
    if (!this.pending) return false;
    const { from, to } = this.pending;
    return this.move(from, to, piece);
  }

  /** Cancels the pending pawn move; the pawn stays selected. */
  cancelPromotion(): boolean {
    if (!this.pending) return false;
    this.pending = null;
    return true;
  }

  /** Plays a move given in UCI, e.g. "e2e4" or "e7e8q" (used for the robot). */
  playUci(uci: string): boolean {
    const promotion = uci[4] as PromotionPiece | undefined;
    return this.move(uci.slice(0, 2) as Square, uci.slice(2, 4) as Square, promotion);
  }

  /**
   * Undo for robot games: takes back the person's last move and the robot's
   * reply to it (or only the person's move if the robot has not replied).
   */
  undo(): boolean {
    if (!this.canUndo) return false;
    const human = this.humanColor;
    this.chess.undo();
    while (human && this.chess.turn() !== human && this.chess.history().length > 0) {
      this.chess.undo();
    }
    this.selected = null;
    this.pending = null;
    const prev = this.chess.history({ verbose: true }).at(-1);
    this.last = prev ? { from: prev.from, to: prev.to } : null;
    return true;
  }

  /** True when the person has a move that Undo can take back. */
  get canUndo(): boolean {
    const history = this.chess.history({ verbose: true });
    return history.some((m) => !this.humanColor || m.color === this.humanColor);
  }

  /** Starts a new game from the initial position. */
  reset(): void {
    this.chess.reset();
    this.selected = null;
    this.pending = null;
    this.last = null;
  }

  /** Plays a move if legal. A promotion needs the piece to be given. */
  move(from: Square, to: Square, promotion?: PromotionPiece): boolean {
    try {
      const m = this.chess.move({ from, to, promotion });
      this.last = { from: m.from, to: m.to };
      this.selected = null;
      this.pending = null;
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
