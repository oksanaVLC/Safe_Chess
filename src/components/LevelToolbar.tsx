"use client";

import { LEVELS, type Level } from "@/engine/ChessEngine";
import { useLanguage } from "@/i18n/language";
import { RobotIcon } from "./icons";
import styles from "./LevelToolbar.module.css";

interface LevelToolbarProps {
  level: Level;
  onChange: (level: Level) => void;
}

export function LevelToolbar({ level, onChange }: LevelToolbarProps) {
  const { t } = useLanguage();
  const robot = t.robots[level];
  return (
    <section className={styles.card} aria-label={t.robotLevel}>
      <div className={styles.row}>
        {LEVELS.map((n) => (
          <button
            key={n}
            type="button"
            className={`${styles.level} ${n === level ? styles.on : ""}`}
            aria-pressed={n === level}
            aria-label={`${t.level} ${n}, ${t.robots[n].name}`}
            onClick={() => onChange(n)}
          >
            <RobotIcon />
            <span className={styles.number}>{n}</span>
          </button>
        ))}
      </div>
      <div className={styles.info}>
        <div className={styles.names}>
          <span className={styles.name}>{robot.name}</span>
          <span className={styles.tagline}>{robot.tagline}</span>
        </div>
        <div className={styles.meter} role="img" aria-label={`${t.level} ${level} ${t.of} 5`}>
          {LEVELS.map((n) => (
            <span key={n} className={`${styles.dot} ${n <= level ? styles.filled : ""}`} />
          ))}
        </div>
      </div>
    </section>
  );
}
