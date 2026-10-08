import type { ChessEngine, Level } from "./ChessEngine";
import { JsChessEngine } from "./JsChessEngine";
import { randomMove } from "./randomMove";

/**
 * The robot opponent: Level 1 is a tiny random-move picker, Levels 2–5 ask
 * the engine. Swapping the engine means changing only this file.
 */
export class Robot implements ChessEngine {
  private engine = new JsChessEngine();

  getBestMove(fen: string, level: Level): Promise<string> {
    if (level === 1) return Promise.resolve(randomMove(fen));
    return this.engine.getBestMove(fen, level);
  }

  stop(): void {
    this.engine.stop();
  }
}
