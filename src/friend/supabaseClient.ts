"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sharedSession, type SessionResult } from "./anonymousSession";
import type { Rpc } from "./friendApi";
import { classifyMoveResponse, parseGameRow, type MoveResult } from "./friendGame";
import type { FetchResult } from "./gameSync";
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

/** Reads one game. RLS returns it only to its two players; anyone else gets "gone". */
export async function readGame(supabase: SupabaseClient, gameId: string): Promise<FetchResult> {
  try {
    const { data, error } = await supabase.from("games").select("*").eq("id", gameId);
    if (error || !Array.isArray(data)) return { kind: "error" };
    if (data.length === 0) return { kind: "gone" };
    const game = parseGameRow(data[0]);
    return game ? { kind: "ok", game } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

/**
 * One move through the friend-move Edge Function, exactly as its contract
 * says: POST {gameId, expectedVersion, uci} with the player's own token.
 * The server decides everything else. Sent once; never retried here.
 */
export async function sendMove(
  supabase: SupabaseClient,
  move: { gameId: string; expectedVersion: number; uci: string },
): Promise<MoveResult> {
  if (config.status !== "ok") return { kind: "error" };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { kind: "denied" };
    const res = await fetch(`${config.url}/functions/v1/friend-move`, {
      method: "POST",
      headers: { apikey: config.publishableKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ gameId: move.gameId, expectedVersion: move.expectedVersion, uci: move.uci }),
    });
    const body: unknown = await res.json().catch(() => null);
    return classifyMoveResponse(res.status, body);
  } catch {
    return { kind: "error" };
  }
}

/**
 * Joins the private channel game:<id>. Only the two players may receive
 * on it (policy game_channel_receive); its events carry no game data.
 */
export function subscribeToGame(
  supabase: SupabaseClient,
  gameId: string,
  onEvent: (payload: unknown) => void,
  onStatus: (status: string) => void,
): () => void {
  const channel = supabase.channel(`game:${gameId}`, { config: { private: true } });
  let left = false;
  void supabase.auth
    .getSession()
    .then(({ data }) => supabase.realtime.setAuth(data.session?.access_token ?? null))
    .catch(() => undefined)
    .then(() => {
      if (left) return;
      channel.on("broadcast", { event: "*" }, (message) => onEvent(message.payload)).subscribe((status) => onStatus(status));
    });
  return () => {
    left = true;
    void supabase.removeChannel(channel);
  };
}
