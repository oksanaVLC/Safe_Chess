"use client";

import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackIcon } from "@/components/icons";
import { cancelFriendGame, createFriendGame, displayJoinCode, joinLink } from "@/friend/friendApi";
import { friendModeConfigured, friendSession, getSupabase, rpcOf } from "@/friend/supabaseClient";
import { useLanguage } from "@/i18n/language";
import styles from "./FriendCreate.module.css";

// Play with a friend, creator's screen: the QR code and the typed code for
// the friend, a share button and "Waiting for your friend…". The creator
// always plays White (no colour picker). Going back cancels the game while
// it is still waiting. Noticing that the friend joined comes in a later step.

type State =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; gameId: string; code: string; link: string };

export function FriendCreate() {
  const { t } = useLanguage();
  const router = useRouter();
  const [state, setState] = useState<State>(friendModeConfigured ? { kind: "loading" } : { kind: "unavailable" });
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const started = useRef(false);

  const create = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return setState({ kind: "unavailable" });
    setState({ kind: "loading" });
    const session = await friendSession(supabase);
    if (session.status !== "ok") return setState({ kind: "error" });
    // safe to repeat: a waiting game comes back as "existing", never twice
    const game = await createFriendGame(rpcOf(supabase));
    if (game.status !== "ok") return setState({ kind: "error" });
    setState({ kind: "ready", gameId: game.gameId, code: game.code, link: joinLink(window.location.origin, game.code) });
  }, []);

  useEffect(() => {
    // once per visit, even when React runs effects twice in development
    if (started.current || !friendModeConfigured) return;
    started.current = true;
    void create();
  }, [create]);

  async function leave() {
    if (leaving) return;
    setLeaving(true);
    const supabase = getSupabase();
    if (state.kind === "ready" && supabase) {
      // deletes the game only while nobody has joined; one attempt
      await cancelFriendGame(rpcOf(supabase), state.gameId);
    }
    router.push("/friend");
  }

  async function share(link: string) {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "Safe Chess", text: t.friend, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // share sheet closed or clipboard refused: nothing to do
    }
  }

  return (
    <main className={styles.screen}>
      <title>{`${t.friend} — Safe Chess`}</title>
      <header className={styles.topBar}>
        <button type="button" className={styles.back} aria-label={t.backHome} onClick={leave} disabled={leaving}>
          <BackIcon />
        </button>
        <h1 className={styles.title}>{t.friend}</h1>
      </header>

      {state.kind === "ready" ? (
        <>
          <p className={styles.lead}>{t.scan}</p>
          <div className={styles.card}>
            <QRCodeSVG value={state.link} size={220} level="M" fgColor="#2c2e48" bgColor="#ffffff" className={styles.qr} />
            <p className={styles.orType}>{t.orType}</p>
            <p className={styles.code} aria-label={[...state.code].join(" ")}>
              {displayJoinCode(state.code)}
            </p>
          </div>
          <div className={styles.bottom}>
            <button type="button" className={styles.share} onClick={() => share(state.link)}>
              {t.share}
            </button>
            <p className={styles.waiting} role="status">
              <span className={styles.dot} aria-hidden />
              {copied ? t.linkCopied : t.waiting}
            </p>
          </div>
        </>
      ) : state.kind === "loading" ? (
        <p className={styles.waiting} role="status">
          <span className={styles.dot} aria-hidden />…
        </p>
      ) : (
        <div className={styles.problem} role="alert">
          <p className={styles.problemText}>{state.kind === "unavailable" ? t.friendUnavailable : t.friendError}</p>
          {state.kind === "error" && (
            <button type="button" className={styles.share} onClick={() => void create()}>
              {t.tryAgain}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
