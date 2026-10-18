import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Board } from "@/components/Board";
import { GameMoves } from "@/components/GameMoves";
import { positionSquares } from "@/game/GameController";
import { orientSquares } from "./friendGame";

// The board as HTML: the order of the square buttons and where the edge
// coordinates are, for White at the bottom and for Black at the bottom.
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function render(orientation: "w" | "b") {
  const squares = orientSquares(positionSquares(START, null), orientation);
  const html = renderToStaticMarkup(createElement(Board, { squares, onTap: () => {}, orientation }));
  const labels = [...html.matchAll(/aria-label="([a-h][1-8])[^"]*"/g)].map((m) => m[1]);
  // each button's coordinate spans, in order
  const coords = [...html.matchAll(/<button[^>]*aria-label="([a-h][1-8])[^"]*"[^>]*>(.*?)<\/button>/g)].map((m) => ({
    square: m[1],
    marks: [...m[2].matchAll(/aria-hidden="true">([a-h1-8])<\/span>/g)].map((x) => x[1]),
  }));
  return { labels, coords };
}

/** The coordinate letters/digits of the Game moves mini board, in display order. */
function miniCoords(orientation?: "w" | "b") {
  const html = renderToStaticMarkup(createElement(GameMoves, { history: [], subtitle: "x", onBack: () => {}, orientation }));
  const start = html.indexOf('role="img"');
  const grid = html.slice(start, html.indexOf("</div></div>", start));
  return [...grid.matchAll(/aria-hidden="true">([a-h1-8])<\/span>/g)].map((m) => m[1]);
}

describe("Game moves mini board", () => {
  it("keeps White at the bottom by default (robot games)", () => {
    const c = miniCoords();
    expect(c[0]).toBe("8");
    expect(c.at(-1)).toBe("h");
  });

  it("turns for Black: rank 1 at the top, files h to a along the bottom", () => {
    const c = miniCoords("b");
    expect(c[0]).toBe("1");
    expect(c.slice(-8)).toEqual(["h", "g", "f", "e", "d", "c", "b", "a"]);
  });
});

describe("board orientation", () => {
  it("White at the bottom: a8 first, h1 last, ranks on the a-file, files on rank 1", () => {
    const { labels, coords } = render("w");
    expect(labels[0]).toBe("a8");
    expect(labels.at(-1)).toBe("h1");
    expect(coords.find((c) => c.square === "a8")?.marks).toEqual(["8"]);
    expect(coords.find((c) => c.square === "a1")?.marks).toEqual(["1", "a"]);
    expect(coords.find((c) => c.square === "h1")?.marks).toEqual(["h"]);
  });

  it("Black at the bottom: h1 first, a8 last, ranks on the h-file, files on rank 8", () => {
    const { labels, coords } = render("b");
    expect(labels[0]).toBe("h1");
    expect(labels.at(-1)).toBe("a8");
    expect(coords.find((c) => c.square === "h1")?.marks).toEqual(["1"]);
    expect(coords.find((c) => c.square === "h8")?.marks).toEqual(["8", "h"]);
    expect(coords.find((c) => c.square === "a8")?.marks).toEqual(["a"]);
    expect(coords.find((c) => c.square === "a1")?.marks).toEqual([]);
  });
});
