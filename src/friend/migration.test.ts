import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static checks on the friend-mode migration (design §D8.7 A.2).
// They read the SQL as text; no database is involved.

const sqlPath = fileURLToPath(
  new URL("../../supabase/migrations/20261009120000_friend_mode.sql", import.meta.url),
);
const raw = readFileSync(sqlPath, "utf8");

/** SQL with `--` comments removed, so prose in comments can't satisfy a check. */
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

interface Fn {
  name: string;
  header: string;
  body: string;
}

/** Every `create function ... as $$ ... $$;`, with its header and body. */
function functions(): Fn[] {
  const result: Fn[] = [];
  const re = /create function\s+([\w.]+)\s*\(([\s\S]*?)\$\$([\s\S]*?)\$\$;/g;
  for (const m of sql.matchAll(re)) {
    result.push({ name: m[1], header: m[2], body: m[3] });
  }
  return result;
}

function fn(name: string): Fn {
  const found = functions().find((f) => f.name === name);
  if (!found) throw new Error(`function ${name} not found`);
  return found;
}

/** The executable part of a PL/pgSQL body: from `begin` on, so `declare v public.games;` is skipped. */
function executable(name: string): string {
  const body = fn(name).body;
  return body.slice(body.search(/\bbegin\b/));
}

/** Statements (`;`-separated) that match a pattern, whitespace-normalised. */
function statements(pattern: RegExp): string[] {
  return sql
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => pattern.test(s));
}

describe("friend-mode migration", () => {
  it("defines every function the design lists", () => {
    const names = functions().map((f) => f.name).sort();
    expect(names).toEqual(
      [
        "private.start_fen",
        "private.generate_join_code",
        "private.games_guard_insert",
        "private.games_guard_update",
        "private.games_guard_delete",
        "private.games_no_truncate",
        "private.games_broadcast",
        "public.apply_friend_move",
        "private.user_lock_key",
        "private.lock_users",
        "public.create_friend_game",
        "public.cancel_friend_game",
        "public.join_friend_game",
        "private.expire_friend_games",
        "private.delete_ended_friend_games",
      ].sort(),
    );
  });

  it("gives every function an empty search_path", () => {
    for (const f of functions()) {
      expect(f.header, f.name).toMatch(/set search_path = ''/);
    }
  });

  it("makes exactly the approved functions SECURITY DEFINER", () => {
    const definer = functions()
      .filter((f) => /security definer/.test(f.header))
      .map((f) => f.name)
      .sort();
    expect(definer).toEqual(
      [
        "private.games_broadcast",
        "public.apply_friend_move",
        "public.create_friend_game",
        "public.cancel_friend_game",
        "public.join_friend_game",
        "private.expire_friend_games",
        "private.delete_ended_friend_games",
      ].sort(),
    );
  });

  it("takes the per-user lock before touching games in create and cancel", () => {
    for (const name of ["public.create_friend_game", "public.cancel_friend_game"]) {
      const body = executable(name);
      const lock = body.indexOf("private.lock_users(");
      const games = body.indexOf("public.games");
      expect(lock, name).toBeGreaterThan(-1);
      expect(lock, name).toBeLessThan(games);
    }
  });

  it("lets join read games only once, unlocked, before taking both locks", () => {
    const body = executable("public.join_friend_game");
    const lock = body.indexOf("private.lock_users(v_creator, v_uid)");
    expect(lock).toBeGreaterThan(-1);
    const before = body.slice(0, lock);
    expect(before.match(/public\.games/g)).toHaveLength(1);
    expect(before).toMatch(/select g\.white_id into v_creator\s+from public\.games g/);
    expect(before).not.toMatch(/for update/);
  });

  it("has no project-wide default privileges and no FORCE RLS", () => {
    expect(sql).not.toMatch(/alter default privileges/i);
    expect(sql).not.toMatch(/force\s+row\s+level\s+security/i);
  });

  it("revokes every function from the roles that must not call it", () => {
    const revokes = statements(/^revoke all on function/).join("\n");
    for (const f of functions()) {
      expect(revokes, f.name).toContain(f.name + "(");
    }
  });

  it("grants EXECUTE only as approved", () => {
    const grants = statements(/^grant execute on function/);
    const byFn = new Map<string, Set<string>>();
    for (const g of grants) {
      const m = g.match(/^grant execute on function ([\w.]+)\(.*\) to ([\w, ]+)$/);
      expect(m, g).not.toBeNull();
      const roles = byFn.get(m![1]) ?? new Set<string>();
      m![2].split(",").forEach((r) => roles.add(r.trim()));
      byFn.set(m![1], roles);
    }
    expect(Object.fromEntries([...byFn].map(([k, v]) => [k, [...v].sort()]))).toEqual({
      "public.apply_friend_move": ["service_role"],
      "public.create_friend_game": ["authenticated"],
      "public.cancel_friend_game": ["authenticated"],
      "public.join_friend_game": ["authenticated"],
    });
  });

  it("gives the games table only SELECT for authenticated", () => {
    expect(
      statements(/^revoke all on table public\.games from public, anon, authenticated, service_role$/),
    ).toHaveLength(1);
    expect(statements(/^grant .* on table public\.games/)).toEqual([
      "grant select on table public.games to authenticated",
    ]);
  });

  it("enables RLS with a single SELECT policy on games", () => {
    expect(statements(/^alter table public\.games enable row level security$/)).toHaveLength(1);
    const policies = statements(/^create policy \w+ on public\.games/);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/for select to authenticated/);
  });
});

describe("friend-mode migration structure", () => {
  it("checks every prerequisite in step 0 before creating anything", () => {
    const step0 = sql.slice(0, sql.indexOf("create schema private"));
    expect(step0).toMatch(/extname = 'pg_cron'/);
    expect(step0).toMatch(/to_regprocedure\('cron\.schedule\(text,text,text\)'\)/);
    expect(step0).toMatch(/to_regprocedure\('extensions\.gen_random_bytes\(integer\)'\)/);
    expect(step0).toMatch(/jobname like ''safe-chess-%''/);
    expect(step0).toMatch(/to_regprocedure\('realtime\.send\(jsonb,text,text,boolean\)'\)/);
    expect(step0).toMatch(/has_function_privilege\('realtime\.send\(jsonb,text,text,boolean\)', 'execute'\)/);
    expect(step0).toMatch(/has_column_privilege\('realtime\.messages', col, 'insert'\)/);
    expect(step0).not.toMatch(/insert into realtime\.messages/);
    expect(sql).not.toMatch(/broadcast_changes/);
    expect(step0).not.toMatch(/create extension/i);
  });

  it("stops in step 0 unless RLS is enabled on realtime.messages", () => {
    const step0 = sql.slice(0, sql.indexOf("create schema private"));
    const rls = step0.indexOf("if not coalesce((select c.relrowsecurity");
    expect(rls).toBeGreaterThan(-1);
    const block = step0.slice(rls, step0.indexOf("end if;", rls));
    expect(block).toMatch(/n\.nspname = 'realtime' and c\.relname = 'messages'\), false\) then/);
    expect(block).toMatch(/row level security is not enabled on/);
    expect(rls).toBeLessThan(step0.indexOf("has_function_privilege('realtime.send"));
    expect(rls).toBeLessThan(sql.indexOf("create policy game_channel_receive"));
    expect(rls).toBeLessThan(sql.indexOf("create policy game_channel_presence_only"));
  });

  it("requires BYPASSRLS or owner rights without FORCE for notifications, never RLS off", () => {
    const step0 = sql.slice(0, sql.indexOf("create schema private"));
    const cap = step0.indexOf("if not coalesce((select r.rolbypassrls");
    expect(cap).toBeGreaterThan(-1);
    const block = step0.slice(cap, step0.indexOf("end if;", cap));
    expect(block).toMatch(
      /r\.rolbypassrls\s+or \(pg_has_role\(current_user, c\.relowner, 'usage'\)\s+and not c\.relforcerowsecurity\)/,
    );
    expect(block).toMatch(/RLS on realtime\.messages applies to/);
    expect(step0).not.toMatch(/not c\.relrowsecurity/);
  });

  it("never installs an extension", () => {
    expect(sql).not.toMatch(/create\s+extension/i);
  });

  it("checks each Supabase schema and USAGE on it before looking up its objects", () => {
    const step0 = sql.slice(0, sql.indexOf("create schema private"));
    for (const s of ["extensions", "cron", "auth", "realtime"]) {
      const ns = step0.indexOf(`if to_regnamespace('${s}') is null then`);
      const usage = step0.indexOf(`if not has_schema_privilege(current_user, '${s}', 'USAGE') then`);
      const lookup = step0.search(new RegExp(`to_reg(?:class|procedure)\\('${s}\\.`));
      expect(ns, s).toBeGreaterThan(-1);
      expect(ns, s).toBeLessThan(usage);
      expect(usage, s).toBeLessThan(lookup);
    }
  });

  it("checks auth in separate steps and never parses an auth.users literal", () => {
    const step0 = sql.slice(0, sql.indexOf("create schema private"));
    const steps = [
      "if to_regnamespace('auth') is null then",
      "if not has_schema_privilege(current_user, 'auth', 'USAGE') then",
      "if to_regclass('auth.users') is null then",
      "where attrelid = to_regclass('auth.users')",
      "if to_regprocedure('auth.uid()') is null then",
      "if to_regprocedure('auth.jwt()') is null then",
    ];
    const at = steps.map((s) => step0.indexOf(s));
    for (const [i, pos] of at.entries()) expect(pos, steps[i]).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(step0).not.toMatch(/'auth\.users'::regclass/);
  });

  it("schedules the two cleanup jobs last, each calling a defined function", () => {
    const schedules = [...sql.matchAll(/cron\.schedule\('([\w-]+)',\s*'([^']+)',\s*\$\$select ([\w.]+)\(\)\$\$\)/g)];
    expect(schedules.map((m) => m[1])).toEqual([
      "safe-chess-expire",
      "safe-chess-delete-ended",
    ]);
    const names = functions().map((f) => f.name);
    for (const m of schedules) {
      expect(m[2]).toBe("*/5 * * * *");
      expect(names).toContain(m[3]);
    }
    expect(sql.indexOf("select cron.schedule(")).toBeGreaterThan(sql.lastIndexOf("create policy"));
  });

  it("has one privileges section and no design-only banners", () => {
    expect(raw).not.toMatch(/DESIGN ONLY|NOT A MIGRATION|FILE \d\/\d/);
    const lastCreate = sql.lastIndexOf("create function");
    const firstPrivilege = sql.search(/\b(grant|revoke)\b/);
    expect(firstPrivilege).toBeGreaterThan(lastCreate);
  });
});

// The FEN shape check of apply_friend_move, taken from the SQL text. The
// pattern uses only anchors, classes, ?, {m,n} and alternation, which mean
// the same in JavaScript and PostgreSQL regular expressions.
function fenPattern(): RegExp {
  const body = fn("public.apply_friend_move").body;
  const m = body.match(/p_new_fen !~ \(([\s\S]*?)\) then/);
  if (!m) throw new Error("FEN check not found");
  const literal = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join("");
  return new RegExp(literal);
}

const BOARD = "r3k2r/8/8/8/8/8/8/R3K2R";

/** All 15 non-empty subsets of KQkq in canonical order, plus "-". */
const VALID_CASTLING = ["-"];
for (let mask = 1; mask < 16; mask++) {
  VALID_CASTLING.push(["K", "Q", "k", "q"].filter((_, i) => mask & (1 << i)).join(""));
}

describe("FEN shape check in apply_friend_move", () => {
  const re = fenPattern();

  it("has 16 valid castling fields", () => {
    expect(new Set(VALID_CASTLING).size).toBe(16);
  });

  it.each(VALID_CASTLING)("accepts castling field %s", (c) => {
    expect(re.test(`${BOARD} w ${c} - 0 1`)).toBe(true);
  });

  it.each([
    "", "KK", "QK", "kK", "qK", "kQ", "qk", "KQqk", "KQkqK", "Kqk",
    "--", "K-", "-K", "X", "A", "KQkqq", "k q", "kq ",
  ])("rejects castling field %j", (c) => {
    expect(re.test(`${BOARD} w ${c} - 0 1`)).toBe(false);
  });

  it.each([
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
    "8/8/8/8/8/8/8/8 w - - 99 99999",
    "4k3/8/8/8/8/8/8/4K3 b - - 100 75",
  ])("accepts well-formed FEN %s", (f) => {
    expect(re.test(f)).toBe(true);
  });

  it.each([
    "",
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0",        // missing field
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 x",    // extra field
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1",      // side to move
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e4 0 1",     // en passant rank
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq i3 0 1",     // en passant file
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - -1 1",     // negative clock
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 123456", // fullmove too long
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 12345 1",  // halfmove too long
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR  w KQkq - 0 1",     // double space
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 ",     // trailing space
    " rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",     // leading space
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w KQkq - 0 1",      // bad piece letter
    "rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",      // digit 9
    "8/8/8/8 w - - 0 1",                                             // board too short
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\nx",  // second line
  ])("rejects malformed FEN %j", (f) => {
    expect(re.test(f)).toBe(false);
  });
});

describe("Realtime notifications and channel policies", () => {
  it("limits both realtime.messages policies to the row's own topic", () => {
    const policies = statements(/^create policy \w+ on realtime\.messages/);
    expect(policies).toHaveLength(2);
    for (const p of policies) {
      expect(p).toContain("and realtime.messages.topic = (select realtime.topic())");
    }
  });

  it("lets clients insert presence messages only", () => {
    const inserts = statements(/^create policy \w+ on realtime\.messages for insert/);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatch(/with check \( realtime\.messages\.extension = 'presence' and/);
  });

  it("sends only game_id, version and op, on private channels", () => {
    const body = fn("private.games_broadcast").body;
    expect(body.match(/realtime\.send\(/g)).toHaveLength(1);
    const payload = body.match(/jsonb_build_object\(([\s\S]*?)\),\s*tg_op,/);
    expect(payload).not.toBeNull();
    expect([...payload![1].matchAll(/'(\w+)',/g)].map((x) => x[1])).toEqual(["game_id", "version", "op"]);
    const fields = new Set([...body.matchAll(/\b(?:new|old)\.(\w+)/g)].map((x) => x[1]));
    expect([...fields].sort()).toEqual(["id", "version"]);
    expect(body).not.toMatch(/join_code|white_id|black_id|\bfen\b|\bmoves\b|record/);
    expect(body).toMatch(/,\s*true\);/);
  });

  it("turns only a failed notification into a warning", () => {
    const body = fn("private.games_broadcast").body;
    const m = body.match(/begin\s+begin([\s\S]*?)exception when others then([\s\S]*?)end;\s*return null;/);
    expect(m).not.toBeNull();
    const guarded = m![1].trim();
    expect(guarded).toMatch(/^perform realtime\.send\(/);
    expect(guarded.match(/;/g)).toHaveLength(1);
    expect(m![2]).toMatch(/^\s*raise warning/);
    expect(m![2]).not.toMatch(/\b(?:new|old)\./);
    expect(body).not.toMatch(/raise exception/);
  });
});

describe("cleanup jobs", () => {
  it("bounds job 1 and job 2 to 25 rows, oldest first, re-checked outside the subquery", () => {
    const expire = executable("private.expire_friend_games");
    expect(expire.match(/\blimit \d+/g)).toEqual(["limit 25"]);
    expect(expire).toMatch(
      /order by x\.expires_at\s+limit 25\)\s+and g\.status in \('waiting', 'active'\)\s+and g\.expires_at <= now\(\);/,
    );
    const ended = executable("private.delete_ended_friend_games");
    expect(ended.match(/\blimit \d+/g)).toEqual(["limit 25"]);
    expect(ended).toMatch(
      /order by x\.ended_at\s+limit 25\)\s+and g\.status in \('finished', 'expired'\)\s+and g\.ended_at <= now\(\) - interval '1 hour';/,
    );
  });

  it("gives job 1 and job 2, and only them, a 5 s lock_timeout", () => {
    const withTimeout = functions()
      .filter((f) => /set lock_timeout = '5s'/.test(f.header))
      .map((f) => f.name)
      .sort();
    expect(withTimeout).toEqual(["private.delete_ended_friend_games", "private.expire_friend_games"]);
  });

  // DELETE FROM [ONLY] auth.x or TRUNCATE ... auth.x, "auth" quoted or not,
  // any case and spacing (same as M-verify row 36). A text search: it can't
  // see SQL assembled at run time (execute 'delete from ' || v_schema ...).
  const authWrite = /(?:\bdelete\s+from\s+(?:only\s+)?|\btruncate\b[^;]*)"?\bauth\b"?\s*\./i;

  it("recognises the forms of an auth delete or truncate it looks for", () => {
    for (const hit of [
      "delete from auth.users",
      "DELETE   FROM\n  auth.users where id = 1",
      "delete from only auth.users",
      'delete from "auth".users',
      'DELETE FROM ONLY "auth"."users"',
      "truncate auth.users",
      "TRUNCATE TABLE ONLY auth.users",
      "truncate public.games, auth.users",
      "execute 'delete from auth.users'",
    ]) {
      expect(hit, hit).toMatch(authWrite);
    }
    for (const miss of [
      "delete from public.games where (select auth.uid()) in (white_id, black_id)",
      "raise exception 'games: truncate is not allowed';",
      "execute function private.games_no_truncate();",
      "truncate public.games; select auth.uid()",
      "truncate oauth.tokens",
    ]) {
      expect(miss, miss).not.toMatch(authWrite);
    }
  });

  it("never deletes users and schedules no user cleanup", () => {
    expect(sql).not.toMatch(authWrite);
    expect(sql).not.toMatch(/delete_stale_anonymous_users|safe-chess-delete-users/);
    expect(sql.match(/select cron\.schedule\(/g)).toHaveLength(2);
  });
});
