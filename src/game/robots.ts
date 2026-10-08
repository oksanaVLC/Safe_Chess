import type { Level } from "@/engine/ChessEngine";

// English only for now; Spanish and Russian come with the language step.
export const ROBOTS: Record<Level, { name: string; tagline: string }> = {
  1: { name: "Snoozy", tagline: "Just woke up" },
  2: { name: "Bloop", tagline: "Learning the moves" },
  3: { name: "Gizmo", tagline: "Thinks a little" },
  4: { name: "Sparks", tagline: "Quick and sneaky" },
  5: { name: "Titan", tagline: "The champion" },
};
