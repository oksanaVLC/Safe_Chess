"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { Board } from "@/components/Board";
import { GameMoves } from "@/components/GameMoves";
import { BackIcon, MovesIcon, NewGameIcon, UndoIcon } from "@/components/icons";
import { LevelToolbar } from "@/components/LevelToolbar";
import { PromotionPicker } from "@/components/PromotionPicker";
import type { Level } from "@/engine/ChessEngine";
import { Robot } from "@/engine/Robot";
import { GameController, type PromotionPiece, type Square } from "@/game/GameController";
import { gameSubtitle, opponentsOf } from "@/game/robots";
import { useLanguage } from "@/i18n/language";
import styles from "./RobotGame.module.css";

const PLAYER = "w";
/** The robot waits at least this long, so its move is easy to follow. */
const MIN_THINK_MS = 600;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function RobotGame() {
  const { t } = useLanguage();
  // The controller is mutable; `rerender` refreshes the view after a change.
  const [game] = useState(() => new GameController(undefined, PLAYER));
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [level, setLevel] = useState<Level>(3);
  /** Level of the robot that is searching, or null. */
  const [thinking, setThinking] = useState<Level | null>(null);
  /**
   * Which robot level played each half-move (index = ply - 1; undefined for
   * the person's moves). Kept with the game, so the Game moves screen
   * describes this game even if the level toolbar changes later.
   */
  const [robotLevels, setRobotLevels] = useState<(Level | undefined)[]>([]);
  const [showMoves, setShowMoves] = useState(false);
  const robot = useRef<Robot | null>(null);
  /** Bumped to discard a robot reply that is no longer wanted. */
  const searchId = useRef(0);

  useEffect(() => {
    const r = new Robot();
    robot.current = r;
    return () => r.stop();
  }, []);


  function letRobotMove() {
    if (game.isOver || game.turn === PLAYER || !robot.current) return;
    const id = ++searchId.current;
    const searchLevel = level;
    setThinking(searchLevel);
    Promise.all([robot.current.getBestMove(game.fen, searchLevel), wait(MIN_THINK_MS)])
      .then(([uci]) => {
        if (id !== searchId.current || !game.playUci(uci)) return;
        const ply = game.plyCount;
        setRobotLevels((prev) => {
          const next = prev.slice(0, ply - 1);
          next[ply - 1] = searchLevel;
          return next;
        });
        setThinking(null);
        rerender();
      })
      .catch(() => {
        if (id === searchId.current) setThinking(null);
      });
  }

  function stopRobot() {
    searchId.current++;
    robot.current?.stop();
    setThinking(null);
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
    if (game.undo()) {
      setRobotLevels((prev) => prev.slice(0, game.plyCount));
      rerender();
    }
  };

  const onNew = () => {
    stopRobot();
    game.reset();
    setRobotLevels([]);
    rerender();
  };

  const status = game.status;
  let statusText = t.turnHint;
  let waiting = false;
  if (status.kind === "checkmate") {
    // The robot that delivered mate, even if the level was changed since.
    const winner = robotLevels[game.plyCount - 1] ?? level;
    statusText = status.winner === PLAYER ? t.win : t.loss(t.robots[winner].name);
  } else if (status.kind === "draw") {
    statusText = t.draw;
  } else if (thinking) {
    statusText = t.thinking(t.robots[thinking].name);
    waiting = true;
  } else if (status.check) {
    statusText = t.check;
  }

  const pending = game.pendingPromotion;

  // The game stays mounted while the moves are shown, so the robot keeps
  // its turn and the game is unchanged when coming back.
  // Before the robot's first move, the game's opponent is the selected one.
  const opponents = opponentsOf(robotLevels);
  if (showMoves) {
    return (
      <GameMoves
        history={game.history()}
        subtitle={gameSubtitle(t, opponents.length > 0 ? opponents : [level])}
        onBack={() => setShowMoves(false)}
      />
    );
  }

  return (
    <main className={styles.screen}>
      <title>{`${t.robot} — Safe Chess`}</title>
      <header className={styles.topBar}>
        <Link href="/" className={styles.back} aria-label={t.backHome}>
          <BackIcon />
        </Link>
        <h1 className={styles.title}>
          {t.vs} {t.robots[level].vsName}
        </h1>
      </header>

      <LevelToolbar level={level} onChange={setLevel} />

      <Board squares={game.board()} onTap={onTap} />

      <p className={`${styles.pill} ${waiting ? styles.pillWaiting : ""}`} role="status">
        <span className={styles.dot} aria-hidden="true" />
        {statusText}
      </p>

      <nav className={styles.bottomBar} aria-label={t.game}>
        <button type="button" className={styles.undo} onClick={onUndo} disabled={!game.canUndo}>
          <UndoIcon />
          {t.undo}
        </button>
        <button type="button" className={styles.secondary} onClick={() => setShowMoves(true)}>
          <MovesIcon />
          {t.moves}
        </button>
        <button type="button" className={styles.secondary} onClick={onNew}>
          <NewGameIcon />
          {t.new}
        </button>
      </nav>

      {pending && (
        <PromotionPicker color={pending.color} onPick={onPick} onCancel={onCancelPromotion} />
      )}
    </main>
  );
}
