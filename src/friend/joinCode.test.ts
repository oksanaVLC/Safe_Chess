import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isJoinCode, isJoinCodeStart, JOIN_CODE_LENGTH, normalizeJoinCode } from "./joinCode";

describe("join codes", () => {
  it("reads a code the way join_friend_game does", () => {
    expect(normalizeJoinCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeJoinCode(" ab cd\tef gh ")).toBe("ABCDEFGH");
    expect(normalizeJoinCode("")).toBe("");
  });

  it("accepts exactly 8 characters of the alphabet", () => {
    expect(isJoinCode("ABCDEFGH")).toBe(true);
    expect(isJoinCode("23456789")).toBe(true);
    expect(isJoinCode("ABCDEFG")).toBe(false);
    expect(isJoinCode("ABCDEFGHJ")).toBe(false);
    // look-alikes are never in a code
    for (const c of ["0", "1", "I", "L", "O", "U"]) expect(isJoinCode(`ABCDEFG${c}`), c).toBe(false);
  });

  it("tells a code still being typed from one that can never work", () => {
    expect(isJoinCodeStart("")).toBe(true);
    expect(isJoinCodeStart("ABC")).toBe(true);
    expect(isJoinCodeStart("ABCDEFGH")).toBe(true);
    expect(isJoinCodeStart("ABCDEFGHJ")).toBe(false);
    expect(isJoinCodeStart("AB0")).toBe(false);
    expect(isJoinCodeStart("ab")).toBe(false); // not normalised
  });

  it("uses the same alphabet and length as the database", () => {
    const sql = readFileSync("supabase/migrations/20261009120000_friend_mode.sql", "utf8");
    expect(sql).toContain("'^[2-9A-HJKMNP-TV-Z]{8}$'");
    expect(JOIN_CODE_LENGTH).toBe(8);
    const serverAlphabet = [..."23456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"].filter((c) => /[2-9A-HJKMNP-TV-Z]/.test(c));
    for (const c of serverAlphabet) expect(isJoinCode(c.repeat(8)), c).toBe(true);
    for (const c of "01ILOU") expect(isJoinCode(c.repeat(8)), c).toBe(false);
  });
});
