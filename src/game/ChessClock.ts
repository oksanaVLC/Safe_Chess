import type { Color } from "chess.js";

/** Default thinking time for each side (brief §2: 10 minutes each). */
export const DEFAULT_CLOCK_MS = 10 * 60 * 1000;

export interface ClockTimes {
  w: number;
  b: number;
}

/**
 * A two-sided chess clock. Only one side runs at a time; time is measured
 * from a monotonic time source, so it stays correct even if the screen
 * updates late (e.g. a phone that is busy or briefly in the background).
 */
export class ChessClock {
  private times: ClockTimes;
  private runningSide: Color | null = null;
  private since = 0;

  constructor(
    initialMs: number = DEFAULT_CLOCK_MS,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.times = { w: initialMs, b: initialMs };
  }

  get running(): Color | null {
    return this.runningSide;
  }

  /** Time left for a side right now, never below zero. */
  remaining(side: Color): number {
    const t = this.times[side];
    if (side !== this.runningSide) return t;
    return Math.max(0, t - (this.now() - this.since));
  }

  /** The side whose time has run out, if any. */
  get flagged(): Color | null {
    if (this.remaining("w") <= 0) return "w";
    if (this.remaining("b") <= 0) return "b";
    return null;
  }

  /** Both times right now (for Undo snapshots). */
  snapshot(): ClockTimes {
    return { w: this.remaining("w"), b: this.remaining("b") };
  }

  /** Runs `side`'s clock; the other side's clock stops. */
  start(side: Color): void {
    this.settle();
    this.runningSide = side;
    this.since = this.now();
  }

  /** Stops both clocks (game over). */
  stop(): void {
    this.settle();
    this.runningSide = null;
  }

  /** Sets both times exactly (Undo, New) and runs `side`, or none. */
  restore(times: ClockTimes, side: Color | null): void {
    this.times = { ...times };
    this.runningSide = null;
    if (side) this.start(side);
  }

  /** Books the running side's elapsed time. */
  private settle(): void {
    if (!this.runningSide) return;
    this.times[this.runningSide] = this.remaining(this.runningSide);
    this.since = this.now();
  }
}

/**
 * The clock of one game plus the clock times at every position, so Undo can
 * put both clocks back to exactly what they showed at that point.
 */
export class GameClock {
  readonly clock: ChessClock;
  /** times[ply] = both clocks when the position after `ply` half-moves was reached. */
  private times: ClockTimes[];

  constructor(
    private readonly initialMs: number = DEFAULT_CLOCK_MS,
    now?: () => number,
  ) {
    this.clock = new ChessClock(initialMs, now);
    this.times = [{ w: initialMs, b: initialMs }];
  }

  /** New game: both clocks back to the start, `turn` running. */
  begin(turn: Color): void {
    this.times = [{ w: this.initialMs, b: this.initialMs }];
    this.clock.restore(this.times[0], turn);
  }

  /**
   * A move reached position `ply`. Stops the mover's clock and runs the
   * next side's, or stops both if the game is over (`nextTurn` null).
   */
  moved(ply: number, nextTurn: Color | null): void {
    if (nextTurn) this.clock.start(nextTurn);
    else this.clock.stop();
    this.times = this.times.slice(0, ply);
    this.times[ply] = this.clock.snapshot();
  }

  /** Undo back to position `ply`: restores both clocks exactly. */
  undoTo(ply: number, turn: Color | null): void {
    const saved = this.times[Math.min(ply, this.times.length - 1)];
    this.times = this.times.slice(0, ply + 1);
    this.clock.restore(saved, turn);
  }

  /** Clock times saved for position `ply`. */
  timesAt(ply: number): ClockTimes | undefined {
    return this.times[ply];
  }
}

/** "mm:ss", rounding up so a clock shows 00:00 only when time is really up. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
