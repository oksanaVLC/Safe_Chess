"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that keeps the app available offline.
 * Only in the production build (the file is generated after `next build`).
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Not available (e.g. private mode): the app still works online.
    });
  }, []);
  return null;
}
