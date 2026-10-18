"use client";

import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Board } from "@/components/Board";
import { GameMoves } from "@/components/GameMoves";
import { BackIcon, MovesIcon } from "@/components/icons";
import { PromotionPicker } from "@/components/PromotionPicker";
import { positionSquares, type Color, type GameController, type PromotionPiece, type Square } from "@/game/GameController";
import { displayJoinCode } from "@/friend/friendApi";
import {
  canMove,
  controllerFor,
  isGameId,
  opponentPresent,
  orientSquares,
  outcomeFor,
  seatOf,
  uciOf,
  type FriendGame,
} from "@/friend/friendGame";
import { GameSync, type Connection } from "@/friend/gameSync";
import { friendSession, getSupabase, readGame, sendMove, startOverSession, subscribeToGame } from "@/friend/supabaseClient";
import { useLanguage } from "@/i18n/language";
import { SessionLost } from "../SessionLost";
import robotStyles from "../../robot/RobotGame.module.css";
import styles from "./FriendGameScreen.module.css";

// A game between two friends. The board shows only what the server has
// confirmed: a move is sent to friend-move and appears once the server's
// answer (or a fresh read) contains it. Realtime events only trigger a new
// read of the row (see GameSync). The creator plays White, the joiner
// Black; each sees their own pieces at the bottom.

type Phase = "loading" | "ready" | "unavailable" | "gone" | "error" | "lost";

/** How long the friend must be gone before "Your friend left the game" shows. */
const FRIEND_LEFT_DELAY_MS = 5000;

export function FriendGameScreen() {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<Phase>("loading");
  const [game, setGame] = useState<FriendGame | null>(null);
  const [seat, setSeat] = useState<Color | null>(null);
  const [ctl, setCtl] = useState<GameController | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [sending, setSending] = useState(false);
  const [moveFailed, setMoveFailed] = useState(false);
  const [showMoves, setShowMoves] = useState(false);
  const sync = useRef<GameSync | null>(null);
  const mounted = useRef(false);
  const started = useRef(false);
  // Presence: "Your friend left the game" once the friend, seen here before,
  // has been gone for a few seconds (a reload does not count).
  const [friendAway, setFriendAway] = useState(false);
  const friendSeen = useRef(false);
  const awayTimer = useRef<number | null>(null);
  // Redraws the screen when the game's time runs out (no server event needed).
  const [, setExpiryTick] = useState(0);

  const onFriendPresence = useCallback((present: boolean) => {
    if (awayTimer.current !== null) {
      window.clearTimeout(awayTimer.current);
      awayTimer.current = null;
    }
    if (present) {
      friendSeen.current = true;
      setFriendAway(false);
    } else if (friendSeen.current) {
      awayTimer.current = window.setTimeout(() => {
        awayTimer.current = null;
        if (mounted.current) setFriendAway(true);
      }, FRIEND_LEFT_DELAY_MS);
    }
  }, []);

  const load = useCallback(async () => {
    const id = new URLSearchParams(window.location.search).get("g")?.toLowerCase();
    if (!isGameId(id)) return setPhase("gone");
    const supabase = getSupabase();
    if (!supabase) return setPhase("unavailable");
    setPhase("loading");
    const session = await friendSession(supabase); // reuses this browser's session
    if (session.status === "session_lost") return setPhase("lost");
    if (session.status !== "ok") return setPhase("error");
    const first = await readGame(supabase, id);
    if (!mounted.current) return;
    if (first.kind !== "ok") return setPhase(first.kind === "gone" ? "gone" : "error");
    const mySeat = seatOf(first.game, session.userId);
    if (!mySeat) return setPhase("gone");

    const show = (g: FriendGame) => {
      setGame(g);
      setCtl(controllerFor(g, mySeat));
    };
    sync.current?.dispose();
    const s = new GameSync(
      {
        fetchGame: () => readGame(supabase, id),
        subscribe: (onEvent, onStatus) =>
          subscribeToGame(supabase, id, onEvent, onStatus, {
            key: session.userId,
            seat: mySeat,
            onChange: (state) => onFriendPresence(opponentPresent(state, mySeat)),
          }),
        onUpdate: show,
        onGone: () => setPhase("gone"),
        onConnection: setConnection,
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (handle) => window.clearTimeout(handle as number),
      },
      first.game,
    );
    sync.current = s;
    setSeat(mySeat);
    show(first.game);
    setPhase("ready");
    s.start();
  }, [onFriendPresence]);

  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      void load();
    }
    // back on the tab, or back online: read the game again at once
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync.current?.refresh();
    };
    const onOnline = () => void sync.current?.refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [load]);

  // leave the channel, stop polling and the presence timer when the screen goes away
  useEffect(
    () => () => {
      sync.current?.dispose();
      if (awayTimer.current !== null) window.clearTimeout(awayTimer.current);
    },
    [],
  );

  // An active game stops accepting moves at expires_at: redraw then, so it
  // shows as expired even before the cleanup job's event arrives.
  const expiresAt = game?.status === "active" ? game.expiresAt : null;
  useEffect(() => {
    if (expiresAt === null) return;
    const ms = expiresAt - Date.now();
    if (ms <= 0 || ms > 2 ** 31 - 1) return; // already past (shown as expired) or beyond a timer's range
    const id = window.setTimeout(() => setExpiryTick((n) => n + 1), ms + 50);
    return () => window.clearTimeout(id);
  }, [expiresAt]);

  async function submit(uci: string) {
    const s = sync.current;
    const supabase = getSupabase();
    if (!s || !seat || !supabase) return;
    const confirmed = s.game;
    setCtl(controllerFor(confirmed, seat)); // the board keeps the confirmed position
    setSending(true);
    setMoveFailed(false);
    const result = await sendMove(supabase, { gameId: confirmed.id, expectedVersion: confirmed.version, uci });
    if (!mounted.current) return;
    setSending(false);
    if (result.kind === "ok") {
      if (!s.adopt(result.game)) setCtl(controllerFor(s.game, seat));
    } else if (result.kind === "resync") {
      // not applied: show the server's game, or read it
      if (!result.game || !s.adopt(result.game)) void s.refresh();
    } else if (result.kind === "denied") {
      setPhase("gone");
    } else {
      setMoveFailed(true);
      void s.refresh();
    }
  }

  function act(change: (c: GameController) => boolean) {
    if (!game || !seat || !ctl || !canMove(game, seat, ctl, sending)) return;
    const before = ctl.plyCount;
    if (!change(ctl)) return;
    const played = ctl.plyCount > before ? ctl.history().at(-1) : undefined;
    if (played) void submit(uciOf(played));
    else rerender();
  }

  const onTap = (square: Square) => act((c) => c.tap(square));
  const onPick = (piece: PromotionPiece) => act((c) => c.promote(piece));
  const onCancelPromotion = () => {
    if (ctl?.cancelPromotion()) rerender();
  };

  const header = (
    <header className={robotStyles.topBar}>
      <Link href="/" className={robotStyles.back} aria-label={t.backHome}>
        <BackIcon />
      </Link>
      <h1 className={robotStyles.title}>{t.friend}</h1>
    </header>
  );

  if (phase === "lost") {
    return (
      <main className={robotStyles.screen}>
        <title>{`${t.friend} — Safe Chess`}</title>
        {header}
        <SessionLost
          onStartOver={async () => {
            // a new player: this game is no longer theirs. If creating it
            // failed, stop here: no second attempt without another tap.
            const fresh = await startOverSession();
            if (fresh.status === "ok") await load();
            else setPhase("error");
          }}
        />
      </main>
    );
  }

  if (phase !== "ready" || !game || !seat) {
    const message =
      phase === "loading" ? null : phase === "unavailable" ? t.friendUnavailable : phase === "gone" ? t.gameUnavailable : t.friendError;
    return (
      <main className={robotStyles.screen}>
        <title>{`${t.friend} — Safe Chess`}</title>
        {header}
        {message === null ? (
          <p className={`${robotStyles.pill} ${robotStyles.pillWaiting}`} role="status">
            <span className={robotStyles.dot} aria-hidden="true" />…
          </p>
        ) : (
          <div className={styles.problem}>
            <p className={styles.problemText} role="alert">
              {message}
            </p>
            {phase === "error" ? (
              <button type="button" className={styles.action} onClick={() => void load()}>
                {t.tryAgain}
              </button>
            ) : (
              <Link href="/friend" className={styles.action}>
                {t.friend}
              </Link>
            )}
          </div>
        )}
      </main>
    );
  }

  const outcome = outcomeFor(game, seat, ctl);
  const playable = canMove(game, seat, ctl, sending);
  let statusText: string;
  let waiting = false;
  if (sending) {
    statusText = t.sendingMove;
    waiting = true;
  } else if (outcome.kind === "waiting") {
    statusText = t.waiting;
    waiting = true;
  } else if (outcome.kind === "playing") {
    if (outcome.myTurn) statusText = outcome.check ? t.check : t.turnHint;
    else {
      statusText = t.friendWaitMove;
      waiting = true;
    }
  } else {
    statusText = { win: t.win, loss: t.friendLoss, draw: t.draw, expired: t.gameExpired }[outcome.kind];
  }

  // Selection and move dots only while the person may move.
  const squares = ctl && playable ? ctl.board() : positionSquares(game.fen, ctl?.lastMove ?? null);
  const pending = playable ? ctl?.pendingPromotion : null;

  if (showMoves && ctl) {
    return (
      <GameMoves
        history={ctl.history()}
        subtitle={`${t.friend} · ${displayJoinCode(game.code)}`}
        onBack={() => setShowMoves(false)}
        orientation={seat}
      />
    );
  }

  return (
    <main className={robotStyles.screen}>
      <title>{`${t.friend} — Safe Chess`}</title>
      {header}

      <p className={styles.info}>
        <span>{seat === "w" ? t.friendCreateSub : t.friendJoinSub}</span>
        <span className={styles.code}>
          {t.gameCode} {displayJoinCode(game.code)}
        </span>
      </p>

      <Board squares={orientSquares(squares, seat)} onTap={onTap} orientation={seat} />

      <p className={`${robotStyles.pill} ${waiting ? robotStyles.pillWaiting : ""}`} role="status">
        <span className={robotStyles.dot} aria-hidden="true" />
        {statusText}
      </p>
      {connection === "reconnecting" && <p className={styles.connection}>{t.reconnecting}</p>}
      {friendAway && outcome.kind === "playing" && (
        <p className={styles.connection} role="status">
          {t.friendLeft}
        </p>
      )}
      {moveFailed && (
        <p className={styles.notice} role="alert">
          {t.friendError}
        </p>
      )}

      <nav className={styles.bottomBar} aria-label={t.game}>
        <button type="button" className={robotStyles.secondary} onClick={() => setShowMoves(true)} disabled={!ctl}>
          <MovesIcon />
          {t.moves}
        </button>
      </nav>

      {pending && <PromotionPicker color={pending.color} onPick={onPick} onCancel={onCancelPromotion} />}
    </main>
  );
}
