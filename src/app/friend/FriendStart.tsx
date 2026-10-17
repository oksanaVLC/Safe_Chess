"use client";

import Link from "next/link";
import { useState } from "react";
import { BackIcon } from "@/components/icons";
import { isJoinCodeStart, JOIN_CODE_LENGTH, normalizeJoinCode } from "@/friend/joinCode";
import { useLanguage } from "@/i18n/language";
import styles from "./FriendStart.module.css";

// Play with a friend, first screen: create a game (you play White) or join
// one with a code (you play Black). Nothing here talks to the server yet:
// both actions are wired in the next steps, so their buttons stay disabled.
export function FriendStart() {
  const { t } = useLanguage();
  const [code, setCode] = useState("");
  const normalized = normalizeJoinCode(code);
  // complain only once the text can no longer become a valid code
  const wrong = !isJoinCodeStart(normalized);

  return (
    <main className={styles.screen}>
      <title>{`${t.friend} — Safe Chess`}</title>
      <header className={styles.topBar}>
        <Link href="/" className={styles.back} aria-label={t.backHome}>
          <BackIcon />
        </Link>
        <h1 className={styles.title}>{t.friend}</h1>
      </header>

      <button type="button" className={styles.create} disabled>
        <span className={styles.createTitle}>{t.friendCreate}</span>
        <span className={styles.createSub}>{t.friendCreateSub}</span>
      </button>

      <form className={styles.card} onSubmit={(e) => e.preventDefault()}>
        <h2 className={styles.cardTitle}>{t.friendJoin}</h2>
        <p className={styles.cardSub}>{t.friendJoinSub}</p>
        <label className={styles.label} htmlFor="join-code">
          {t.friendCodeLabel}
        </label>
        <input
          id="join-code"
          className={`${styles.input} ${wrong ? styles.inputWrong : ""}`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={JOIN_CODE_LENGTH + 4}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          placeholder="ABCD-EFGH"
          aria-invalid={wrong}
          aria-describedby={wrong ? "join-code-error" : undefined}
        />
        <p id="join-code-error" className={styles.error} role="alert">
          {wrong ? t.invalidCode : ""}
        </p>
        <button type="submit" className={styles.join} disabled>
          {t.friendJoinButton}
        </button>
      </form>
    </main>
  );
}
