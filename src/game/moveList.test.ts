import { Chess, DEFAULT_POSITION } from "chess.js";
import { describe, expect, it } from "vitest";
import { positionSquares } from "./GameController";
import { moveNumberOf, positionAt, toEntries, toRows } from "./moveList";

function play(...sans: string[]) {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return toEntries(c.history({ verbose: true }));
}

describe("move list", () => {
  it("lists each move with its piece and destination", () => {
    const e = play("e4", "e5", "Nf3");
    expect(e.map((m) => [m.ply, m.color, m.piece, m.to])).toEqual([
      [1, "w", "p", "e4"],
      [2, "b", "p", "e5"],
      [3, "w", "n", "f3"],
    ]);
  });

  it("groups moves into numbered rows", () => {
    const rows = toRows(play("e4", "e5", "Nf3"));
    expect(rows).toHaveLength(2);
    expect(rows[0].number).toBe(1);
    expect(rows[0].white?.to).toBe("e4");
    expect(rows[0].black?.to).toBe("e5");
    expect(rows[1].number).toBe(2);
    expect(rows[1].white?.to).toBe("f3");
    expect(rows[1].black).toBeUndefined();
  });

  it("marks castling on both sides", () => {
    const e = play("e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "O-O", "d6", "d3", "Bg4", "Nc3", "Qd7", "Be3", "O-O-O");
    const castles = e.filter((m) => m.castles).map((m) => [m.color, m.piece, m.to]);
    expect(castles).toEqual([
      ["w", "k", "g1"],
      ["b", "k", "c8"],
    ]);
  });

  it("records the promoted piece", () => {
    const c = new Chess("1n5k/P7/8/8/8/8/8/K7 w - - 0 1");
    c.move({ from: "a7", to: "b8", promotion: "n" });
    const [m] = toEntries(c.history({ verbose: true }));
    expect(m).toMatchObject({ piece: "p", to: "b8", promotion: "n" });
  });

  it("numbers moves in full moves", () => {
    expect([0, 1, 2, 3, 4, 5].map(moveNumberOf)).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe("position at a move", () => {
  const sans = ["e4", "e5", "Nf3", "Nc6", "Bb5"];
  const entries = play(...sans);

  it("is the start position before any move", () => {
    expect(positionAt(entries, 0)).toEqual({ fen: DEFAULT_POSITION, lastMove: null });
  });

  it("matches replaying the game up to every move", () => {
    for (let ply = 1; ply <= sans.length; ply++) {
      const c = new Chess();
      for (const s of sans.slice(0, ply)) c.move(s);
      expect(positionAt(entries, ply).fen).toBe(c.fen());
    }
  });

  it("tints the move that led to the position", () => {
    expect(positionAt(entries, 3).lastMove).toEqual({ from: "g1", to: "f3" });
    expect(positionAt(entries, 4).lastMove).toEqual({ from: "b8", to: "c6" });
  });

  it("shows the position's pieces on the mini board", () => {
    const { fen, lastMove } = positionAt(entries, 3);
    const view = new Map(positionSquares(fen, lastMove).map((s) => [s.square, s]));
    expect(view.get("f3")!.piece).toEqual({ type: "n", color: "w" });
    expect(view.get("g1")!.piece).toBeNull();
    expect(view.get("c6")!.piece).toBeNull(); // Black has not played Nc6 yet
    expect(view.get("f3")!.lastMove).toBe(true);
    expect(view.get("g1")!.lastMove).toBe(true);
    expect(view.get("e4")!.lastMove).toBe(false);
  });

  it("works for an empty game", () => {
    expect(toRows([])).toEqual([]);
    expect(positionAt([], 0).fen).toBe(DEFAULT_POSITION);
  });
});
