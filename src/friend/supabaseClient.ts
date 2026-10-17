"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sharedSession, type SessionResult } from "./anonymousSession";
import type { Rpc } from "./friendApi";
import { checkPublicConfig } from "./publicConfig";

// The browser's Supabase client for Play with a friend. It only ever holds
// the publishable key and the player's own anonymous session; every write
// goes through the database functions and the friend-move Edge Function.
// Nothing here runs until a friend-mode action asks for it, so the robot
// modes never contact Supabase.

// Written out in full so Next.js inlines them into the static build.
const config = checkPublicConfig(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

/** Whether this build can play with a friend at all. */
export const friendModeConfigured = config.status === "ok";

let client: SupabaseClient | null = null;
let session: (() => Promise<SessionResult>) | null = null;

/** The shared client, or null when this build has no (valid) Supabase settings. */
export function getSupabase(): SupabaseClient | null {
  if (config.status !== "ok") return null;
  client ??= createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

/** The player's anonymous session (shared by every caller on this page). */
export function friendSession(supabase: SupabaseClient): Promise<SessionResult> {
  session ??= sharedSession(supabase.auth);
  return session();
}

/** supabase.rpc as the plain function friendApi expects. */
export function rpcOf(supabase: SupabaseClient): Rpc {
  return (fn, args) => supabase.rpc(fn, args);
}
