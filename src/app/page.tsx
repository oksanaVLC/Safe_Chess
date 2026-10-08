import Link from "next/link";
import styles from "./page.module.css";

// Temporary start page until the Home screen is built.
export default function Page() {
  return (
    <main className={styles.screen}>
      <h1 className={styles.title}>Safe Chess</h1>
      <Link href="/robot" className={styles.button}>
        Play with a robot
      </Link>
    </main>
  );
}
