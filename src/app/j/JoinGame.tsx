"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackIcon } from "@/components/icons";
import { displayJoinCode, joinFriendGame, type JoinResult } from "@/friend/friendApi";
import { isJoinCode, normalizeJoinCode } from "@/friend/joinCode";
import { friendModeConfigured, friendSession, getSupabase, rpcOf, startOverSession } from "@/friend/supabaseClient";
import { useLanguage } from "@/i18n/language";
import { SessionLost } from "../friend/SessionLost";
import styles from "./JoinGame.module.css";

// Joining a friend's game, from the QR code, the shared link or the code
// typed on /friend: all of them arrive here as /j?c=CODE. The joiner
// always plays Black. A code that cannot be valid never reaches the
// server. Once joined, the game board opens.

type State =
  | { kind: "loading" }
  | { kind: "unavailable" } // this build has no Supabase settings
  | { kind: "lost"; code: string } // the stored player could not be restored
  | { kind: "result"; result: JoinResult; code: string };

export function JoinGame() {
  const { t } = useLanguage();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const started = useRef(false);

  const join = useCallback(async (code: string) => {
    const supabase = getSupabase();
    if (!supabase) return setState({ kind: "unavailable" });
    setState({ kind: "loading" });
    const session = await friendSession(supabase);
    if (session.status === "session_lost") return setState({ kind: "lost", code });
    if (session.status !== "ok") return setState({ kind: "result", result: { status: "error" }, code });
    // safe to repeat: a player already seated gets "ok" with the same game
    const result = await joinFriendGame(rpcOf(supabase), code);
    setState({ kind: "result", result, code });
    if (result.status === "ok") router.replace(`/friend/game?g=${result.gameId}`);
  }, [router]);

  // The code comes from the address (?c=), known only in the browser.
  const start = useCallback(async () => {
    const code = normalizeJoinCode(new URLSearchParams(window.location.search).get("c") ?? "");
    if (!isJoinCode(code)) return setState({ kind: "result", result: { status: "invalid" }, code });
    if (!friendModeConfigured) return setState({ kind: "unavailable" });
    await join(code);
  }, [join]);

  useEffect(() => {
    // once per visit, even when React runs effects twice in development
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  const message = (result: JoinResult): string =>
    ({
      ok: t.joined,
      invalid: t.invalidCode,
      expired: t.joinExpired,
      own_game: t.joinOwnGame,
      unavailable: t.joinUnavailable,
      error: t.friendError,
    })[result.status];

  return (
    <main className={styles.screen}>
      <title>{`${t.friend} — Safe Chess`}</title>
      <header className={styles.topBar}>
        <Link href="/friend" className={styles.back} aria-label={t.backHome}>
          <BackIcon />
        </Link>
        <h1 className={styles.title}>{t.friend}</h1>
      </header>

      {state.kind === "loading" ? (
        <p className={styles.waiting} role="status">
          <span className={styles.dot} aria-hidden />…
        </p>
      ) : state.kind === "unavailable" ? (
        <p className={styles.message} role="alert">
          {t.friendUnavailable}
        </p>
      ) : state.kind === "lost" ? (
        <SessionLost
          onStartOver={async () => {
            const fresh = await startOverSession(); // the person chose a new player
            if (fresh.status === "ok") await join(state.code);
            else setState({ kind: "result", result: { status: "error" }, code: state.code });
          }}
        />
      ) : (
        <>
          {isJoinCode(state.code) && <p className={styles.code}>{displayJoinCode(state.code)}</p>}
          <p
            className={`${styles.message} ${state.result.status === "ok" ? styles.ok : ""}`}
            role={state.result.status === "ok" ? "status" : "alert"}
          >
            {message(state.result)}
          </p>
          {state.result.status === "error" ? (
            <button type="button" className={styles.action} onClick={() => void join(state.code)}>
              {t.tryAgain}
            </button>
          ) : state.result.status !== "ok" ? (
            <Link href="/friend" className={styles.action}>
              {t.friendJoin}
            </Link>
          ) : null}
        </>
      )}
    </main>
  );
}
