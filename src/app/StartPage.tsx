"use client";

import Link from "next/link";
import { LanguageMenu } from "@/components/LanguageMenu";
import { useLanguage } from "@/i18n/language";
import styles from "./page.module.css";

// Temporary start page until the Home screen is built. The globe button
// sits where it will be on Home (top right).
export function StartPage() {
  const { t } = useLanguage();

  return (
    <main className={styles.screen}>
      <title>Safe Chess</title>
      <LanguageMenu />
      <h1 className={styles.title}>Safe Chess</h1>
      <Link href="/robot" className={styles.button}>
        {t.robot}
      </Link>
      <Link href="/friend" className={`${styles.button} ${styles.buttonFriend}`}>
        {t.friend}
      </Link>
    </main>
  );
}
