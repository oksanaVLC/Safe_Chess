// Safe Chess, friend mode: the friend-move Edge Function (design §G).
//
// The browser sends exactly { gameId, expectedVersion, uci }. Identity
// comes only from the caller's token, checked by Supabase Auth; colour,
// turn, position and result come only from the stored game, replayed
// with chess.js. The single write is public.apply_friend_move, which
// re-checks membership, status, version and turn under a row lock.
// The service-role key is read only for that write and is never logged
// or returned. Nothing here logs headers, tokens or request bodies.
//
// All I/O goes through `deps`, so the tests run this file in Node with a
// fake Supabase; index.ts wires it to Deno and the real environment.

import { applyUci, outcome, replay, UCI_RE, type Side } from "../_shared/friendRules.ts";

export interface FriendMoveDeps {
  supabaseUrl: string;
  /** Publishable key (or the legacy anon key): used with the caller's own token. */
  anonKey: string;
  /** Server credentials for the write; looked up only right before it (step 8). */
  serverCredentials: () => ServerCredentials;
  allowedOrigins: readonly string[];
  fetch: typeof fetch;
  now: () => number;
}

export interface MoveRequest {
  gameId: string;
  expectedVersion: number;
  uci: string;
}

interface GameRow {
  id: string;
  status: string;
  white_id: string;
  black_id: string | null;
  moves: string[];
  fen: string;
  version: number;
  expires_at: string;
  [column: string]: unknown;
}

export type KeyLookup = { key: string } | { error: string };

/**
 * What the write sends: the apikey header, and a JWT for Authorization or
 * null for none. A modern secret key goes in apikey only: the gateway turns
 * it into a short-lived service_role JWT. A legacy service_role JWT goes in
 * both headers.
 */
export type ServerCredentials = { apikey: string; jwt: string | null } | { error: string };

/**
 * The function's own credentials, from the Edge Function environment.
 *
 * Publishable key (calls made with the player's token): the "default" entry
 * of SUPABASE_PUBLISHABLE_KEYS, or SUPABASE_ANON_KEY when that variable is
 * absent, empty or "{}".
 *
 * Server credentials (the one write, apply_friend_move, whose check A needs
 * auth.jwt()->>'role' = 'service_role'):
 *  - SUPABASE_SECRET_KEYS present: its "default" entry, which must be an
 *    sb_secret_ key, sent as apikey with no Authorization header. A present
 *    but unusable SUPABASE_SECRET_KEYS is a configuration error: nothing is
 *    written and the legacy key is not tried instead.
 *  - SUPABASE_SECRET_KEYS absent, empty or "{}": the legacy
 *    SUPABASE_SERVICE_ROLE_KEY, accepted only as an unexpired service_role
 *    JWT, sent in both headers.
 *  - neither: a configuration error, nothing is written.
 * Whatever the key, check A in the database still refuses any caller whose
 * role is not service_role, so a wrong key fails closed there too.
 *
 * Errors name variables only, never a value. Nothing is read until called,
 * so the server credentials are read only at the write.
 */
export function apiKeysFrom(get: (name: string) => string | undefined, now: () => number = Date.now) {
  return {
    publishable: (): KeyLookup => {
      const key = namedKey(get, "SUPABASE_PUBLISHABLE_KEYS");
      if (key !== null) return key;
      const legacy = get("SUPABASE_ANON_KEY");
      return legacy ? { key: legacy } : { error: "SUPABASE_PUBLISHABLE_KEYS and SUPABASE_ANON_KEY are both missing" };
    },
    server: (): ServerCredentials => {
      const secret = namedKey(get, "SUPABASE_SECRET_KEYS");
      if (secret !== null) {
        if ("error" in secret) return secret;
        if (!secret.key.startsWith("sb_secret_")) {
          return { error: 'SUPABASE_SECRET_KEYS "default" is not an sb_secret_ key' };
        }
        return { apikey: secret.key, jwt: null };
      }
      const jwt = serviceRoleJwt(get("SUPABASE_SERVICE_ROLE_KEY"), now());
      if ("error" in jwt) return jwt;
      return { apikey: jwt.key, jwt: jwt.key };
    },
  };
}

/**
 * The "default" entry of a JSON key dictionary (SUPABASE_*_KEYS). Null when
 * the variable is absent, empty or "{}" (no new keys); an error when it is
 * present but unusable. No entry is ever picked by guess.
 */
function namedKey(get: (name: string) => string | undefined, newVar: string): KeyLookup | null {
  const raw = get(newVar)?.trim();
  if (!raw) return null;
  let keys: unknown;
  try {
    keys = JSON.parse(raw);
  } catch {
    return { error: `${newVar} is not valid JSON` };
  }
  if (typeof keys !== "object" || keys === null || Array.isArray(keys)) {
    return { error: `${newVar} is not a JSON object` };
  }
  if (Object.keys(keys).length === 0) return null;
  const key = (keys as Record<string, unknown>).default;
  return typeof key === "string" && key !== "" ? { key } : { error: `${newVar} has no "default" key` };
}

const JWT_RE = /^[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/;

/**
 * SUPABASE_SERVICE_ROLE_KEY (used only when there is no modern secret key),
 * accepted only if it is shaped like a JWT whose payload has role
 * "service_role" and is not expired. The signature is not checked here
 * (PostgREST verifies it); the payload is only inspected, never logged or
 * returned.
 */
function serviceRoleJwt(value: string | undefined, nowMs: number): KeyLookup {
  const name = "SUPABASE_SERVICE_ROLE_KEY";
  if (!value) return { error: `SUPABASE_SECRET_KEYS and ${name} are both missing` };
  const payload = JWT_RE.exec(value)?.[1];
  let claims: unknown = null;
  if (payload) {
    try {
      const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
      claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    } catch {
      claims = null;
    }
  }
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) {
    return { error: `${name} is not a JWT` };
  }
  const { role, exp } = claims as Record<string, unknown>;
  if (role !== "service_role") return { error: `${name} is not a service_role JWT` };
  if (typeof exp === "number" && exp * 1000 <= nowMs) return { error: `${name} has expired` };
  return { key: value };
}

const MAX_BODY_BYTES = 1024;
const MAX_INT = 2147483647; // PostgreSQL integer
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

/** Exactly { gameId, expectedVersion, uci }, each of the right shape; else null. */
export function parseMoveRequest(text: string): MoveRequest | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body).sort();
  if (keys.join(",") !== "expectedVersion,gameId,uci") return null;
  const { gameId, expectedVersion, uci } = body as Record<string, unknown>;
  if (typeof gameId !== "string" || !UUID_RE.test(gameId)) return null;
  if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion)) return null;
  if (expectedVersion < 0 || expectedVersion > MAX_INT) return null;
  if (typeof uci !== "string" || !UCI_RE.test(uci)) return null;
  return { gameId: gameId.toLowerCase(), expectedVersion, uci };
}

function isGameRow(row: unknown): row is GameRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.status === "string" &&
    typeof r.white_id === "string" &&
    (r.black_id === null || typeof r.black_id === "string") &&
    Array.isArray(r.moves) &&
    r.moves.every((m) => typeof m === "string") &&
    typeof r.fen === "string" &&
    typeof r.version === "number" &&
    typeof r.expires_at === "string"
  );
}

/** Supabase Auth error codes that mean the caller's session is not valid. */
const SESSION_ERROR_CODES = new Set([
  "bad_jwt",
  "no_authorization",
  "session_not_found",
  "session_expired",
  "user_not_found",
  "user_banned",
]);

async function errorBody(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => null)) as unknown;
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/**
 * Why Auth refused (401/403): "server" only when the answer names the API
 * key (the gateway's "Invalid API key" / "No API key found"), which is the
 * function's own credential. A known session error code, or anything not
 * recognised, stays "user", as before: misreading an expired session as a
 * server fault would stop the client from refreshing it. Limitation: a
 * server-side refusal worded differently is still reported as "user".
 */
async function authRejection(res: Response): Promise<"user" | "server"> {
  const body = await errorBody(res);
  if (typeof body.error_code === "string" && SESSION_ERROR_CODES.has(body.error_code)) return "user";
  const words = [body.message, body.msg, body.hint].filter((v) => typeof v === "string").join(" ");
  return /\bapi ?key\b/i.test(words) ? "server" : "user";
}

/** PostgREST's answer for an expired JWT (PGRST3xx, "JWT expired"). */
async function tokenExpired(res: Response): Promise<boolean> {
  const body = await errorBody(res);
  return (
    res.status === 401 &&
    typeof body.code === "string" &&
    body.code.startsWith("PGRST3") &&
    typeof body.message === "string" &&
    /\bexpired\b/i.test(body.message)
  );
}

/** Reads at most `limit` bytes of the body; null if it is longer. */
async function readBody(req: Request, limit: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(all);
  } catch {
    return null;
  }
}

/**
 * Step 0's origin rule: a missing or unlisted origin gets 403 with no CORS
 * headers; a preflight (OPTIONS) from a listed origin gets 204 with them.
 * Otherwise returns the listed origin, for the CORS headers of the answer.
 */
function checkOrigin(req: Request, allowedOrigins: readonly string[]): Response | string {
  const origin = req.headers.get("origin");
  if (origin === null || !allowedOrigins.includes(origin)) {
    return json(403, { result: "forbidden_origin" }, null);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  return origin;
}

/**
 * The answer when the function itself is not configured (index.ts): the same
 * origin rule as step 0, then 500. A listed browser origin can read the 500
 * (and its preflight still passes); any other origin gets no CORS headers.
 * Nothing is read or written.
 */
export function configErrorResponse(req: Request, allowedOrigins: readonly string[]): Response {
  const origin = checkOrigin(req, allowedOrigins);
  return typeof origin === "string" ? json(500, { result: "server_error" }, origin) : origin;
}

export async function handleFriendMove(req: Request, deps: FriendMoveDeps): Promise<Response> {
  // 0. Origin, method, body
  const origin = checkOrigin(req, deps.allowedOrigins);
  if (typeof origin !== "string") return origin;
  if (req.method !== "POST") return json(405, { result: "method_not_allowed" }, origin);

  const text = await readBody(req, MAX_BODY_BYTES);
  const move = text === null ? null : parseMoveRequest(text);
  if (move === null) return json(400, { result: "bad_request" }, origin);

  // 1. Token, checked by Supabase Auth; the only source of identity
  const token = TOKEN_RE.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return json(401, { result: "unauthorized" }, origin);

  const asCaller = { apikey: deps.anonKey, authorization: `Bearer ${token}` };
  let userRes: Response;
  try {
    userRes = await deps.fetch(`${deps.supabaseUrl}/auth/v1/user`, { headers: asCaller });
  } catch {
    return json(503, { result: "unavailable" }, origin);
  }
  if (userRes.status === 401 || userRes.status === 403) {
    if ((await authRejection(userRes)) === "server") {
      console.error(`friend-move: Auth rejected the function's API key (HTTP ${userRes.status})`);
      return json(503, { result: "unavailable" }, origin);
    }
    return json(401, { result: "unauthorized" }, origin);
  }
  if (!userRes.ok) return json(503, { result: "unavailable" }, origin);
  const user = (await userRes.json().catch(() => null)) as { id?: unknown; is_anonymous?: unknown } | null;
  if (!user || typeof user.id !== "string" || !UUID_RE.test(user.id)) {
    return json(401, { result: "unauthorized" }, origin);
  }
  if (user.is_anonymous !== true) return json(403, { result: "not_anonymous" }, origin);
  const uid = user.id.toLowerCase();

  // 2-3. Read the game with the caller's own token: row level security
  // returns it only to its two players, so "no row" covers both a missing
  // game and a stranger (404, nothing leaks).
  let gameRes: Response;
  try {
    gameRes = await deps.fetch(
      `${deps.supabaseUrl}/rest/v1/games?id=eq.${move.gameId}&select=*`,
      { headers: { ...asCaller, accept: "application/json" } },
    );
  } catch {
    return json(503, { result: "unavailable" }, origin);
  }
  if (gameRes.status === 401 || gameRes.status === 403) {
    // Auth has just accepted this token, so a rejection here points at the
    // server (API key, JWT settings, grants), not at the user's session.
    // The one user-side case is the token expiring in between.
    if (await tokenExpired(gameRes)) return json(401, { result: "unauthorized" }, origin);
    console.error(`friend-move: the game read was rejected after Auth accepted the token (HTTP ${gameRes.status})`);
    return json(503, { result: "unavailable" }, origin);
  }
  if (!gameRes.ok) return json(503, { result: "unavailable" }, origin);
  const rows = (await gameRes.json().catch(() => null)) as unknown;
  if (!Array.isArray(rows)) return json(503, { result: "unavailable" }, origin);
  if (rows.length === 0) return json(404, { result: "not_found" }, origin);
  const row = rows[0];
  if (rows.length !== 1 || !isGameRow(row) || row.id.toLowerCase() !== move.gameId) {
    return json(500, { result: "server_error" }, origin);
  }
  const seat: Side | null =
    uid === row.white_id.toLowerCase() ? "w" : uid === row.black_id?.toLowerCase() ? "b" : null;
  if (seat === null) return json(404, { result: "not_found" }, origin);

  // 4. Authoritative state from the stored row
  const expires = Date.parse(row.expires_at);
  if (row.status !== "active" || !(expires > deps.now())) {
    return json(409, { result: "not_active", game: row }, origin);
  }
  if (row.version !== move.expectedVersion) return json(409, { result: "stale", game: row }, origin);
  const chess = replay(row.moves);
  if (chess === null || chess.fen() !== row.fen) {
    console.error("friend-move: stored history does not match the stored position");
    return json(500, { result: "server_error" }, origin);
  }

  // 5. Turn, from the replayed position (never from the request)
  if (chess.turn() !== seat) return json(403, { result: "not_your_turn", game: row }, origin);

  // 6-7. The move, then everything that follows from it
  if (!applyUci(chess, move.uci)) return json(422, { result: "illegal" }, origin);
  const { endReason, winner } = outcome(chess);

  // 8. The single atomic write, as service_role (credentials read only
  //    here): a modern secret key in apikey alone, or the legacy
  //    service_role JWT in both headers (see apiKeysFrom)
  const creds = deps.serverCredentials();
  if ("error" in creds) {
    console.error(`friend-move: ${creds.error}`); // variable names only
    return json(500, { result: "server_error" }, origin);
  }
  let rpcRes: Response;
  try {
    rpcRes = await deps.fetch(`${deps.supabaseUrl}/rest/v1/rpc/apply_friend_move`, {
      method: "POST",
      headers: {
        apikey: creds.apikey,
        ...(creds.jwt === null ? {} : { authorization: `Bearer ${creds.jwt}` }),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        p_game: move.gameId,
        p_uid: uid,
        p_expected_version: move.expectedVersion,
        p_uci: move.uci,
        p_new_fen: chess.fen(),
        p_end_reason: endReason,
        p_winner: winner,
      }),
    });
  } catch {
    return json(503, { result: "unavailable" }, origin);
  }
  if (!rpcRes.ok) {
    console.error(`friend-move: apply_friend_move failed (HTTP ${rpcRes.status})`);
    return json(500, { result: "server_error" }, origin);
  }

  // 9. The database's answer, with its row
  const data = (await rpcRes.json().catch(() => null)) as unknown;
  const answer = (Array.isArray(data) ? data[0] : data) as { result?: unknown; game?: unknown } | undefined;
  switch (answer?.result) {
    case "ok":
      return json(200, { result: "ok", game: answer.game }, origin);
    case "stale":
    case "not_active":
      return json(409, { result: answer.result, game: answer.game }, origin);
    case "not_your_turn":
      return json(403, { result: "not_your_turn", game: answer.game }, origin);
    case "not_found":
      return json(404, { result: "not_found" }, origin);
    default:
      console.error("friend-move: unexpected answer from apply_friend_move");
      return json(500, { result: "server_error" }, origin);
  }
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function json(status: number, body: Record<string, unknown>, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(origin ? corsHeaders(origin) : { vary: "Origin" }),
    },
  });
}
