import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The REAL supabase/functions/friend-move/index.ts, run in Node: Deno (env,
// serve) and fetch are replaced before the file is imported, so it reads a
// fake environment and talks only to a fake Supabase. Every value below is
// made up; an unknown URL gets 599 and fails the test, so no request can
// leave the process.

const SUPABASE = "https://project.supabase.test";
const ORIGIN = "http://localhost:3000";
const GAME = "aaaaaaaa-0000-4000-8000-000000000001";
const WHITE = "11111111-1111-4111-8111-111111111111";
const BLACK = "22222222-2222-4222-8222-222222222222";
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const PUBLISHABLE = "sb_publishable_TESTONLY-pub";
const SB_SECRET = "sb_secret_TESTONLY-secret";
const LEGACY_ANON = "legacy-anon-TESTONLY";
// a legacy service_role JWT: made-up payload, made-up signature
const LEGACY_SERVICE = [{ alg: "HS256", typ: "JWT" }, { role: "service_role", exp: 4102444800, iss: "TESTONLY" }]
  .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
  .concat("TESTONLY-signature")
  .join(".");
const TOKEN = "user-token-TESTONLY";
const SENSITIVE = [PUBLISHABLE, SB_SECRET, LEGACY_ANON, LEGACY_SERVICE, TOKEN];

// modern keys only: no service_role JWT anywhere
const NEW_KEYS = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: SB_SECRET }),
};
// modern keys plus the legacy service_role JWT the write needs
const NEW_KEYS_AND_JWT = { ...NEW_KEYS, SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE };
const LEGACY_KEYS = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: LEGACY_ANON,
  SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE,
};

let env: Record<string, string> = {};
let serve: ((req: Request) => Response | Promise<Response>) | null = null;
const calls: { url: string; headers: Record<string, string> }[] = [];
const logs: string[] = [];
const bodies: string[] = [];

const row = () => ({
  id: GAME,
  join_code: "ABCDEFGH",
  status: "active",
  white_id: WHITE,
  black_id: BLACK,
  moves: [] as string[],
  fen: START,
  version: 1,
  end_reason: null,
  winner: null,
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
});

const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  calls.push({ url, headers });
  const reply = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const publicKey = headers.apikey === PUBLISHABLE || headers.apikey === LEGACY_ANON;

  if (url === `${SUPABASE}/auth/v1/user`) {
    if (!publicKey) return reply(401, { message: "Invalid API key" });
    return headers.authorization === `Bearer ${TOKEN}`
      ? reply(200, { id: WHITE, is_anonymous: true })
      : reply(403, { error_code: "bad_jwt" });
  }
  if (url === `${SUPABASE}/rest/v1/games?id=eq.${GAME}&select=*`) {
    if (!publicKey || headers.authorization !== `Bearer ${TOKEN}`) return reply(401, {});
    return reply(200, [row()]);
  }
  if (url === `${SUPABASE}/rest/v1/rpc/apply_friend_move`) {
    // gateway: a known API key; an sb_ key is never a valid Bearer token
    if (headers.authorization?.startsWith("Bearer sb_")) return reply(401, { message: "Invalid JWT" });
    if (headers.apikey !== SB_SECRET && headers.apikey !== LEGACY_SERVICE) return reply(401, { message: "Invalid API key" });
    // apply_friend_move check A: needs the service_role JWT
    if (headers.authorization !== `Bearer ${LEGACY_SERVICE}`) {
      return reply(400, { code: "P0001", message: "apply_friend_move: forbidden" });
    }
    return reply(200, [{ result: "ok", game: { ...row(), moves: ["e2e4"], version: 2 } }]);
  }
  return reply(599, { error: "unexpected URL in test" });
}) as typeof fetch;

function moveRequest(options: { origin?: string | null; method?: string } = {}): Request {
  const { origin = ORIGIN, method = "POST" } = options;
  const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  if (origin !== null) headers.origin = origin;
  return new Request(`${SUPABASE}/functions/v1/friend-move`, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify({ gameId: GAME, expectedVersion: 1, uci: "e2e4" }) : undefined,
  });
}

async function call(vars: Record<string, string>, options?: Parameters<typeof moveRequest>[0]) {
  env = vars;
  if (!serve) throw new Error("index.ts did not register a handler");
  const res = await serve(moveRequest(options));
  const text = await res.text();
  bodies.push(text);
  return { res, data: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

const rpcCalls = () => calls.filter((c) => c.url.endsWith("/rpc/apply_friend_move"));

beforeAll(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => env[name] },
    serve: (handler: (req: Request) => Response | Promise<Response>) => {
      serve = handler;
    },
  });
  vi.stubGlobal("fetch", fakeFetch);
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  await import("../../supabase/functions/friend-move/index");
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  calls.length = 0;
  logs.length = 0;
  bodies.length = 0;
});

afterEach(() => {
  // no request outside the fake project, no made-up secret in a log or an answer
  for (const c of calls) expect(c.url.startsWith(`${SUPABASE}/`), c.url).toBe(true);
  const visible = [...logs, ...bodies].join("\n");
  for (const value of SENSITIVE) expect(visible).not.toContain(value);
});

describe("friend-move index.ts (real file, fake Deno and fetch)", () => {
  it("answers 500 without any request when SUPABASE_URL is missing", async () => {
    const { res, data } = await call({ ...NEW_KEYS, SUPABASE_URL: "" });
    expect([res.status, data]).toEqual([500, { result: "server_error" }]);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(calls).toHaveLength(0);
    expect(logs).toEqual(["friend-move: SUPABASE_URL missing"]);
  });

  it("does not fall back to the legacy key when SUPABASE_PUBLISHABLE_KEYS is invalid", async () => {
    const { res } = await call({ ...LEGACY_KEYS, ...NEW_KEYS, SUPABASE_PUBLISHABLE_KEYS: "not json" });
    expect(res.status).toBe(500);
    expect(calls).toHaveLength(0);
    expect(logs).toEqual(["friend-move: SUPABASE_PUBLISHABLE_KEYS is not valid JSON"]);
  });

  it("keeps CORS consistent while not configured: preflight 204, unlisted origin none", async () => {
    const broken = { ...NEW_KEYS, SUPABASE_URL: "" };
    const preflight = await call(broken, { method: "OPTIONS" });
    expect(preflight.res.status).toBe(204);
    expect(preflight.res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    for (const origin of ["https://evil.example", null]) {
      const { res } = await call(broken, { origin });
      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  it("writes nothing without any server credential", async () => {
    const { SUPABASE_SECRET_KEYS: _omit, ...withoutSecret } = NEW_KEYS;
    void _omit;
    const { res } = await call(withoutSecret);
    expect(res.status).toBe(500);
    expect(rpcCalls()).toHaveLength(0);
    expect(logs).toEqual(["friend-move: SUPABASE_SERVICE_ROLE_KEY is missing: apply_friend_move needs a service_role JWT"]);
  });

  it("fails closed with modern keys only: an sb_secret_ key is never used as the JWT", async () => {
    const { res } = await call(NEW_KEYS);
    expect(res.status).toBe(500);
    expect(rpcCalls()).toHaveLength(0);
    expect(logs).toEqual(["friend-move: SUPABASE_SERVICE_ROLE_KEY is missing: apply_friend_move needs a service_role JWT"]);
  });

  it("fails closed when SUPABASE_SERVICE_ROLE_KEY holds an sb_secret_ key instead of a JWT", async () => {
    const { res } = await call({ ...NEW_KEYS, SUPABASE_SERVICE_ROLE_KEY: SB_SECRET });
    expect(res.status).toBe(500);
    expect(rpcCalls()).toHaveLength(0);
    expect(logs).toEqual(["friend-move: SUPABASE_SERVICE_ROLE_KEY is not a JWT"]);
  });

  it("writes nothing when the secret key is invalid, even with a legacy key present", async () => {
    const { res } = await call({
      ...NEW_KEYS,
      SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE,
      SUPABASE_SECRET_KEYS: JSON.stringify({ backend: SB_SECRET, other: SB_SECRET }),
    });
    expect(res.status).toBe(500);
    expect(rpcCalls()).toHaveLength(0);
    expect(logs).toEqual(['friend-move: SUPABASE_SECRET_KEYS has no "default" key']);
  });

  it("sends the modern secret as apikey and the service_role JWT as Authorization", async () => {
    const { res, data } = await call(NEW_KEYS_AND_JWT);
    expect([res.status, data?.result]).toEqual([200, "ok"]);
    const [rpc] = rpcCalls();
    expect(rpc.headers).toMatchObject({ apikey: SB_SECRET, authorization: `Bearer ${LEGACY_SERVICE}` });
    expect(calls[0].headers).toMatchObject({ apikey: PUBLISHABLE, authorization: `Bearer ${TOKEN}` });
    expect(logs).toEqual([]);
  });

  it("keeps the legacy keys working as before", async () => {
    const { res, data } = await call(LEGACY_KEYS);
    expect([res.status, data?.result]).toEqual([200, "ok"]);
    const [rpc] = rpcCalls();
    expect(rpc.headers).toMatchObject({ apikey: LEGACY_SERVICE, authorization: `Bearer ${LEGACY_SERVICE}` });
    expect(calls[0].headers).toMatchObject({ apikey: LEGACY_ANON, authorization: `Bearer ${TOKEN}` });
  });
});
