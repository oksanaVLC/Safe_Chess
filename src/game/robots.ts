import type { Level } from "@/engine/ChessEngine";

// English only for now; Spanish and Russian come with the language step.
export const ROBOTS: Record<Level, { name: string; tagline: string }> = {
  1: { name: "Snoozy", tagline: "Just woke up" },
  2: { name: "Bloop", tagline: "Learning the moves" },
  3: { name: "Gizmo", tagline: "Thinks a little" },
  4: { name: "Sparks", tagline: "Quick and sneaky" },
  5: { name: "Titan", tagline: "The champion" },
};

/** The robot levels that played in a game, in order of their first move. */
export function opponentsOf(robotLevels: readonly (Level | undefined)[]): Level[] {
  return [...new Set(robotLevels.filter((l): l is Level => l !== undefined))];
}

/** Subtitle of the Game moves screen, e.g. "You vs Gizmo · Level 3". */
export function gameSubtitle(opponents: readonly Level[]): string {
  const names = opponents.map((l) => ROBOTS[l].name).join(", ");
  const levels = opponents.join(", ");
  return opponents.length === 1
    ? `You vs ${names} · Level ${levels}`
    : `You vs ${names} · Levels ${levels}`;
}
