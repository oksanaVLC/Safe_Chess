"use client";

import { useEffect } from "react";
import { useLanguage } from "./language";

/** Keeps <html lang> in step with the chosen language (for screen readers). */
export function HtmlLang() {
  const { language } = useLanguage();
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return null;
}
