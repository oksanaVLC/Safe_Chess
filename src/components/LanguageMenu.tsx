"use client";

import { useEffect, useRef, useState } from "react";
import { setLanguage, useLanguage } from "@/i18n/language";
import { LANGUAGE_NAMES, LANGUAGES } from "@/i18n/strings";
import { CheckIcon, GlobeIcon } from "./icons";
import styles from "./LanguageMenu.module.css";

/** Globe button showing the language code; opens English / Español / Русский. */
export function LanguageMenu() {
  const { language, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  // Close on a tap outside the menu or on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={styles.root}>
      <button
        ref={toggle}
        type="button"
        className={styles.globe}
        aria-label={`${t.language}: ${LANGUAGE_NAMES[language]}`}
        aria-expanded={open}
        aria-controls="language-menu"
        onClick={() => setOpen(!open)}
      >
        <GlobeIcon />
        {language.toUpperCase()}
      </button>
      {open && (
        <div id="language-menu" className={styles.menu} role="group" aria-label={t.language}>
          {LANGUAGES.map((l) => (
            <button
              key={l}
              type="button"
              lang={l}
              className={`${styles.option} ${l === language ? styles.selected : ""}`}
              aria-pressed={l === language}
              autoFocus={l === language}
              onClick={() => {
                setLanguage(l);
                setOpen(false);
                toggle.current?.focus();
              }}
            >
              {LANGUAGE_NAMES[l]}
              {l === language && <CheckIcon />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
