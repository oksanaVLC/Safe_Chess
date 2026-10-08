"use client";

import { useSyncExternalStore } from "react";
import { LANGUAGES, STRINGS, type Language, type Strings } from "./strings";

const STORAGE_KEY = "safe-chess.language";

/**
 * First launch: the phone's language if it is Spanish or Russian, else
 * English. After a choice in the globe menu, that choice.
 */
export function initialLanguage(stored: string | null, deviceLanguage: string | undefined): Language {
  if (stored && (LANGUAGES as string[]).includes(stored)) return stored as Language;
  const primary = deviceLanguage?.toLowerCase().split("-")[0];
  return primary === "es" || primary === "ru" ? primary : "en";
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked: fall back to the phone's language
  }
}

let current: Language | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): Language {
  current ??= initialLanguage(readStored(), navigator.language);
  return current;
}

/** The static HTML is built in English; the client switches after loading. */
function getServerSnapshot(): Language {
  return "en";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes the language of the whole app and remembers it on this phone. */
export function setLanguage(language: Language): void {
  current = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not remembered, but still used for this visit.
  }
  listeners.forEach((l) => l());
}

export function useLanguage(): { language: Language; t: Strings } {
  const language = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { language, t: STRINGS[language] };
}
