"use client";

import { useReducer, useState } from "react";
import { Board } from "@/components/Board";
import { GameController, type GameStatus, type Square } from "@/game/GameController";
import styles from "./BoardTest.module.css";

// Step 1 only: both sides are played by tapping on one phone. These status
// texts are placeholders; the final wording and translations come later.
function statusText(s: GameStatus): string {
  const side = (c: "w" | "b") => (c === "w" ? "White" : "Black");
  if (s.kind === "checkmate") return `Checkmate — ${side(s.winner)} wins`;
  if (s.kind === "draw") return "Draw";
  return `${side(s.turn)} to move${s.check ? " — check!" : " — tap a piece"}`;
}

export function BoardTest() {
  // The controller is mutable; `rerender` refreshes the view after a change.
  const [game] = useState(() => new GameController());
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const onTap = (square: Square) => {
    if (game.tap(square)) rerender();
  };

  const status = game.status;

  return (
    <main className={styles.screen}>
      <h1 className={styles.title}>Safe Chess</h1>
      <Board squares={game.board()} onTap={onTap} />
      <p className={styles.pill} role="status">
        <span className={styles.dot} aria-hidden="true" />
        {statusText(status)}
      </p>
    </main>
  );
}
