import type { Level } from "@/engine/ChessEngine";
import type { Strings } from "@/i18n/strings";

/** The robot levels that played in a game, in order of their first move. */
export function opponentsOf(robotLevels: readonly (Level | undefined)[]): Level[] {
  return [...new Set(robotLevels.filter((l): l is Level => l !== undefined))];
}

/** Subtitle of the Game moves screen, e.g. "You vs Gizmo · Level 3". */
export function gameSubtitle(t: Strings, opponents: readonly Level[]): string {
  const names = opponents.map((l) => t.robots[l].vsName).join(", ");
  const levelWord = opponents.length === 1 ? t.level : t.levels;
  return `${t.vs} ${names} · ${levelWord} ${opponents.join(", ")}`;
}
