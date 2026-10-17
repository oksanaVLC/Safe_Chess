// The browser's calls to the friend-mode database functions. Each takes a
// plain `rpc` function, so the tests run without Supabase. The functions
// check everything on the server (the caller's anonymous session decides
// whose game it is); the browser only reads their answers.

export type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

export type CreateResult =
  | { status: "ok"; gameId: string; code: string; expiresAt: string }
  | { status: "error" };

/**
 * create_friend_game: the caller's waiting game. Safe to call again (a
 * reload, a second tap): while the game is waiting the server answers
 * "existing" with the same game instead of making another.
 */
export async function createFriendGame(rpc: Rpc): Promise<CreateResult> {
  try {
    const { data, error } = await rpc("create_friend_game", {});
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    if (error || !row) return { status: "error" };
    const { result, id, join_code: code, expires_at: expiresAt } = row;
    if ((result !== "created" && result !== "existing") || typeof id !== "string" || typeof code !== "string" || typeof expiresAt !== "string") {
      return { status: "error" };
    }
    return { status: "ok", gameId: id, code, expiresAt };
  } catch {
    return { status: "error" };
  }
}

export type JoinResult =
  | { status: "ok"; gameId: string }
  | { status: "invalid" | "expired" | "own_game" | "unavailable" | "error" };

/**
 * join_friend_game: takes Black in the game with this code. Safe to call
 * again: a player already seated in the game gets "ok" with the same game.
 */
export async function joinFriendGame(rpc: Rpc, code: string): Promise<JoinResult> {
  try {
    const { data, error } = await rpc("join_friend_game", { p_code: code });
    const row = Array.isArray(data) ? (data[0] as { result?: unknown; game_id?: unknown } | undefined) : undefined;
    if (error || !row) return { status: "error" };
    if (row.result === "ok") {
      return typeof row.game_id === "string" ? { status: "ok", gameId: row.game_id } : { status: "error" };
    }
    if (row.result === "invalid" || row.result === "expired" || row.result === "own_game" || row.result === "unavailable") {
      return { status: row.result };
    }
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

export type CancelResult = "cancelled" | "already_joined" | "ended" | "not_found" | "error";

/** cancel_friend_game: deletes the caller's own game only while it is waiting. */
export async function cancelFriendGame(rpc: Rpc, gameId: string): Promise<CancelResult> {
  try {
    const { data, error } = await rpc("cancel_friend_game", { p_game: gameId });
    const result = Array.isArray(data) ? (data[0] as { result?: unknown } | undefined)?.result : undefined;
    if (error) return "error";
    return result === "cancelled" || result === "already_joined" || result === "ended" || result === "not_found" ? result : "error";
  } catch {
    return "error";
  }
}

/** The code as shown to people: two groups of four, e.g. ABCD-EFGH. */
export function displayJoinCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** The link a friend opens (or scans) to join; the join screen reads ?c=. */
export function joinLink(origin: string, code: string): string {
  return `${origin}/j?c=${encodeURIComponent(code)}`;
}
