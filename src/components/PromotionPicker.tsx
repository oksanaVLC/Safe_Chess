"use client";

import { useEffect, useRef } from "react";
import {
  PROMOTION_PIECES,
  type Color,
  type PromotionPiece,
} from "@/game/GameController";
import { useLanguage } from "@/i18n/language";
import { PieceGlyph } from "./PieceGlyph";
import styles from "./PromotionPicker.module.css";

interface PromotionPickerProps {
  color: Color;
  onPick: (piece: PromotionPiece) => void;
  onCancel: () => void;
}

/**
 * Modal choice of the piece a pawn becomes. Uses a native <dialog>, so the
 * board behind it is inert, focus stays inside and Escape cancels.
 */
export function PromotionPicker({ color, onPick, onCancel }: PromotionPickerProps) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="promotion-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="promotion-title" className={styles.title}>
        {t.choosePiece}
      </h2>
      <div className={styles.choices}>
        {PROMOTION_PIECES.map((piece, i) => (
          <button
            key={piece}
            type="button"
            className={styles.choice}
            autoFocus={i === 0}
            onClick={() => onPick(piece)}
          >
            <span className={styles.glyph}>
              <PieceGlyph piece={{ type: piece, color }} />
            </span>
            {t.pieceNames[piece]}
          </button>
        ))}
      </div>
      <button type="button" className={styles.cancel} onClick={onCancel}>
        {t.cancel}
      </button>
    </dialog>
  );
}
