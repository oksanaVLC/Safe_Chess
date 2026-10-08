import { describe, expect, it } from "vitest";
import { ChessClock, DEFAULT_CLOCK_MS, formatClock, GameClock } from "./ChessClock";

/** A fake time source that the test moves forward by hand. */
function fakeTime() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("chess clock", () => {
  it("starts at 10 minutes for each side, not running", () => {
    const c = new ChessClock();
    expect(c.snapshot()).toEqual({ w: DEFAULT_CLOCK_MS, b: DEFAULT_CLOCK_MS });
    expect(c.running).toBeNull();
    expect(formatClock(c.remaining("w"))).toBe("10:00");
  });

  it("runs only the side whose turn it is", () => {
    const time = fakeTime();
    const c = new ChessClock(60_000, time.now);
    c.start("w");
    time.advance(5_000);
    expect(c.remaining("w")).toBe(55_000);
    expect(c.remaining("b")).toBe(60_000);

    c.start("b"); // White moved
    time.advance(3_000);
    expect(c.remaining("w")).toBe(55_000);
    expect(c.remaining("b")).toBe(57_000);
  });

  it("stops both clocks", () => {
    const time = fakeTime();
    const c = new ChessClock(60_000, time.now);
    c.start("w");
    time.advance(2_000);
    c.stop();
    time.advance(30_000);
    expect(c.snapshot()).toEqual({ w: 58_000, b: 60_000 });
    expect(c.running).toBeNull();
  });

  it("flags the side that runs out of time, never going below zero", () => {
    const time = fakeTime();
    const c = new ChessClock(10_000, time.now);
    c.start("b");
    time.advance(9_999);
    expect(c.flagged).toBeNull();
    time.advance(5_000);
    expect(c.remaining("b")).toBe(0);
    expect(c.flagged).toBe("b");
  });

  it("restores exact times and resumes the given side", () => {
    const time = fakeTime();
    const c = new ChessClock(60_000, time.now);
    c.start("w");
    time.advance(4_000);
    const saved = c.snapshot();
    c.start("b");
    time.advance(7_000);

    c.restore(saved, "w");
    expect(c.snapshot()).toEqual({ w: 56_000, b: 60_000 });
    expect(c.running).toBe("w");
    time.advance(1_000);
    expect(c.remaining("w")).toBe(55_000);
    expect(c.remaining("b")).toBe(60_000);
  });

  it("can restore without running (game over)", () => {
    const time = fakeTime();
    const c = new ChessClock(60_000, time.now);
    c.start("w");
    c.restore({ w: 1_234, b: 5_678 }, null);
    time.advance(10_000);
    expect(c.snapshot()).toEqual({ w: 1_234, b: 5_678 });
  });
});

describe("clock format", () => {
  it.each([
    [600_000, "10:00"],
    [599_001, "10:00"],
    [599_000, "09:59"],
    [522_000, "08:42"],
    [61_000, "01:01"],
    [1, "00:01"],
    [0, "00:00"],
    [-50, "00:00"],
  ])("%i ms → %s", (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });
});

describe("game clock with undo", () => {
  function setup() {
    const time = fakeTime();
    const g = new GameClock(60_000, time.now);
    g.begin("w");
    return { time, g, c: g.clock };
  }

  it("saves both clocks after every move", () => {
    const { time, g } = setup();
    time.advance(5_000);
    g.moved(1, "b"); // person's move after 5 s
    time.advance(2_000);
    g.moved(2, "w"); // robot's reply after 2 s
    expect(g.timesAt(0)).toEqual({ w: 60_000, b: 60_000 });
    expect(g.timesAt(1)).toEqual({ w: 55_000, b: 60_000 });
    expect(g.timesAt(2)).toEqual({ w: 55_000, b: 58_000 });
  });

  it("undo restores both clocks to their exact earlier values", () => {
    const { time, g, c } = setup();
    time.advance(5_000);
    g.moved(1, "b");
    time.advance(2_000);
    g.moved(2, "w");
    time.advance(8_000);
    g.moved(3, "b");
    time.advance(3_000);
    g.moved(4, "w");
    time.advance(4_000); // thinking about move 3

    g.undoTo(2, "w"); // takes back moves 3 and 4
    expect(c.snapshot()).toEqual({ w: 55_000, b: 58_000 });
    expect(c.running).toBe("w");
    time.advance(1_000);
    expect(c.snapshot()).toEqual({ w: 54_000, b: 58_000 });
  });

  it("undo while the robot is thinking restores the person's time", () => {
    const { time, g, c } = setup();
    time.advance(5_000);
    g.moved(1, "b");
    time.advance(2_000);
    g.moved(2, "w");
    time.advance(6_000);
    g.moved(3, "b"); // robot starts thinking
    time.advance(1_500);

    g.undoTo(2, "w");
    expect(c.snapshot()).toEqual({ w: 55_000, b: 58_000 });
  });

  it("undo back to the start gives 10:00-style full times", () => {
    const { time, g, c } = setup();
    time.advance(5_000);
    g.moved(1, "b");
    time.advance(2_000);
    g.moved(2, "w");
    g.undoTo(0, "w");
    expect(c.snapshot()).toEqual({ w: 60_000, b: 60_000 });
  });

  it("a move that ends the game stops both clocks", () => {
    const { time, g, c } = setup();
    time.advance(5_000);
    g.moved(1, null);
    time.advance(60_000);
    expect(c.running).toBeNull();
    expect(c.snapshot()).toEqual({ w: 55_000, b: 60_000 });
  });

  it("new game resets both clocks", () => {
    const { time, g, c } = setup();
    time.advance(5_000);
    g.moved(1, "b");
    time.advance(9_000);
    g.begin("w");
    expect(c.snapshot()).toEqual({ w: 60_000, b: 60_000 });
    expect(c.running).toBe("w");
    expect(g.timesAt(1)).toBeUndefined();
  });

  it("undo after a loss on time restarts the clocks from the saved values", () => {
    const { time, g, c } = setup();
    time.advance(5_000);
    g.moved(1, "b");
    time.advance(2_000);
    g.moved(2, "w");
    time.advance(70_000); // the person's time runs out
    expect(c.flagged).toBe("w");
    c.stop();

    g.undoTo(0, "w");
    expect(c.flagged).toBeNull();
    expect(c.snapshot()).toEqual({ w: 60_000, b: 60_000 });
  });
});
