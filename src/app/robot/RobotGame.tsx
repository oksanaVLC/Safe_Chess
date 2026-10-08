"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { Board } from "@/components/Board";
import { ClockFace } from "@/components/ClockFace";
import { GameMoves } from "@/components/GameMoves";
import { BackIcon, MovesIcon, NewGameIcon, RobotIcon, UndoIcon } from "@/components/icons";
import { LevelToolbar } from "@/components/LevelToolbar";
import { PromotionPicker } from "@/components/PromotionPicker";
import type { Level } from "@/engine/ChessEngine";
import { Robot } from "@/engine/Robot";
import { GameClock } from "@/game/ChessClock";
import {
  GameController,
  positionSquares,
  type PromotionPiece,
  type Square,
} from "@/game/GameController";
import { gameSubtitle, opponentsOf } from "@/game/robots";
import { useLanguage } from "@/i18n/language";
import styles from "./RobotGame.module.css";

const PLAYER = "w";
const ROBOT = "b";
/** The robot waits at least this long, so its move is easy to follow. */
const MIN_THINK_MS = 600;
/** How often the clocks are redrawn and checked for running out. */
const CLOCK_TICK_MS = 200;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Who ran out of time, and which robot was playing then. */
interface TimeOut {
  side: "w" | "b";
  robotLevel: Level;
}

/** Play vs robot; with `timed`, the "Robot with a clock" mode (10 minutes each). */
export function RobotGame({ timed = false }: { timed?: boolean }) {
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

  // Timed mode only.
  const [clock] = useState(() => (timed ? new GameClock() : null));
  const [timeOut, setTimeOut] = useState<TimeOut | null>(null);
  const levelRef = useRef(level);
  /** Level of the robot searching right now (for "ran out of time"). */
  const searchLevelRef = useRef<Level | null>(null);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    const r = new Robot();
    robot.current = r;
    return () => r.stop();
  }, []);

  // The person's clock runs from the start of the game.
  useEffect(() => {
    clock?.begin(PLAYER);
  }, [clock]);

  // Redraw the running clock and end the game when a clock reaches 00:00.
  useEffect(() => {
    if (!clock) return;
    const id = setInterval(() => {
      if (!clock.clock.running) return;
      const flagged = clock.clock.flagged;
      if (flagged) {
        clock.clock.stop();
        searchId.current++; // drop the robot's reply, if it is thinking
        robot.current?.stop();
        setThinking(null);
        game.cancelPromotion();
        const robotLevel =
          flagged === ROBOT ? (searchLevelRef.current ?? levelRef.current) : levelRef.current;
        setTimeOut({ side: flagged, robotLevel });
      }
      rerender();
    }, CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [clock, game]);

  const isOver = game.isOver || timeOut !== null;

  /** After a move reached the current position: switch or stop the clocks. */
  function clockAfterMove() {
    clock?.moved(game.plyCount, game.isOver ? null : game.turn);
  }

  function letRobotMove() {
    if (isOverNow() || game.turn === PLAYER || !robot.current) return;
    const id = ++searchId.current;
    const searchLevel = level;
    searchLevelRef.current = searchLevel;
    setThinking(searchLevel);
    Promise.all([robot.current.getBestMove(game.fen, searchLevel), wait(MIN_THINK_MS)])
      .then(([uci]) => {
        if (id !== searchId.current) return;
        if (clock?.clock.flagged === ROBOT) return; // the clock tick ends the game
        if (!game.playUci(uci)) return;
        clockAfterMove();
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

  /** Game over right now, including a clock that has just run out. */
  function isOverNow() {
    return game.isOver || timeOut !== null || clock?.clock.flagged != null;
  }

  function stopRobot() {
    searchId.current++;
    robot.current?.stop();
    setThinking(null);
  }

  function afterPlayerAction(play: () => boolean) {
    if (isOverNow()) return;
    const before = game.plyCount;
    if (!play()) return;
    if (game.plyCount > before) clockAfterMove();
    rerender();
    letRobotMove();
  }

  const onTap = (square: Square) => afterPlayerAction(() => game.tap(square));
  const onPick = (piece: PromotionPiece) => afterPlayerAction(() => game.promote(piece));
  const onCancelPromotion = () => {
    if (game.cancelPromotion()) rerender();
  };

  const onUndo = () => {
    stopRobot();
    if (game.undo()) {
      // Both clocks go back to exactly what they showed at that position.
      clock?.undoTo(game.plyCount, game.isOver ? null : game.turn);
      setTimeOut(null);
      setRobotLevels((prev) => prev.slice(0, game.plyCount));
      rerender();
    }
  };

  const onNew = () => {
    stopRobot();
    game.reset();
    clock?.begin(PLAYER);
    setTimeOut(null);
    setRobotLevels([]);
    rerender();
  };

  const status = game.status;
  let statusText = timed ? t.yourTurn : t.turnHint;
  let waiting = false;
  if (timeOut) {
    statusText =
      timeOut.side === PLAYER
        ? t.timeUpLoss(t.robots[timeOut.robotLevel].name)
        : t.timeUpWin(t.robots[timeOut.robotLevel].vsName);
  } else if (status.kind === "checkmate") {
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

  const pending = isOver ? null : game.pendingPromotion;
  const title = timed ? t.timed : t.robot;

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

  // Once the game is over (also on time), no selection or move dots remain.
  const squares = isOver ? positionSquares(game.fen, game.lastMove) : game.board();
  const board = <Board squares={squares} onTap={onTap} />;

  return (
    <main className={`${styles.screen} ${timed ? styles.timed : ""}`}>
      <title>{`${title} — Safe Chess`}</title>
      <header className={styles.topBar}>
        <Link href="/" className={styles.back} aria-label={t.backHome}>
          <BackIcon />
        </Link>
        <h1 className={styles.title}>
          {t.vs} {t.robots[level].vsName}
        </h1>
      </header>

      <LevelToolbar level={level} onChange={setLevel} />

      {clock ? (
        <>
          <div className={styles.clockRow}>
            <span className={styles.who}>
              <RobotIcon size={26} />
              {t.robots[level].name}
            </span>
            <ClockFace
              ms={clock.clock.remaining(ROBOT)}
              running={clock.clock.running === ROBOT}
              label={t.robotClock(t.robots[level].vsName)}
            />
          </div>
          {board}
          <div className={styles.clockRow}>
            <p className={`${styles.who} ${waiting ? styles.whoWaiting : ""}`} role="status">
              <span className={styles.dot} aria-hidden="true" />
              {statusText}
            </p>
            <ClockFace
              ms={clock.clock.remaining(PLAYER)}
              running={clock.clock.running === PLAYER}
              label={t.yourClock}
            />
          </div>
        </>
      ) : (
        <>
          {board}
          <p className={`${styles.pill} ${waiting ? styles.pillWaiting : ""}`} role="status">
            <span className={styles.dot} aria-hidden="true" />
            {statusText}
          </p>
        </>
      )}

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
