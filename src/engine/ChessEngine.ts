export type Level = 1 | 2 | 3 | 4 | 5;

export const LEVELS: Level[] = [1, 2, 3, 4, 5];

/**
 * Answers "what move should the robot play?". chess.js owns the rules and
 * the game state; an engine only suggests a move. Replaceable without
 * touching the UI or the game logic.
 */
export interface ChessEngine {
  /** Move in UCI, e.g. "e2e4" or "e7e8q". */
  getBestMove(fen: string, level: Level): Promise<string>;
}
