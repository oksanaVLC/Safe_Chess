import { describe, expect, it } from "vitest";
import { STRINGS } from "@/i18n/strings";
import { gameSubtitle, opponentsOf } from "./robots";

describe("game opponents", () => {
  it("lists each robot once, in the order it first played", () => {
    // Index = half-move; undefined = the person's move.
    expect(opponentsOf([undefined, 3, undefined, 3])).toEqual([3]);
    expect(opponentsOf([undefined, 1, undefined, 5, undefined, 1])).toEqual([1, 5]);
    expect(opponentsOf([undefined])).toEqual([]);
  });

  it("describes one opponent", () => {
    expect(gameSubtitle(STRINGS.en, [3])).toBe("You vs Gizmo · Level 3");
    expect(gameSubtitle(STRINGS.es, [1])).toBe("Tú contra Dormilón · Nivel 1");
    expect(gameSubtitle(STRINGS.ru, [1])).toBe("Ты против Сони · Уровень 1");
  });

  it("describes a game where the level was changed", () => {
    expect(gameSubtitle(STRINGS.en, [1, 5])).toBe("You vs Snoozy, Titan · Levels 1, 5");
    expect(gameSubtitle(STRINGS.es, [1, 5])).toBe("Tú contra Dormilón, Titán · Niveles 1, 5");
    expect(gameSubtitle(STRINGS.ru, [1, 5])).toBe("Ты против Сони, Титана · Уровни 1, 5");
  });
});
