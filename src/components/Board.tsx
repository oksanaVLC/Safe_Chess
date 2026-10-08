"use client";

import type { PieceSymbol, SquareView } from "@/game/GameController";
import styles from "./Board.module.css";
import { PieceGlyph } from "./PieceGlyph";

const NAMES: Record<PieceSymbol, string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};

interface BoardProps {
  squares: SquareView[];
  onTap: (square: SquareView["square"]) => void;
}

export function Board({ squares, onTap }: BoardProps) {
  return (
    <div className={styles.frame}>
      <div className={styles.grid}>
        {squares.map((sq) => {
          const tint = sq.lastMove ? (sq.dark ? styles.lastDark : styles.lastLight) : "";
          const label = sq.piece
            ? `${sq.square}, ${sq.piece.color === "w" ? "white" : "black"} ${NAMES[sq.piece.type]}`
            : sq.square;
          return (
            <button
              key={sq.square}
              type="button"
              className={`${styles.square} ${sq.dark ? styles.dark : styles.light} ${tint} ${
                sq.selected ? styles.selected : ""
              }`}
              aria-label={label}
              aria-pressed={sq.selected}
              onClick={() => onTap(sq.square)}
            >
              {sq.piece && (
                <span className={styles.glyph}>
                  <PieceGlyph piece={sq.piece} />
                </span>
              )}
              {sq.target === "move" && <span className={styles.dot} aria-hidden="true" />}
              {sq.target === "capture" && <span className={styles.ring} aria-hidden="true" />}
              {sq.square[0] === "a" && (
                <span className={`${styles.coord} ${styles.rank}`} aria-hidden="true">
                  {sq.square[1]}
                </span>
              )}
              {sq.square[1] === "1" && (
                <span className={`${styles.coord} ${styles.file}`} aria-hidden="true">
                  {sq.square[0]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
