"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkPublicConfig } from "./publicConfig";

// The browser's Supabase client for Play with a friend. It only ever holds
// the publishable key and the player's own anonymous session; every write
// goes through the database functions and the friend-move Edge Function.
// Nothing here runs until a friend-mode action asks for it, so the robot
// modes never load or contact Supabase.

// Written out in full so Next.js inlines them into the static build.
const config = checkPublicConfig(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

let client: SupabaseClient | null = null;

/** The shared client, or null when this build has no (valid) Supabase settings. */
export function getSupabase(): SupabaseClient | null {
  if (config.status !== "ok") return null;
  client ??= createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}
