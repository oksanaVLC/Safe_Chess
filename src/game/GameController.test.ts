import { describe, expect, it } from "vitest";
import { GameController, isDarkSquare, SQUARES } from "./GameController";

describe("board layout", () => {
  it("lists squares from a8 to h1", () => {
    expect(SQUARES[0]).toBe("a8");
    expect(SQUARES[7]).toBe("h8");
    expect(SQUARES[63]).toBe("h1");
  });

  it("has a dark a1 and a light h1", () => {
    expect(isDarkSquare("a1")).toBe(true);
    expect(isDarkSquare("h1")).toBe(false);
    expect(isDarkSquare("h8")).toBe(true);
  });
});

describe("tap to move", () => {
  it("selects own piece and shows its legal moves", () => {
    const g = new GameController();
    expect(g.tap("e2")).toBe(true);
    expect(g.selectedSquare).toBe("e2");
    expect(g.targets().map((t) => t.to).sort()).toEqual(["e3", "e4"]);
  });

  it("ignores the opponent's pieces and empty squares when nothing is selected", () => {
    const g = new GameController();
    expect(g.tap("e7")).toBe(false);
    expect(g.tap("e4")).toBe(false);
    expect(g.selectedSquare).toBeNull();
  });

  it("deselects when the same piece is tapped again", () => {
    const g = new GameController();
    g.tap("g1");
    g.tap("g1");
    expect(g.selectedSquare).toBeNull();
  });

  it("switches selection to another own piece", () => {
    const g = new GameController();
    g.tap("e2");
    g.tap("d2");
    expect(g.selectedSquare).toBe("d2");
  });

  it("clears selection when tapping a non-target square", () => {
    const g = new GameController();
    g.tap("e2");
    g.tap("e5");
    expect(g.selectedSquare).toBeNull();
    expect(g.pieceAt("e2")).not.toBeNull();
  });

  it("plays a move and records the last move", () => {
    const g = new GameController();
    g.tap("e2");
    g.tap("e4");
    expect(g.pieceAt("e4")).toEqual({ type: "p", color: "w" });
    expect(g.lastMove).toEqual({ from: "e2", to: "e4" });
    expect(g.selectedSquare).toBeNull();
    expect(g.status).toEqual({ kind: "playing", turn: "b", check: false });
  });

  it("marks last-move squares in the board view", () => {
    const g = new GameController();
    g.move("g1", "f3");
    const marked = g.board().filter((s) => s.lastMove).map((s) => s.square);
    expect(marked.sort()).toEqual(["f3", "g1"]);
  });
});

describe("move markers", () => {
  it("marks captures as rings and empty targets as dots", () => {
    // White knight on f3 can take a pawn on e5.
    const g = new GameController("rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2");
    g.tap("f3");
    const view = new Map(g.board().map((s) => [s.square, s]));
    expect(view.get("e5")!.target).toBe("capture");
    expect(view.get("d4")!.target).toBe("move");
    expect(view.get("f3")!.selected).toBe(true);
  });

  it("marks en passant as a capture", () => {
    const g = new GameController("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3");
    g.tap("e5");
    expect(g.targets()).toContainEqual({ to: "f6", capture: true });
  });
});

describe("special moves", () => {
  it("castles when the king is tapped onto g1", () => {
    const g = new GameController("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    g.tap("e1");
    g.tap("g1");
    expect(g.pieceAt("g1")).toEqual({ type: "k", color: "w" });
    expect(g.pieceAt("f1")).toEqual({ type: "r", color: "w" });
  });


  it("does not allow moves that leave the king in check", () => {
    // White king e1, white bishop e2 pinned by a black rook on e8.
    const g = new GameController("4r2k/8/8/8/8/8/4B3/4K3 w - - 0 1");
    g.tap("e2");
    expect(g.targets()).toEqual([]);
  });
});

describe("game status", () => {
  it("reports check", () => {
    const g = new GameController("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
    g.move("h1", "h8");
    expect(g.status).toEqual({ kind: "playing", turn: "b", check: true });
  });

  it("reports checkmate and blocks further taps", () => {
    const g = new GameController();
    for (const [from, to] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]] as const) {
      g.move(from, to);
    }
    expect(g.status).toEqual({ kind: "checkmate", winner: "b" });
    expect(g.tap("e2")).toBe(false);
  });

  it("reports stalemate as a draw", () => {
    const g = new GameController("7k/8/6Q1/8/8/8/8/K7 w - - 0 1");
    g.move("g6", "f7");
    expect(g.status).toEqual({ kind: "draw", reason: "stalemate" });
  });
});

describe("promotion", () => {
  const PROMO = "1n5k/P7/8/8/8/8/8/K7 w - - 0 1"; // white pawn a7, black knight b8

  it("shows a promotion square once among the targets", () => {
    const g = new GameController(PROMO);
    g.tap("a7");
    expect(g.targets()).toEqual([
      { to: "a8", capture: false },
      { to: "b8", capture: true },
    ]);
  });

  it("waits for a choice instead of auto-promoting", () => {
    const g = new GameController(PROMO);
    g.tap("a7");
    expect(g.tap("a8")).toBe(true);
    expect(g.pendingPromotion).toEqual({ from: "a7", to: "a8", color: "w" });
    expect(g.pieceAt("a7")).toEqual({ type: "p", color: "w" });
    expect(g.pieceAt("a8")).toBeNull();
  });

  it.each(["q", "r", "b", "n"] as const)("promotes to the chosen piece (%s)", (piece) => {
    const g = new GameController(PROMO);
    g.tap("a7");
    g.tap("a8");
    expect(g.promote(piece)).toBe(true);
    expect(g.pieceAt("a8")).toEqual({ type: piece, color: "w" });
    expect(g.pendingPromotion).toBeNull();
    expect(g.lastMove).toEqual({ from: "a7", to: "a8" });
    expect(g.status).toMatchObject({ kind: "playing", turn: "b" });
  });

  it("promotes with a capture", () => {
    const g = new GameController(PROMO);
    g.tap("a7");
    g.tap("b8");
    g.promote("n");
    expect(g.pieceAt("b8")).toEqual({ type: "n", color: "w" });
  });

  it("promotes a black pawn", () => {
    const g = new GameController("7k/8/8/8/8/8/p7/7K b - - 0 1");
    g.tap("a2");
    g.tap("a1");
    expect(g.pendingPromotion?.color).toBe("b");
    g.promote("r");
    expect(g.pieceAt("a1")).toEqual({ type: "r", color: "b" });
  });

  it("ignores board taps while the choice is pending", () => {
    const g = new GameController(PROMO);
    g.tap("a7");
    g.tap("a8");
    expect(g.tap("a1")).toBe(false);
    expect(g.pendingPromotion).not.toBeNull();
  });

  it("can be cancelled, keeping the pawn selected", () => {
    const g = new GameController(PROMO);
    g.tap("a7");
    g.tap("a8");
    expect(g.cancelPromotion()).toBe(true);
    expect(g.pendingPromotion).toBeNull();
    expect(g.selectedSquare).toBe("a7");
    expect(g.pieceAt("a7")).toEqual({ type: "p", color: "w" });
  });

  it("rejects a promotion move without a chosen piece", () => {
    const g = new GameController(PROMO);
    expect(g.move("a7", "a8")).toBe(false);
    expect(g.pieceAt("a7")).toEqual({ type: "p", color: "w" });
  });

  it("does nothing when no promotion is pending", () => {
    const g = new GameController();
    expect(g.promote("q")).toBe(false);
    expect(g.cancelPromotion()).toBe(false);
  });
});
