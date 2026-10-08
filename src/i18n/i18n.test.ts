import { describe, expect, it } from "vitest";
import { initialLanguage } from "./language";
import { LANGUAGES, STRINGS } from "./strings";

describe("first-launch language", () => {
  it("uses the phone's language when it is Spanish or Russian", () => {
    expect(initialLanguage(null, "es-ES")).toBe("es");
    expect(initialLanguage(null, "es-419")).toBe("es");
    expect(initialLanguage(null, "ru-RU")).toBe("ru");
    expect(initialLanguage(null, "ru")).toBe("ru");
  });

  it("uses English for any other phone language", () => {
    expect(initialLanguage(null, "en-GB")).toBe("en");
    expect(initialLanguage(null, "ca-ES")).toBe("en");
    expect(initialLanguage(null, "uk-UA")).toBe("en");
    expect(initialLanguage(null, undefined)).toBe("en");
  });

  it("prefers the remembered choice", () => {
    expect(initialLanguage("ru", "es-ES")).toBe("ru");
    expect(initialLanguage("en", "ru-RU")).toBe("en");
  });

  it("ignores an unknown remembered value", () => {
    expect(initialLanguage("fr", "es-ES")).toBe("es");
  });
});

describe("dictionaries", () => {
  it("have every text filled in, in every language", () => {
    const keys = Object.keys(STRINGS.en).sort();
    for (const lang of LANGUAGES) {
      expect(Object.keys(STRINGS[lang]).sort()).toEqual(keys);
      for (const [key, value] of Object.entries(STRINGS[lang])) {
        if (typeof value === "string") expect(value.trim(), `${lang}.${key}`).not.toBe("");
      }
    }
  });

  it("use the brief's texts", () => {
    expect(STRINGS.es.turnHint).toBe("Tu turno — toca una pieza");
    expect(STRINGS.ru.undo).toBe("Отменить");
    expect(STRINGS.ru.robots[1].name).toBe("Соня");
    expect(STRINGS.es.robots[4].tagline).toBe("Rápido y astuto");
  });
});
