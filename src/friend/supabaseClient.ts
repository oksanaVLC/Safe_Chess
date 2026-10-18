"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Color } from "chess.js";
import { sharedSession, type SessionResult } from "./anonymousSession";
import type { Rpc } from "./friendApi";
import { classifyMoveResponse, parseGameRow, type MoveResult } from "./friendGame";
import type { FetchResult } from "./gameSync";
import { checkPublicConfig } from "./publicConfig";
import { authStorageKey, browserStorage, guardSession, type KeyValueStorage } from "./sessionGuard";

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

export interface FriendClient {
  client: SupabaseClient;
  /** The player's anonymous session (calls at the same time share one lookup). */
  session(): Promise<SessionResult>;
  /**
   * Explicit "start again" after "session_lost": creates a new anonymous
   * user (once; concurrent or repeated calls share it). The old stored
   * session is overwritten only when the new one is saved. Only ever called
   * from a button.
   */
  startOver(): Promise<SessionResult>;
}

/**
 * The client with its session guard. The guard is installed BEFORE the
 * client is created, because supabase-js starts restoring (and may try to
 * delete) the stored session as soon as it exists. The session key is the
 * default one, so sessions stored by earlier versions are kept.
 */
export function createFriendClient(url: string, publishableKey: string, storage: KeyValueStorage, fetchImpl?: typeof fetch): FriendClient {
  const sessionKey = authStorageKey(url);
  const guard = guardSession(storage, sessionKey); // records whether a session was stored
  const client = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: guard.storage,
      storageKey: sessionKey,
    },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });
  let allowCreate = !guard.hadStoredSession;
  const policy = { mayCreate: () => allowCreate, lost: () => guard.blockedRemoval };
  let lookup = sharedSession(client.auth, policy);
  // One "start again" at a time; once it has worked, asking again returns
  // the same new player instead of creating another one.
  let starting: Promise<SessionResult> | null = null;
  return {
    client,
    session: () => lookup(),
    startOver: () => {
      starting ??= (() => {
        guard.startOver();
        allowCreate = true;
        lookup = sharedSession(client.auth, policy);
        return lookup().then((result) => {
          if (result.status !== "ok") starting = null; // a later, deliberate tap may try again
          return result;
        });
      })();
      return starting;
    },
  };
}

let friend: FriendClient | null = null;

function friendClient(): FriendClient | null {
  if (config.status !== "ok") return null;
  friend ??= createFriendClient(config.url, config.publishableKey, browserStorage());
  return friend;
}

/** The shared client, or null when this build has no (valid) Supabase settings. */
export function getSupabase(): SupabaseClient | null {
  return friendClient()?.client ?? null;
}

/** The player's anonymous session (shared by every caller on this page). */
export function friendSession(supabase: SupabaseClient): Promise<SessionResult> {
  const f = friendClient();
  return f && f.client === supabase ? f.session() : Promise.resolve({ status: "error" });
}

/** "Start again" after a lost session: a new anonymous player in this browser. */
export function startOverSession(): Promise<SessionResult> {
  return friendClient()?.startOver() ?? Promise.resolve({ status: "error" });
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

/** Presence on the game channel: who has the game open. */
export interface GamePresence {
  /** This player's id: one presence entry per player, whatever the tabs. */
  key: string;
  seat: Color;
  onChange: (state: Record<string, unknown[]>) => void;
}

/**
 * Joins the private channel game:<id>. Only the two players may receive
 * on it (policy game_channel_receive); its events carry no game data.
 * With `presence`, the player also announces their seat (the only thing a
 * player may send there: policy game_channel_presence_only).
 */
export function subscribeToGame(
  supabase: SupabaseClient,
  gameId: string,
  onEvent: (payload: unknown) => void,
  onStatus: (status: string) => void,
  presence?: GamePresence,
): () => void {
  const channel = supabase.channel(`game:${gameId}`, {
    config: presence ? { private: true, presence: { key: presence.key } } : { private: true },
  });
  let left = false;
  void supabase.auth
    .getSession()
    .then(({ data }) => supabase.realtime.setAuth(data.session?.access_token ?? null))
    .catch(() => undefined)
    .then(() => {
      if (left) return;
      channel.on("broadcast", { event: "*" }, (message) => onEvent(message.payload));
      if (presence) channel.on("presence", { event: "sync" }, () => presence.onChange(channel.presenceState()));
      channel.subscribe((status) => {
        if (presence && status === "SUBSCRIBED") void channel.track({ seat: presence.seat }).catch(() => undefined);
        onStatus(status);
      });
    });
  return () => {
    left = true;
    void supabase.removeChannel(channel);
  };
}
