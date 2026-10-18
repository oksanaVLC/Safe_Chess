"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ClockIcon, QrIcon, RobotIcon } from "@/components/icons";
import { LanguageMenu } from "@/components/LanguageMenu";
import { PieceGlyph } from "@/components/PieceGlyph";
import { useLanguage } from "@/i18n/language";
import styles from "./page.module.css";

// Home (design page 1): the logo, the name and tagline, and the three ways
// to play. "My account" is out of scope (no accounts) and "See my last
// game" comes in a later step, so neither is shown.
export function StartPage() {
  const { t } = useLanguage();

  return (
    <main className={styles.screen}>
      <title>Safe Chess</title>
      <LanguageMenu />

      <div className={styles.brand}>
        <KnightLogo />
        <h1 className={styles.title}>Safe Chess</h1>
        <p className={styles.tagline}>{t.tagline}</p>
      </div>

      <nav className={styles.modes}>
        <ModeCard href="/robot" variant="robot" icon={<RobotIcon size={34} />} title={t.robot} sub={t.robotSub} />
        <ModeCard href="/timed" variant="timed" icon={<ClockIcon size={34} />} title={t.timed} sub={t.timedSub} />
        <ModeCard href="/friend" variant="friend" icon={<QrIcon size={34} />} title={t.friend} sub={t.friendSub} />
      </nav>
    </main>
  );
}

function ModeCard(props: { href: string; variant: "robot" | "timed" | "friend"; icon: ReactNode; title: string; sub: string }) {
  return (
    <Link href={props.href} className={`${styles.card} ${styles[props.variant]}`}>
      <span className={styles.tile}>{props.icon}</span>
      <span className={styles.text}>
        <span className={styles.cardTitle}>{props.title}</span>
        <span className={styles.cardSub}>{props.sub}</span>
      </span>
    </Link>
  );
}

/** The board's white knight (the same chess font as the pieces) in a green disc. */
function KnightLogo() {
  return (
    <span className={styles.logo} aria-hidden="true">
      <span className={styles.knight}>
        <PieceGlyph piece={{ type: "n", color: "w" }} />
      </span>
    </span>
  );
}
