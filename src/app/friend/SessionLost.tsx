"use client";

import Link from "next/link";
import { useState } from "react";
import { useLanguage } from "@/i18n/language";
import styles from "./SessionLost.module.css";

// Shown when this browser's stored anonymous player could not be restored.
// Nothing happens unless the person chooses: "Start again" creates a new
// player (their earlier games can't be continued); the home link leaves
// everything as it is.
export function SessionLost({ onStartOver }: { onStartOver: () => Promise<void> }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  return (
    <div className={styles.box} role="alert">
      <p className={styles.title}>{t.sessionLost}</p>
      <p className={styles.hint}>{t.sessionLostHint}</p>
      <button
        type="button"
        className={styles.startOver}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onStartOver();
          setBusy(false);
        }}
      >
        {t.startOver}
      </button>
      <Link href="/" className={styles.home}>
        {t.backHome}
      </Link>
    </div>
  );
}
