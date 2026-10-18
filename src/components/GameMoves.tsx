"use client";

import type { Move } from "chess.js";
import { useEffect, useRef, useState } from "react";
import { positionSquares } from "@/game/GameController";
import { moveNumberOf, positionAt, toEntries, toRows, type MoveEntry } from "@/game/moveList";
import { useLanguage } from "@/i18n/language";
import { Board } from "./Board";
import styles from "./GameMoves.module.css";
import { BackIcon, FirstIcon, LastIcon, NextIcon, PreviousIcon } from "./icons";
import { PieceGlyph } from "./PieceGlyph";

interface GameMovesProps {
  history: Move[];
  /** e.g. "You vs Gizmo · Level 3" */
  subtitle: string;
  onBack: () => void;
  /** The side at the bottom of the mini board (default White). */
  orientation?: "w" | "b";
}

/**
 * Game moves screen: the list of moves, a mini board showing the position
 * at the selected move, and buttons to step through the game.
 */
export function GameMoves({ history, subtitle, onBack, orientation }: GameMovesProps) {
  const { t } = useLanguage();
  const entries = toEntries(history);
  const rows = toRows(entries);
  const total = entries.length;

  // null = follow the latest move (also while the robot keeps playing).
  const [chosen, setChosen] = useState<number | null>(null);
  const ply = Math.min(chosen ?? total, total);
  const go = (p: number) => setChosen(Math.max(0, Math.min(p, total)));

  const { fen, lastMove } = positionAt(entries, ply);
  const moveNumber = moveNumberOf(ply);

  const list = useRef<HTMLOListElement>(null);
  const selectedCell = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Keep the selected move in view; at the start, show the first moves.
    if (ply === 0) list.current?.scrollTo({ top: 0 });
    else selectedCell.current?.scrollIntoView({ block: "nearest" });
  }, [ply]);

  const cell = (e: MoveEntry | undefined) => {
    if (!e) return <span />;
    const selected = e.ply === ply;
    const color = e.color === "w" ? t.whiteCol : t.blackCol;
    const what = e.castles ? t.castles : `${t.pieceNames[e.piece].toLowerCase()} ${e.to}`;
    return (
      <button
        type="button"
        ref={selected ? selectedCell : undefined}
        className={`${styles.cell} ${selected ? styles.selected : ""}`}
        aria-current={selected ? "true" : undefined}
        aria-label={`${t.move} ${moveNumberOf(e.ply)}, ${color}, ${what}`}
        onClick={() => go(e.ply)}
      >
        <span className={styles.glyph}>
          <PieceGlyph piece={{ type: e.castles ? "k" : e.piece, color: e.color }} />
        </span>
        {e.castles ? t.castles : e.to}
        {e.promotion && (
          <span className={styles.glyph}>
            <PieceGlyph piece={{ type: e.promotion, color: e.color }} />
          </span>
        )}
      </button>
    );
  };

  return (
    <main className={styles.screen}>
      <title>{`${t.gameMoves} — Safe Chess`}</title>
      <header className={styles.topBar}>
        <button type="button" className={styles.back} aria-label={t.backToGame} onClick={onBack}>
          <BackIcon />
        </button>
        <div className={styles.titles}>
          <h1 className={styles.title}>{t.gameMoves}</h1>
          <span className={styles.subtitle}>{subtitle}</span>
        </div>
      </header>

      <Board
        size="mini"
        squares={orientation === "b" ? positionSquares(fen, lastMove).reverse() : positionSquares(fen, lastMove)}
        orientation={orientation}
        label={ply === 0 ? t.boardAtStart : t.boardAfterMove(moveNumber)}
      />

      <div className={styles.steps}>
        <button
          type="button"
          className={styles.end}
          aria-label={t.firstMove}
          disabled={ply === 0}
          onClick={() => go(0)}
        >
          <FirstIcon />
        </button>
        <button
          type="button"
          className={styles.step}
          aria-label={t.previousMove}
          disabled={ply === 0}
          onClick={() => go(ply - 1)}
        >
          <PreviousIcon />
        </button>
        <p className={styles.counter} aria-live="polite">
          {ply === 0 ? t.start : `${t.move} ${moveNumber}`}
          <span className={styles.of}>
            {t.of} {rows.length}
          </span>
        </p>
        <button
          type="button"
          className={styles.step}
          aria-label={t.nextMove}
          disabled={ply === total}
          onClick={() => go(ply + 1)}
        >
          <NextIcon />
        </button>
        <button
          type="button"
          className={styles.end}
          aria-label={t.lastMove}
          disabled={ply === total}
          onClick={() => go(total)}
        >
          <LastIcon />
        </button>
      </div>

      <section className={styles.table} aria-label={t.moves}>
        <div className={styles.head} aria-hidden="true">
          <span>#</span>
          <span>{t.whiteCol}</span>
          <span>{t.blackCol}</span>
        </div>
        <ol ref={list} className={styles.rows}>
          {rows.map((row) => (
            <li key={row.number} className={styles.row}>
              <span className={styles.number} aria-hidden="true">
                {row.number}
              </span>
              {cell(row.white)}
              {cell(row.black)}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
