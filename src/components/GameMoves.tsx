"use client";

import type { Move, PieceSymbol } from "chess.js";
import { useEffect, useRef, useState } from "react";
import { positionSquares } from "@/game/GameController";
import { moveNumberOf, positionAt, toEntries, toRows, type MoveEntry } from "@/game/moveList";
import { Board } from "./Board";
import styles from "./GameMoves.module.css";
import { BackIcon, FirstIcon, LastIcon, NextIcon, PreviousIcon } from "./icons";
import { PieceGlyph } from "./PieceGlyph";

// Placeholder English texts; translations come with the language step.
const PIECE_NAMES: Record<PieceSymbol, string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};

interface GameMovesProps {
  history: Move[];
  /** e.g. "You vs Gizmo · Level 3" */
  subtitle: string;
  onBack: () => void;
}

/**
 * Game moves screen: the list of moves, a mini board showing the position
 * at the selected move, and buttons to step through the game.
 */
export function GameMoves({ history, subtitle, onBack }: GameMovesProps) {
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
    const color = e.color === "w" ? "White" : "Black";
    const what = e.castles ? "castles" : `${PIECE_NAMES[e.piece]} ${e.to}`;
    return (
      <button
        type="button"
        ref={selected ? selectedCell : undefined}
        className={`${styles.cell} ${selected ? styles.selected : ""}`}
        aria-current={selected ? "true" : undefined}
        aria-label={`Move ${moveNumberOf(e.ply)}, ${color}, ${what}`}
        onClick={() => go(e.ply)}
      >
        <span className={styles.glyph}>
          <PieceGlyph piece={{ type: e.castles ? "k" : e.piece, color: e.color }} />
        </span>
        {e.castles ? "castles" : e.to}
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
      <header className={styles.topBar}>
        <button type="button" className={styles.back} aria-label="Back to the game" onClick={onBack}>
          <BackIcon />
        </button>
        <div className={styles.titles}>
          <h1 className={styles.title}>Game moves</h1>
          <span className={styles.subtitle}>{subtitle}</span>
        </div>
      </header>

      <Board
        size="mini"
        squares={positionSquares(fen, lastMove)}
        label={ply === 0 ? "Board at the start" : `Board after move ${moveNumber}`}
      />

      <div className={styles.steps}>
        <button
          type="button"
          className={styles.end}
          aria-label="First move"
          disabled={ply === 0}
          onClick={() => go(0)}
        >
          <FirstIcon />
        </button>
        <button
          type="button"
          className={styles.step}
          aria-label="Previous move"
          disabled={ply === 0}
          onClick={() => go(ply - 1)}
        >
          <PreviousIcon />
        </button>
        <p className={styles.counter} aria-live="polite">
          {ply === 0 ? "Start" : `Move ${moveNumber}`}
          <span className={styles.of}>of {rows.length}</span>
        </p>
        <button
          type="button"
          className={styles.step}
          aria-label="Next move"
          disabled={ply === total}
          onClick={() => go(ply + 1)}
        >
          <NextIcon />
        </button>
        <button
          type="button"
          className={styles.end}
          aria-label="Last move"
          disabled={ply === total}
          onClick={() => go(total)}
        >
          <LastIcon />
        </button>
      </div>

      <section className={styles.table} aria-label="Moves">
        <div className={styles.head} aria-hidden="true">
          <span>#</span>
          <span>White</span>
          <span>Black</span>
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
