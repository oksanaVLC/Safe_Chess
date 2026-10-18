"use client";

import type { Color, SquareView } from "@/game/GameController";
import { useLanguage } from "@/i18n/language";
import styles from "./Board.module.css";
import { PieceGlyph } from "./PieceGlyph";

type BoardProps =
  | {
      squares: SquareView[];
      onTap: (square: SquareView["square"]) => void;
      size?: "game";
      /** The side at the bottom ("b": squares come in h1 … a8 order). Default White. */
      orientation?: Color;
    }
  /** Display-only board (Game moves screen), 37 px squares. */
  | { squares: SquareView[]; onTap?: undefined; size: "mini"; label: string; orientation?: Color };

export function Board(props: BoardProps) {
  const { t } = useLanguage();
  const { squares, onTap } = props;
  const mini = props.size === "mini";
  // Coordinates sit on the left column and the bottom row, whichever side is down.
  const leftFile = props.orientation === "b" ? "h" : "a";
  const bottomRank = props.orientation === "b" ? "8" : "1";
  return (
    <div className={`${styles.frame} ${mini ? styles.mini : ""}`}>
      <div
        className={styles.grid}
        role={mini ? "img" : undefined}
        aria-label={mini ? props.label : undefined}
      >
        {squares.map((sq) => {
          const tint = sq.lastMove ? (sq.dark ? styles.lastDark : styles.lastLight) : "";
          const className = `${styles.square} ${sq.dark ? styles.dark : styles.light} ${tint} ${
            sq.selected ? styles.selected : ""
          }`;
          const content = (
            <>
              {sq.piece && (
                <span className={styles.glyph}>
                  <PieceGlyph piece={sq.piece} />
                </span>
              )}
              {sq.target === "move" && <span className={styles.dot} aria-hidden="true" />}
              {sq.target === "capture" && <span className={styles.ring} aria-hidden="true" />}
              {sq.square[0] === leftFile && (
                <span className={`${styles.coord} ${styles.rank}`} aria-hidden="true">
                  {sq.square[1]}
                </span>
              )}
              {sq.square[1] === bottomRank && (
                <span className={`${styles.coord} ${styles.file}`} aria-hidden="true">
                  {sq.square[0]}
                </span>
              )}
            </>
          );
          if (!onTap) {
            return (
              <div key={sq.square} className={className} aria-hidden="true">
                {content}
              </div>
            );
          }
          const label = sq.piece
            ? `${sq.square}, ${t.pieceOnSquare[sq.piece.color][sq.piece.type]}`
            : sq.square;
          return (
            <button
              key={sq.square}
              type="button"
              className={className}
              aria-label={label}
              aria-pressed={sq.selected}
              onClick={() => onTap(sq.square)}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
