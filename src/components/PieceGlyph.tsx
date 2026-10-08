import type { Piece } from "@/game/GameController";
import styles from "./PieceGlyph.module.css";

// Text presentation selector keeps ♟ from turning into an emoji in fallback fonts.
const VS15 = "︎";
const SOLID = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" } as const;
const OUTLINE = { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" } as const;

/**
 * Draws a piece (brief §5.3). Black: solid glyph in navy. White: solid glyph
 * in white with the outline glyph in navy on top. Size follows font-size.
 */
export function PieceGlyph({ piece }: { piece: Piece }) {
  return (
    <span className={styles.piece} aria-hidden="true">
      {piece.color === "w" ? (
        <>
          <span className={styles.whiteFill}>{SOLID[piece.type] + VS15}</span>
          <span className={styles.navy}>{OUTLINE[piece.type] + VS15}</span>
        </>
      ) : (
        <span className={styles.navy}>{SOLID[piece.type] + VS15}</span>
      )}
    </span>
  );
}
