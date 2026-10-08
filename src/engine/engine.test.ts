import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { jsChessEngineMove } from "./jsChessEngineMove";
import { randomMove } from "./randomMove";

const isLegal = (fen: string, uci: string) =>
  new Chess(fen).moves({ verbose: true }).some((m) => m.lan === uci);

/** Deterministic stand-in for Math.random. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

describe("Level 1 random picker", () => {
  it("always plays a legal move", () => {
    const rng = seeded(7);
    const c = new Chess();
    for (let i = 0; i < 60 && !c.isGameOver(); i++) {
      const uci = randomMove(c.fen(), rng);
      expect(isLegal(c.fen(), uci)).toBe(true);
      c.move(uci);
    }
  });

  it("sometimes takes a free piece, never only", () => {
    // Black queen on d5 is undefended and attacked by the e4 pawn.
    const fen = "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 40";
    const rng = seeded(11);
    const picks = Array.from({ length: 200 }, () => randomMove(fen, rng));
    const takes = picks.filter((m) => m === "e4d5").length;
    expect(takes).toBeGreaterThan(30);
    expect(takes).toBeLessThan(150);
  });

  it("does not count a defended piece as free", () => {
    // d5 queen is defended by the e6 pawn: taking it is not "free".
    const fen = "4k3/8/4p3/3q4/4P3/8/8/4K3 w - - 0 40";
    const rng = () => 0; // always tries the free-piece rule first
    expect(randomMove(fen, rng)).not.toBe("e4d5");
  });
});

describe("js-chess-engine adapter", () => {
  it.each([2, 3, 4] as const)("level %i returns a legal UCI move", (level) => {
    const fen = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
    expect(isLegal(fen, jsChessEngineMove(fen, level))).toBe(true);
  });

  // Level 2 (a 1-ply search) does not see mates; that is part of being easy.
  it.each([3, 4, 5] as const)("level %i plays mate in one", (level) => {
    expect(jsChessEngineMove("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 40", level)).toBe("d1d8");
  });

  it("plays the fastest mate even with randomness", () => {
    // Qg7# is mate now; other queen moves only mate later.
    for (let i = 0; i < 10; i++) {
      expect(jsChessEngineMove("7k/8/5KQ1/8/8/8/8/8 w - - 0 40", 3)).toBe("g6g7");
    }
  });

  it("adds the promotion piece to the UCI move", () => {
    const uci = jsChessEngineMove("8/P6k/8/8/8/8/8/K7 w - - 0 40", 4);
    expect(uci).toBe("a7a8q");
  });
});
