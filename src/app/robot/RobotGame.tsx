"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { Board } from "@/components/Board";
import { BackIcon, MovesIcon, NewGameIcon, UndoIcon } from "@/components/icons";
import { LevelToolbar } from "@/components/LevelToolbar";
import { PromotionPicker } from "@/components/PromotionPicker";
import type { Level } from "@/engine/ChessEngine";
import { Robot } from "@/engine/Robot";
import { GameController, type PromotionPiece, type Square } from "@/game/GameController";
import { ROBOTS } from "@/game/robots";
import styles from "./RobotGame.module.css";

const PLAYER = "w";
/** The robot waits at least this long, so its move is easy to follow. */
const MIN_THINK_MS = 600;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function RobotGame() {
  // The controller is mutable; `rerender` refreshes the view after a change.
  const [game] = useState(() => new GameController(undefined, PLAYER));
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [level, setLevel] = useState<Level>(3);
  const [thinking, setThinking] = useState(false);
  const robot = useRef<Robot | null>(null);
  /** Bumped to discard a robot reply that is no longer wanted. */
  const searchId = useRef(0);

  useEffect(() => {
    const r = new Robot();
    robot.current = r;
    return () => r.stop();
  }, []);

  const robotName = ROBOTS[level].name;

  function letRobotMove() {
    if (game.isOver || game.turn === PLAYER || !robot.current) return;
    const id = ++searchId.current;
    setThinking(true);
    Promise.all([robot.current.getBestMove(game.fen, level), wait(MIN_THINK_MS)])
      .then(([uci]) => {
        if (id !== searchId.current) return;
        game.playUci(uci);
        setThinking(false);
        rerender();
      })
      .catch(() => {
        if (id === searchId.current) setThinking(false);
      });
  }

  function stopRobot() {
    searchId.current++;
    robot.current?.stop();
    setThinking(false);
  }

  function afterPlayerAction(changed: boolean) {
    if (!changed) return;
    rerender();
    letRobotMove();
  }

  const onTap = (square: Square) => afterPlayerAction(game.tap(square));
  const onPick = (piece: PromotionPiece) => afterPlayerAction(game.promote(piece));
  const onCancelPromotion = () => {
    if (game.cancelPromotion()) rerender();
  };

  const onUndo = () => {
    stopRobot();
    if (game.undo()) rerender();
  };

  const onNew = () => {
    stopRobot();
    game.reset();
    rerender();
  };

  // Placeholder status texts; final wording and translations come later.
  const status = game.status;
  let statusText = "Your turn — tap a piece";
  let waiting = false;
  if (status.kind === "checkmate") {
    statusText = status.winner === PLAYER ? "Checkmate — you win!" : `Checkmate — ${robotName} wins`;
  } else if (status.kind === "draw") {
    statusText = "It's a draw";
  } else if (thinking) {
    statusText = `${robotName} is thinking…`;
    waiting = true;
  } else if (status.check) {
    statusText = "Check! Your turn";
  }

  const pending = game.pendingPromotion;

  return (
    <main className={styles.screen}>
      <header className={styles.topBar}>
        <Link href="/" className={styles.back} aria-label="Back to home">
          <BackIcon />
        </Link>
        <h1 className={styles.title}>You vs {robotName}</h1>
      </header>

      <LevelToolbar level={level} onChange={setLevel} />

      <Board squares={game.board()} onTap={onTap} />

      <p className={`${styles.pill} ${waiting ? styles.pillWaiting : ""}`} role="status">
        <span className={styles.dot} aria-hidden="true" />
        {statusText}
      </p>

      <nav className={styles.bottomBar} aria-label="Game">
        <button type="button" className={styles.undo} onClick={onUndo} disabled={!game.canUndo}>
          <UndoIcon />
          Undo
        </button>
        {/* Opens the Game moves screen once it exists (Step 3). */}
        <button type="button" className={styles.secondary} disabled>
          <MovesIcon />
          Moves
        </button>
        <button type="button" className={styles.secondary} onClick={onNew}>
          <NewGameIcon />
          New
        </button>
      </nav>

      {pending && (
        <PromotionPicker color={pending.color} onPick={onPick} onCancel={onCancelPromotion} />
      )}
    </main>
  );
}
