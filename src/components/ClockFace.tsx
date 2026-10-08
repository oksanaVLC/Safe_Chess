import { formatClock } from "@/game/ChessClock";
import styles from "./ClockFace.module.css";

interface ClockFaceProps {
  ms: number;
  running: boolean;
  label: string;
}

/** One clock: "mm:ss", green while running, gray while waiting. */
export function ClockFace({ ms, running, label }: ClockFaceProps) {
  return (
    <span role="timer" aria-label={label} className={`${styles.clock} ${running ? styles.running : ""}`}>
      {formatClock(ms)}
    </span>
  );
}
