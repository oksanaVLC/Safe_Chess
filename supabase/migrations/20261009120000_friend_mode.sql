-- Safe Chess, Step 7: friend mode (server-authoritative games)
--
-- One migration, built from the v10 design (step7-design.md §A/§E.3 and
-- the step7-1..4 SQL drafts). Run it ONCE, as role postgres, as a single
-- transaction. It is not idempotent: a second run stops at step 0.
--
-- Order:
--   Step 0  prerequisite checks (read-only; raises before anything is made)
--   Step 1  schema private, table public.games, indexes
--   Step 2  triggers on public.games (sections 1a-1i)
--   Step 3  public.apply_friend_move (friend-move Edge Function only)
--   Step 4  per-user locks, create / cancel / join RPCs, cleanup functions
--   Step 5  ALL grants, revokes and RLS (the only privileges section)
--   Step 6  realtime.messages policies
--   Step 7  pg_cron schedules (last, so jobs exist only if all else did)
--
-- Manual prerequisites (this file does NOT install or enable anything):
--   * pg_cron enabled in Dashboard -> Database -> Extensions
--   * pgcrypto installed in schema "extensions" (the Supabase default)
-- Dashboard settings and the Edge Function deploy are separate steps.
-- Verification queries live in supabase/tests/friend_mode_checks.sql.

-- #####################################################################
-- Step 0: prerequisites (checks only; nothing is created or changed)
-- #####################################################################

do $$
declare
  v_jobs boolean;
begin
  -- hashtextextended needs 11+, core gen_random_uuid() needs 13+
  if current_setting('server_version_num')::int < 130000 then
    raise exception 'friend mode migration: PostgreSQL 13 or later is required';
  end if;

  -- definer functions and cron jobs must be owned by / run as postgres
  if current_user <> 'postgres' then
    raise exception 'friend mode migration: run as role postgres, not %', current_user;
  end if;

  -- pgcrypto: the join-code generator calls extensions.gen_random_bytes
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    raise exception 'friend mode migration: extension pgcrypto is required';
  end if;
  -- For every Supabase schema used below, existence and USAGE come FIRST:
  -- without USAGE, to_regclass()/to_regprocedure() raise "permission
  -- denied for schema" instead of returning NULL. Separate IFs throughout:
  -- SQL does not guarantee left-to-right evaluation of OR, and
  -- has_schema_privilege() raises if the schema does not exist.
  if to_regnamespace('extensions') is null then
    raise exception 'friend mode migration: pgcrypto is installed, but schema '
      '"extensions" does not exist';
  end if;
  if not has_schema_privilege(current_user, 'extensions', 'USAGE') then
    raise exception 'friend mode migration: postgres needs USAGE on schema extensions';
  end if;
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'friend mode migration: pgcrypto is installed, but not in '
      'schema "extensions" (extensions.gen_random_bytes(integer) not found)';
  end if;

  -- pg_cron: must already be enabled by an administrator (Dashboard ->
  -- Database -> Extensions). This migration never installs it.
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'friend mode migration: extension pg_cron is not enabled. '
      'Enable it in Dashboard -> Database -> Extensions, then run again';
  end if;
  if to_regnamespace('cron') is null then
    raise exception 'friend mode migration: schema cron is missing (pg_cron)';
  end if;
  if not has_schema_privilege(current_user, 'cron', 'USAGE') then
    raise exception 'friend mode migration: postgres needs USAGE on schema cron';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'friend mode migration: cron.schedule(text,text,text) not found';
  end if;
  -- cron.schedule() silently REPLACES a job with the same name
  execute 'select exists (select 1 from cron.job where jobname like ''safe-chess-%'')'
    into v_jobs;
  if v_jobs then
    raise exception 'friend mode migration: safe-chess-* cron jobs already exist';
  end if;

  -- Supabase Auth objects, one step per IF: schema, USAGE, table, column,
  -- functions. auth.users is only looked up through to_regclass() and only
  -- after the table is known to exist: a typed 'auth.users'::regclass
  -- literal would be resolved when the statement is parsed and raise if
  -- the table were missing.
  if to_regnamespace('auth') is null then
    raise exception 'friend mode migration: schema auth is missing '
      '(Supabase Auth objects missing)';
  end if;
  if not has_schema_privilege(current_user, 'auth', 'USAGE') then
    raise exception 'friend mode migration: postgres needs USAGE on schema auth';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'friend mode migration: Supabase Auth objects missing (auth.users)';
  end if;
  if not exists (select 1 from pg_attribute
                  where attrelid = to_regclass('auth.users')
                    and attname = 'is_anonymous'
                    and attnum > 0
                    and not attisdropped) then
    raise exception 'friend mode migration: Supabase Auth objects missing '
      '(auth.users.is_anonymous)';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'friend mode migration: Supabase Auth objects missing (auth.uid())';
  end if;
  if to_regprocedure('auth.jwt()') is null then
    raise exception 'friend mode migration: Supabase Auth objects missing (auth.jwt())';
  end if;

  -- Supabase Realtime objects (schema and USAGE first, as above)
  if to_regnamespace('realtime') is null then
    raise exception 'friend mode migration: schema realtime is missing '
      '(Supabase Realtime objects missing)';
  end if;
  if not has_schema_privilege(current_user, 'realtime', 'USAGE') then
    raise exception 'friend mode migration: postgres needs USAGE on schema realtime';
  end if;
  if to_regclass('realtime.messages') is null
  or to_regprocedure('realtime.topic()') is null
  or to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    raise exception 'friend mode migration: Supabase Realtime objects missing '
      '(realtime.messages, realtime.topic(), realtime.send(jsonb,text,text,boolean))';
  end if;

  -- Topic isolation: the game_channel_* policies (Step 6) only take effect
  -- if row level security is ENABLED on realtime.messages. With RLS off
  -- they are inert and every authenticated client could read every topic,
  -- so stop here. This migration does not enable it: the table belongs to
  -- Supabase Realtime.
  if not coalesce((select c.relrowsecurity
                     from pg_class c
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'realtime' and c.relname = 'messages'), false) then
    raise exception 'friend mode migration: row level security is not enabled on '
      'realtime.messages, so the game_channel_* policies would not isolate games';
  end if;

  -- Game notifications: private.games_broadcast (SECURITY DEFINER, so it
  -- runs as postgres) calls realtime.send, which is SECURITY INVOKER,
  -- inserts into realtime.messages and turns its own errors into a
  -- WARNING, so a missing capability would silently drop every
  -- notification. Read-only catalog checks (no test write):
  --   a. USAGE on schema realtime and EXECUTE on realtime.send;
  --   b. the columns realtime.send writes exist and postgres may INSERT
  --      them (table or column privilege);
  --   c. RLS on realtime.messages (enabled, checked above) does not apply
  --      to postgres: BYPASSRLS, or acting as owner without FORCE.
  -- If RLS applies, an INSERT policy MIGHT still allow postgres, but a
  -- policy expression is only evaluated by a real insert, so this stops
  -- (fail safe) for a manual review. NOT provable here, only by a
  -- functional test on a compatible Supabase instance: realtime.send's
  -- own code (search_path, object names, error handling), triggers on
  -- realtime.messages, today's partition, and delivery to clients.
  if not has_schema_privilege('realtime', 'usage')
  or not has_function_privilege('realtime.send(jsonb,text,text,boolean)', 'execute') then
    raise exception 'friend mode migration: postgres needs USAGE on schema realtime '
      'and EXECUTE on realtime.send(jsonb,text,text,boolean)';
  end if;
  if (select count(*) from pg_attribute a
       where a.attrelid = 'realtime.messages'::regclass
         and a.attname in ('id', 'payload', 'event', 'topic', 'private', 'extension')
         and a.attnum > 0
         and not a.attisdropped) <> 6 then
    raise exception 'friend mode migration: realtime.messages lacks a column that '
      'realtime.send writes (id, payload, event, topic, private, extension)';
  end if;
  if not coalesce((select bool_and(has_column_privilege('realtime.messages', col, 'insert'))
                     from unnest(array['id', 'payload', 'event', 'topic',
                                       'private', 'extension']) as col), false) then
    raise exception 'friend mode migration: postgres may not INSERT the columns '
      'that realtime.send writes into realtime.messages';
  end if;
  if not coalesce((select r.rolbypassrls
                       or (pg_has_role(current_user, c.relowner, 'usage')
                           and not c.relforcerowsecurity)
                     from pg_class c
                     join pg_roles r on r.rolname = current_user
                    where c.oid = 'realtime.messages'::regclass), false) then
    raise exception 'friend mode migration: RLS on realtime.messages applies to '
      'postgres (no BYPASSRLS, not acting as owner). Whether an INSERT policy '
      'allows it cannot be proven without a test insert: review the policies '
      'by hand before continuing';
  end if;
  if (select count(*) from pg_roles
       where rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception 'friend mode migration: roles anon, authenticated, service_role required';
  end if;

  -- nothing of this feature may exist yet (an older draft function with a
  -- different signature would otherwise survive as a callable overload)
  if to_regnamespace('private') is not null
  or to_regclass('public.games') is not null
  or exists (select 1 from pg_proc
              where proname in ('create_friend_game', 'cancel_friend_game',
                                'join_friend_game', 'apply_friend_move')) then
    raise exception 'friend mode migration: friend-mode objects already exist';
  end if;
end $$;

-- #####################################################################
-- Step 1: design §A, schema, table, indexes
-- #####################################################################

create schema private;   -- privileges: Step 5

create table public.games (
  id          uuid        primary key default pg_catalog.gen_random_uuid(),  -- core, not pgcrypto
  join_code   text        not null unique                   -- generated by the INSERT trigger
                          check (join_code ~ '^[2-9A-HJKMNP-TV-Z]{8}$'),
  status      text        not null default 'waiting'
                          check (status in ('waiting','active','finished','expired')),
  white_id    uuid        not null references auth.users(id) on delete cascade,   -- creator
  black_id    uuid                 references auth.users(id) on delete cascade,   -- joiner
  moves       text[]      not null default '{}',
  fen         text        not null
                          default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
                          check (length(fen) <= 100),
  version     integer     not null default 0,
  end_reason  text        check (end_reason in
                          ('checkmate','stalemate','insufficient','repetition','fifty-move','expired')),
  winner      text        check (winner in ('w','b')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  ended_at    timestamptz,

  constraint games_version_exact         check (version = cardinality(moves)
                                                  + (case when black_id is not null then 1 else 0 end)
                                                  + (case when status = 'expired'   then 1 else 0 end)),
  constraint games_distinct_players      check (black_id is null or black_id <> white_id),
  constraint games_waiting_shape         check (status <> 'waiting' or (black_id is null and version = 0)),
  constraint games_playing_shape         check (status not in ('active','finished') or black_id is not null),
  constraint games_ended_shape           check ((status in ('finished','expired'))
                                                = (ended_at is not null and end_reason is not null)),
  constraint games_expired_reason        check ((status = 'expired') = (end_reason is not distinct from 'expired')),
  constraint games_winner_only_mate      check ((winner is not null) = (end_reason is not distinct from 'checkmate'))
);

-- Indexes (PK index on id and UNIQUE index on join_code are automatic)
create unique index games_one_waiting_per_user on public.games (white_id) where status = 'waiting';
create index games_expiry_idx on public.games (status, expires_at);
create index games_ended_idx  on public.games (ended_at) where ended_at is not null;
create index games_white_idx  on public.games (white_id);
create index games_black_idx  on public.games (black_id);

-- #####################################################################
-- Step 2: triggers on public.games (from step7-1-triggers.sql v3)
-- Requires: schema private, table public.games (Step 1).
-- #####################################################################

-- ---------------------------------------------------------------------
-- 1a. Shared constant: the start position
-- ---------------------------------------------------------------------
create function private.start_fen()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'rnbqkbnr/pppppppp/8/8/8/8/'
      || 'PPPPPPPP/RNBQKBNR w KQkq - 0 1';
$$;

-- ---------------------------------------------------------------------
-- 1a2. Join-code generator (called ONLY by the INSERT guard)
--      8 chars, alphabet without 0 O 1 I L U, CSPRNG with rejection
--      sampling; skips codes already in use. The UNIQUE constraint
--      games_join_code_key is the final guarantee; create_friend_game()
--      retries the INSERT on a collision, which re-runs this.
-- ---------------------------------------------------------------------
create function private.generate_join_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_abc constant text :=
        '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code  text;
  v_bytes bytea;
  v_b     int;
begin
  for attempt in 1..5 loop
    v_code := '';
    while length(v_code) < 8 loop
      v_bytes := extensions.gen_random_bytes(16);
      for i in 0..15 loop
        v_b := get_byte(v_bytes, i);
        if v_b < 240 and length(v_code) < 8 then
          v_code := v_code
            || substr(v_abc, (v_b % 30) + 1, 1);
        end if;
      end loop;
    end loop;
    if not exists (select 1 from public.games g
                   where g.join_code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'games: could not generate join code';
end $$;

-- ---------------------------------------------------------------------
-- 1b. INSERT guard: a new row must be a fresh waiting game,
--     created by the calling anonymous user, with a server-generated
--     join code
-- ---------------------------------------------------------------------
create function private.games_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- creator must be the calling anonymous browser user
  -- (auth.uid()/auth.jwt() read request.jwt.claims, set by
  --  PostgREST from the verified token; SECURITY DEFINER in
  --  create_friend_game() does not change them)
  if auth.uid() is null
  or (auth.jwt() ->> 'role') is distinct from 'authenticated'
  or coalesce((auth.jwt() ->> 'is_anonymous')::boolean,
              false) is not true then
    raise exception 'games: insert requires anonymous user';
  end if;
  if new.white_id is distinct from auth.uid() then
    raise exception 'games: white_id must be auth.uid()';
  end if;

  -- join code is generated here, never supplied
  if new.join_code is not null then
    raise exception 'games: join_code is server-generated';
  end if;
  new.join_code := private.generate_join_code();

  if new.status <> 'waiting' then
    raise exception 'games: insert status must be waiting';
  end if;
  if new.black_id is not null then
    raise exception 'games: insert black_id must be null';
  end if;
  if new.moves is distinct from '{}'::text[] then
    raise exception 'games: insert moves must be empty';
  end if;
  if new.version <> 0 then
    raise exception 'games: insert version must be 0';
  end if;
  if new.fen is distinct from private.start_fen() then
    raise exception 'games: insert fen must be start fen';
  end if;
  if new.end_reason is not null
  or new.winner     is not null
  or new.ended_at   is not null then
    raise exception 'games: insert result fields must be null';
  end if;

  -- server-owned timestamps: always overwritten
  new.created_at := now();
  new.updated_at := now();
  new.expires_at := now() + interval '15 minutes';
  return new;
end $$;

create trigger games_guard_insert
  before insert on public.games
  for each row
  execute function private.games_guard_insert();

-- ---------------------------------------------------------------------
-- 1c. UPDATE guard
-- ---------------------------------------------------------------------
create function private.games_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n_old  int  := cardinality(old.moves);
  mover  text := split_part(old.fen, ' ', 2);
  t_join boolean;
  t_move boolean;
  t_exp  boolean;
begin
  ------------------------------------------------
  -- 1. columns that can NEVER change
  ------------------------------------------------
  if new.id is distinct from old.id then
    raise exception 'games: id is immutable';
  end if;
  if new.join_code is distinct from old.join_code then
    raise exception 'games: join_code is immutable';
  end if;
  if new.white_id is distinct from old.white_id then
    raise exception 'games: white_id is immutable';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'games: created_at is immutable';
  end if;

  ------------------------------------------------
  -- 2. allowed status transitions (whitelist)
  ------------------------------------------------
  t_join := old.status = 'waiting'
        and new.status = 'active';
  t_move := old.status = 'active'
        and new.status in ('active', 'finished');
  t_exp  := old.status in ('waiting', 'active')
        and new.status = 'expired';

  if not (t_join or t_move or t_exp) then
    raise exception 'games: illegal transition % -> %',
      old.status, new.status;
  end if;

  ------------------------------------------------
  -- 2b. version: EVERY authoritative change is +1
  --     (join, move, finish, expiry)
  ------------------------------------------------
  if new.version is distinct from old.version + 1 then
    raise exception 'games: version must be old + 1';
  end if;

  ------------------------------------------------
  -- 3. black_id: set exactly once, only on join
  ------------------------------------------------
  if new.black_id is distinct from old.black_id
     and not t_join then
    raise exception 'games: black_id is immutable';
  end if;

  ------------------------------------------------
  -- 4a. JOIN: waiting -> active
  ------------------------------------------------
  if t_join then
    -- joiner must be the calling anonymous browser user
    -- (same rule as white_id in 1b; auth.uid()/auth.jwt() come
    --  from the verified token even inside SECURITY DEFINER
    --  join_friend_game())
    if auth.uid() is null
    or (auth.jwt() ->> 'role') is distinct from 'authenticated'
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean,
                false) is not true then
      raise exception 'games: join requires anonymous user';
    end if;
    if new.black_id is distinct from auth.uid() then
      raise exception 'games: black_id must be auth.uid()';
    end if;
    if old.black_id is not null then
      raise exception 'games: seat already taken';
    end if;
    if new.black_id is null
    or new.black_id = new.white_id then
      raise exception 'games: invalid black_id';
    end if;
    if old.expires_at <= now() then
      raise exception 'games: waiting game expired';
    end if;
    if new.moves   is distinct from old.moves
    or new.fen     is distinct from old.fen then
      raise exception 'games: join cannot change position';
    end if;
    if new.end_reason is not null
    or new.winner     is not null
    or new.ended_at   is not null then
      raise exception 'games: join cannot set a result';
    end if;
    if new.expires_at
       is distinct from now() + interval '24 hours' then
      raise exception 'games: join expires_at must be now()+24h';
    end if;
  end if;

  ------------------------------------------------
  -- 4b. MOVE: active -> active | finished
  ------------------------------------------------
  if t_move then
    if old.expires_at <= now() then
      raise exception 'games: active game expired';
    end if;

    -- exactly ONE move appended
    if cardinality(new.moves) <> n_old + 1 then
      raise exception 'games: must append exactly one move';
    end if;

    -- earlier moves identical, same order
    -- (blocks edit / delete / reorder)
    if new.moves[1:n_old] is distinct from old.moves then
      raise exception 'games: earlier moves cannot change';
    end if;

    -- appended move is well-formed UCI
    if new.moves[n_old + 1] is null
    or new.moves[n_old + 1]
       !~ '^[a-h][1-8][a-h][1-8][qrbn]?$' then
      raise exception 'games: bad move format';
    end if;

    -- version is exactly +1 (also enforced in 2b)
    if new.version is distinct from old.version + 1 then
      raise exception 'games: version must be old + 1';
    end if;

    -- side to move must flip
    if split_part(new.fen, ' ', 2)
       is distinct from
       (case mover when 'w' then 'b' else 'w' end) then
      raise exception 'games: side to move must flip';
    end if;

    if new.expires_at
       is distinct from now() + interval '24 hours' then
      raise exception 'games: move expires_at must be now()+24h';
    end if;

    if new.status = 'active' then
      if new.end_reason is not null
      or new.winner     is not null
      or new.ended_at   is not null then
        raise exception 'games: active game has no result';
      end if;
    else  -- 'finished'
      if new.end_reason is null
      or new.end_reason not in
         ('checkmate', 'stalemate', 'insufficient',
          'repetition', 'fifty-move') then
        raise exception 'games: invalid end_reason for finish';
      end if;
      if new.end_reason = 'checkmate' then
        if new.winner is distinct from mover then
          raise exception 'games: winner must be the mover';
        end if;
      elsif new.winner is not null then
        raise exception 'games: winner only on checkmate';
      end if;
      if new.ended_at is distinct from now() then
        raise exception 'games: ended_at must be now()';
      end if;
    end if;
  end if;

  ------------------------------------------------
  -- 4c. EXPIRE: waiting | active -> expired
  ------------------------------------------------
  if t_exp then
    if old.expires_at > now() then
      raise exception 'games: not yet expired';
    end if;
    if new.moves   is distinct from old.moves
    or new.fen     is distinct from old.fen then
      raise exception 'games: expiry cannot change position';
    end if;
    if new.end_reason is distinct from 'expired'
    or new.winner     is not null then
      raise exception 'games: expiry result must be expired/null';
    end if;
    if new.ended_at is distinct from now() then
      raise exception 'games: ended_at must be now()';
    end if;
    if new.expires_at is distinct from old.expires_at then
      raise exception 'games: expiry cannot move expires_at';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger games_guard_update
  before update on public.games
  for each row
  execute function private.games_guard_update();

-- ---------------------------------------------------------------------
-- 1d. DELETE guard
--     active: never deletable
--     finished / expired: only 1 hour after ended_at
--     waiting: deletable (cancel / re-create)
-- ---------------------------------------------------------------------
create function private.games_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'active' then
    raise exception 'games: active game cannot be deleted';
  end if;
  if old.status in ('finished', 'expired')
     and old.ended_at > now() - interval '1 hour' then
    raise exception 'games: retained for 1 hour after end';
  end if;
  return old;
end $$;

create trigger games_guard_delete
  before delete on public.games
  for each row
  execute function private.games_guard_delete();

-- ---------------------------------------------------------------------
-- 1e. TRUNCATE guard (TRUNCATE skips row triggers)
-- ---------------------------------------------------------------------
create function private.games_no_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'games: truncate is not allowed';
end $$;

create trigger games_no_truncate
  before truncate on public.games
  for each statement
  execute function private.games_no_truncate();

-- ---------------------------------------------------------------------
-- 1f. Notification trigger (writes nothing to public.games)
--     Sends a MINIMAL event: game id, version and operation. Never row
--     data: no join_code, player ids, fen or moves. Clients re-read the
--     row through the games_select_players policy.
--     The payload key is game_id, not id: realtime.send adds its own "id"
--     (a fresh UUID) only when the payload has none.
--     Only the send is wrapped. If the call itself fails (for example a
--     missing function or privilege), the error becomes a WARNING with the
--     operation, SQLSTATE and message, never row data, and the game change
--     or cleanup job goes on. realtime.send already turns its own errors
--     into WARNING WarnSendingBroadcastMessage.
--     Cost: two subtransactions per changed row (this block and the one
--     inside realtime.send); the cleanup jobs are bounded for that (4e).
-- ---------------------------------------------------------------------
create function private.games_broadcast()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object(
        'game_id', coalesce(new.id, old.id),
        'version', coalesce(new.version, old.version),
        'op',      tg_op),
      tg_op,                                      -- event: UPDATE | DELETE
      'game:' || coalesce(new.id, old.id)::text,  -- topic
      true);                                      -- private channels only
  exception when others then
    raise warning 'games_broadcast: % notification not sent: % %',
      tg_op, sqlstate, sqlerrm;
  end;
  return null;
end $$;

create trigger games_broadcast
  after update or delete on public.games
  for each row
  execute function private.games_broadcast();

-- ---------------------------------------------------------------------
-- 1g. Privileges of these functions: Step 5 (owner-only)
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1h. Table CHECK constraints (defined in CREATE TABLE) that also
--     enforce result rules:
--   check (end_reason in ('checkmate','stalemate','insufficient',
--                         'repetition','fifty-move','expired'))
--   check (winner in ('w','b'))
--   check (version = cardinality(moves)
--          + (case when black_id is not null then 1 else 0 end)
--          + (case when status = 'expired'   then 1 else 0 end))
--     (constraint games_version_exact; version sequence:
--      create 0, join 1, first move 2, each later move +1,
--      expiry +1, a finishing move is its own +1)
--   check ((status in ('finished','expired'))
--          = (ended_at is not null and end_reason is not null))
--   check ((status = 'expired')
--          = (end_reason is not distinct from 'expired'))
--   check ((winner is not null)
--          = (end_reason is not distinct from 'checkmate'))
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1i. Attack -> blocking rule
--   change white_id ................ 1c section 1
--   change black_id after set ...... 1c section 3 + 4a
--   choose / forge black_id ........ 1c 4a black_id = auth.uid(), anonymous,
--                                    role authenticated (service_role,
--                                    pg_cron, dashboard cannot join)
--   change join_code ............... 1c section 1
--   change created_at .............. 1c section 1 (1b overwrites on insert)
--   forge white_id on insert ....... 1b white_id = auth.uid(), anonymous,
--                                    role authenticated
--   supply / choose join_code ...... 1b rejects non-NULL, generates it
--   change an earlier move ......... 1c 4b prefix check moves[1:n_old]
--   delete a move .................. 1c 4b cardinality = n_old + 1 + prefix
--   reorder moves .................. 1c 4b prefix check
--   append 0 or 2+ moves ........... 1c 4b cardinality = n_old + 1
--   moves change outside a move .... 1c 4a / 4c
--   version other than +1 .......... 1c 2b (every update); CHECK
--   invalid status transition ...... 1c section 2 whitelist
--   invalid winner / end_reason .... 1c 4b / 4c + CHECKs (1h)
--   fake timestamps ................ 1b overwrites; 1c exact now() rules
--   delete an active game .......... 1d
--   TRUNCATE ....................... 1e + no TRUNCATE privilege
-- ---------------------------------------------------------------------

-- #####################################################################
-- Step 3: public.apply_friend_move (from step7-2-apply_friend_move.sql v3)
-- #####################################################################

-- =====================================================================
-- SECURITY DEFINER (v3, audit B1): service_role has NO table
--   privileges on public.games, so the function runs with the table
--   owner's rights. The gate is EXECUTE, granted only to service_role
--   (used only by the friend-move Edge Function). Inside, check A
--   additionally requires the request's verified token role to be
--   service_role (current_user is the owner under DEFINER, so it can
--   no longer be used for that check).
-- search_path = '': every object is schema-qualified (public.games).
-- The UPDATE below is additionally checked by every trigger in Step 2.
--
-- p_uid comes ONLY from supabase.auth.getUser(jwt) in the friend-move
-- Edge Function (token verified by Supabase Auth); the browser request
-- body is exactly { gameId, expectedVersion, uci } and has no identity.
-- p_new_fen / p_end_reason / p_winner are computed by chess.js in the
-- Edge Function, never taken from the browser.
--
-- version = every authoritative state change (create 0, join 1,
-- first move 2, each later move +1, expiry +1). p_expected_version
-- is therefore the client's current STATE version: the first move
-- is sent with expectedVersion = 1. This function's code is
-- unchanged by that; it writes version + 1 and the update trigger
-- requires exactly +1.
-- =====================================================================

create function public.apply_friend_move(
  p_game             uuid,
  p_uid              uuid,
  p_expected_version int,
  p_uci              text,
  p_new_fen          text,
  p_end_reason       text,
  p_winner           text)
returns table (result text, game jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  o       public.games;  -- locked row, before
  n       public.games;  -- row after update
  v_side  text;          -- side to move before
  v_next  text;          -- side to move after
  o_half  int;
  o_full  int;
  n_half  int;
  n_full  int;
begin
  ----------------------------------------------
  -- A. caller must be the server role
  ----------------------------------------------
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'apply_friend_move: forbidden';
  end if;

  ----------------------------------------------
  -- B. shape of every input
  ----------------------------------------------
  if p_game is null or p_uid is null
  or p_expected_version is null
  or p_expected_version < 0 then
    raise exception 'apply_friend_move: bad arguments';
  end if;
  if p_uci is null
  or p_uci !~ '^[a-h][1-8][a-h][1-8][qrbn]?$' then
    raise exception 'apply_friend_move: bad uci';
  end if;
  -- Shape check only; the position itself comes from chess.js in the Edge
  -- Function. Castling field: '-' or a non-empty subset of KQkq in that
  -- order. The four branches cover the 15 subsets by their first letter:
  -- K... (8), Q... (4), k... (2), q (1). Tested in migration.test.ts.
  if p_new_fen is null
  or p_new_fen !~ (
       '^[1-8pnbrqkPNBRQK/]{15,71} [wb] '
    || '(-|KQ?k?q?|Qk?q?|kq?|q) (-|[a-h][36]) '
    || '[0-9]{1,4} [0-9]{1,5}$') then
    raise exception 'apply_friend_move: bad fen';
  end if;
  if p_end_reason is not null
  and p_end_reason not in
      ('checkmate', 'stalemate', 'insufficient',
       'repetition', 'fifty-move') then
    raise exception 'apply_friend_move: bad end_reason';
  end if;
  if p_winner is not null
  and p_winner not in ('w', 'b') then
    raise exception 'apply_friend_move: bad winner';
  end if;

  ----------------------------------------------
  -- C. LOCK the authoritative row
  ----------------------------------------------
  select * into o
    from public.games g
   where g.id = p_game
     for update;

  ----------------------------------------------
  -- D. MEMBERSHIP
  ----------------------------------------------
  if not found
  or (p_uid is distinct from o.white_id
      and p_uid is distinct from o.black_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  ----------------------------------------------
  -- E. game open (status transition source)
  ----------------------------------------------
  if o.status <> 'active'
  or o.expires_at <= now() then
    return query select 'not_active'::text, to_jsonb(o);
    return;
  end if;

  ----------------------------------------------
  -- F. VERSION CHECK (stale / replay)
  ----------------------------------------------
  if o.version <> p_expected_version then
    return query select 'stale'::text, to_jsonb(o);
    return;
  end if;

  ----------------------------------------------
  -- G. TURN CHECK (from the STORED fen)
  ----------------------------------------------
  v_side := split_part(o.fen, ' ', 2);
  if not (   (v_side = 'w' and p_uid = o.white_id)
          or (v_side = 'b' and p_uid = o.black_id)) then
    return query select 'not_your_turn'::text, to_jsonb(o);
    return;
  end if;

  ----------------------------------------------
  -- H. new FEN vs locked row
  ----------------------------------------------
  v_next := case v_side when 'w' then 'b' else 'w' end;
  if split_part(p_new_fen, ' ', 2) <> v_next then
    raise exception 'apply_friend_move: fen side to move';
  end if;

  o_half := split_part(o.fen, ' ', 5)::int;
  o_full := split_part(o.fen, ' ', 6)::int;
  n_half := split_part(p_new_fen, ' ', 5)::int;
  n_full := split_part(p_new_fen, ' ', 6)::int;

  if n_half not in (0, o_half + 1) then
    raise exception 'apply_friend_move: fen halfmove clock';
  end if;
  if n_full <> o_full
       + (case v_side when 'b' then 1 else 0 end) then
    raise exception 'apply_friend_move: fen fullmove number';
  end if;

  ----------------------------------------------
  -- I. WINNER / END_REASON
  ----------------------------------------------
  if p_end_reason = 'checkmate' then
    if p_winner is distinct from v_side then
      raise exception 'apply_friend_move: winner must be mover';
    end if;
  elsif p_winner is not null then
    raise exception 'apply_friend_move: winner only on mate';
  end if;

  ----------------------------------------------
  -- J. THE WRITE
  --    white_id / black_id / join_code / created_at
  --    are NOT in the SET list; history is append-only
  ----------------------------------------------
  update public.games g set
    moves      = g.moves || p_uci,
    version    = g.version + 1,
    fen        = p_new_fen,
    status     = case when p_end_reason is null
                      then 'active'
                      else 'finished' end,
    end_reason = p_end_reason,
    winner     = p_winner,
    ended_at   = case when p_end_reason is null
                      then null
                      else now() end,
    expires_at = now() + interval '24 hours'
  where g.id = p_game
    and g.version = p_expected_version   -- belt + braces
  returning g.* into n;

  if not found then
    raise exception 'apply_friend_move: lost row';
  end if;

  ----------------------------------------------
  -- K. POST-WRITE ASSERTIONS vs locked row
  ----------------------------------------------
  -- identity columns unchanged
  if n.id         is distinct from o.id
  or n.join_code  is distinct from o.join_code
  or n.white_id   is distinct from o.white_id
  or n.black_id   is distinct from o.black_id
  or n.created_at is distinct from o.created_at then
    raise exception 'apply_friend_move: identity changed';
  end if;

  -- exactly one move appended, prefix intact
  if cardinality(n.moves) <> cardinality(o.moves) + 1
  or n.moves[1:cardinality(o.moves)]
       is distinct from o.moves
  or n.moves[cardinality(n.moves)]
       is distinct from p_uci then
    raise exception 'apply_friend_move: history check';
  end if;

  -- version exactly +1
  if n.version <> o.version + 1 then
    raise exception 'apply_friend_move: version check';
  end if;

  -- allowed status transition
  if not (o.status = 'active'
          and n.status in ('active', 'finished')) then
    raise exception 'apply_friend_move: status check';
  end if;

  return query select 'ok'::text, to_jsonb(n);
  -- transaction commit releases the row lock
end $$;

-- ---------------------------------------------------------------------
-- Who can execute it (granted in Step 5)
--   public ........ NO
--   anon .......... NO   (browser, not signed in)
--   authenticated . NO   (browser, anonymous sign-in)
--   service_role .. YES  (only inside the friend-move Edge Function)
-- Even with a mistaken grant, step A rejects any request whose
-- verified token role is not service_role.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Second simultaneous move -> 'stale':
--   A and B both computed from version N.
--   A: SELECT ... FOR UPDATE gets the lock.
--   B: SELECT ... FOR UPDATE waits.
--   A: step F passes (N = N), writes N+1, commits, lock released.
--   B: gets the lock, reads the COMMITTED row (version N+1).
--   B: step F: N+1 <> N -> returns 'stale', writes nothing.
--
-- Replayed old request -> 'stale':
--   it carries the expectedVersion it was sent with; once that
--   version has been used the row is at >= N+1, so step F returns
--   'stale' (the Edge Function's own version check catches it first).
-- ---------------------------------------------------------------------

-- #####################################################################
-- Step 4: per-user locks, create / cancel / join RPCs, cleanup functions
-- (from step7-4-rpcs-and-cleanup.sql v1; these are the only bodies of
-- these functions -- earlier drafts in step7-design.md are superseded)
-- #####################################################################

-- =====================================================================
-- Global lock order for every function in this file (design D8.2):
--   (1) per-user advisory locks, ascending key order, taken BEFORE any
--       read-for-update, delete, insert or update of public.games
--   (2) at most one public.games row lock
--   (3) the insert / delete / update itself
-- The only public.games access before (1) is join's unlocked creator
-- lookup, which decides WHICH users to lock and nothing else.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4a. Per-user lock helpers (owner-only; revokes in Step 5)
-- ---------------------------------------------------------------------
create function private.user_lock_key(p_uid uuid)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select hashtextextended('safe-chess:user:' || p_uid::text, 0);
$$;

-- Takes the transaction-scoped locks of one or two users in ascending
-- key order. Equal keys (same user, or a hash collision) are locked
-- once. Released automatically at commit / rollback.
create function private.lock_users(p_a uuid, p_b uuid default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  k1 bigint := private.user_lock_key(p_a);
  k2 bigint := case when p_b is null then null
                    else private.user_lock_key(p_b) end;
begin
  if k2 is null or k1 = k2 then
    perform pg_advisory_xact_lock(k1);
  elsif k1 < k2 then
    perform pg_advisory_xact_lock(k1);
    perform pg_advisory_xact_lock(k2);
  else
    perform pg_advisory_xact_lock(k2);
    perform pg_advisory_xact_lock(k1);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4b. create_friend_game(p_leaving)
--   result: 'created' | 'existing' | 'already_joined'
--   p_leaving = id of the waiting game this client is currently showing
--   (or null). Locks: caller's user lock, then at most one game row.
-- ---------------------------------------------------------------------
create function public.create_friend_game(p_leaving uuid default null)
returns table (result text, id uuid, join_code text,
               expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v     public.games;
  v_con text;
begin
  -- authorization: an authenticated caller (the INSERT trigger further
  -- requires role 'authenticated' and an anonymous user)
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- (1) per-user lock FIRST
  perform private.lock_users(v_uid);

  -- (2a) the waiting game being left, if still open and the caller's
  if p_leaving is not null then
    select * into v
      from public.games g
     where g.id = p_leaving
       and g.white_id = v_uid
       and g.status in ('waiting', 'active')
       for update;

    if found then
      if v.status = 'active' then
        -- a friend joined first: create nothing, send the client there
        return query
          select 'already_joined'::text, v.id, v.join_code,
                 v.expires_at;
        return;
      end if;
      -- still waiting (expired or not): remove it
      delete from public.games g where g.id = v.id;
    end if;
  end if;

  -- (2b) the caller's remaining waiting game (unique index: at most one)
  --      Not reached with a second row lock: if (2a) deleted a waiting
  --      game, no other waiting game can exist for this creator.
  select * into v
    from public.games g
   where g.white_id = v_uid
     and g.status = 'waiting'
     for update;

  if found then
    if v.expires_at > now() then
      -- duplicate tap / retry after a lost response: same game
      return query
        select 'existing'::text, v.id, v.join_code, v.expires_at;
      return;
    end if;
    delete from public.games g where g.id = v.id;   -- stale waiting row
  end if;

  -- (3) insert; the BEFORE INSERT trigger checks white_id = auth.uid(),
  --     the anonymous authenticated caller, and generates join_code
  for attempt in 1..5 loop
    begin
      return query
        insert into public.games (white_id)
        values (v_uid)
        returning 'created'::text, games.id, games.join_code,
                  games.expires_at;
      return;
    exception when unique_violation then
      get stacked diagnostics v_con = constraint_name;
      if v_con is distinct from 'games_join_code_key' then
        raise;   -- e.g. games_one_waiting_per_user: a bug, never hidden
      end if;    -- join code clash: the trigger makes a new code
    end;
  end loop;
  raise exception 'code_generation_failed';
end $$;

-- ---------------------------------------------------------------------
-- 4c. cancel_friend_game(p_game)
--   result: 'cancelled' | 'already_joined' | 'ended' | 'not_found'
--   Locks: caller's user lock, then the one game row.
-- ---------------------------------------------------------------------
create function public.cancel_friend_game(p_game uuid)
returns table (result text, game_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v     public.games;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- (1) per-user lock FIRST
  perform private.lock_users(v_uid);

  -- (2) the caller's own game only (authorization: white_id = caller)
  select * into v
    from public.games g
   where g.id = p_game
     and g.white_id = v_uid
     for update;

  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  if v.status = 'waiting' then
    delete from public.games g where g.id = v.id;
    return query select 'cancelled'::text, v.id;
  elsif v.status = 'active' then
    -- a friend joined first: nothing is deleted
    return query select 'already_joined'::text, v.id;
  else
    return query select 'ended'::text, v.id;     -- finished / expired
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4d. join_friend_game(p_code)
--   result: 'ok' | 'invalid' | 'expired' | 'own_game' | 'unavailable'
--   Locks: creator's and joiner's user locks (ascending key order),
--   then the game row via the conditional UPDATE.
-- ---------------------------------------------------------------------
create function public.join_friend_game(p_code text)
returns table (result text, game_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_code    text := upper(regexp_replace(coalesce(p_code, ''),
                                         '[\s-]', '', 'g'));
  v_creator uuid;
  v         public.games;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if v_code !~ '^[2-9A-HJKMNP-TV-Z]{8}$' then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  -- (0) UNLOCKED lookup: only to learn which creator to lock.
  --     Nothing is decided from this read.
  select g.white_id into v_creator
    from public.games g
   where g.join_code = v_code;

  if not found then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  -- (1) both users' locks, deterministic (ascending key) order
  perform private.lock_users(v_creator, v_uid);

  -- (2) atomic seat claim, revalidating EVERYTHING against the
  --     committed row: same code, same creator (whose lock we hold),
  --     still waiting, seat empty, not expired, not the creator.
  --     The UPDATE trigger additionally requires
  --     black_id = auth.uid() of an anonymous authenticated caller.
  update public.games g
     set status     = 'active',
         black_id   = v_uid,
         version    = g.version + 1,
         expires_at = now() + interval '24 hours'
   where g.join_code  = v_code
     and g.white_id   = v_creator
     and g.status     = 'waiting'
     and g.black_id   is null
     and g.expires_at > now()
     and g.white_id   <> v_uid
  returning g.* into v;

  if found then
    return query select 'ok'::text, v.id;
    return;
  end if;

  -- (3) classify: a new statement, so it sees everything committed
  --     while this transaction waited for the locks
  select * into v
    from public.games g
   where g.join_code = v_code;

  if not found then
    -- the game was cancelled / replaced / deleted meanwhile
    return query select 'invalid'::text, null::uuid;

  elsif v.white_id is distinct from v_creator then
    -- the code now names a DIFFERENT creator's game (the original was
    -- deleted and the code was randomly regenerated in between). This
    -- transaction does not hold that creator's lock, and must not take
    -- it now (that would break the sorted lock order), so it reports
    -- the original game as gone. The client may simply try again.
    return query select 'invalid'::text, null::uuid;

  elsif v.status in ('active', 'finished')
    and v_uid in (v.white_id, v.black_id) then
    -- a seated player reconnecting
    return query select 'ok'::text, v.id;

  elsif v.status = 'expired'
     or (v.status = 'waiting' and v.expires_at <= now()) then
    return query select 'expired'::text, null::uuid;

  elsif v.status = 'waiting' and v.white_id = v_uid then
    return query select 'own_game'::text, null::uuid;

  else
    -- Black already taken / active / finished, caller not seated
    return query select 'unavailable'::text, null::uuid;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4e. Cleanup: TWO independent pg_cron jobs (design B5, v9; the
--     anonymous-user cleanup job of v9 is not part of this version)
--
--   Each pg_cron job runs in its OWN transaction. A failure in one job
--   rolls back only that job's work; the other jobs are unaffected, and
--   the failure is visible in cron.job_run_details. Every job retries on
--   its next run (every 5 minutes).
--
--   No job takes a per-user lock: job 1 and job 2 never touch them.
--   Each job's own "one run at a time" lock is try-only.
--
--   Bounds per run:
--     job 1 and job 2 handle at most 25 rows, oldest first. The trigger
--     on public.games uses two subtransactions per row (50 in all),
--     below PostgreSQL's 64 cached per transaction. The row conditions
--     are repeated outside the bounded subquery, so a row changed by a
--     concurrent move, join or cancel is re-checked against its current
--     version and skipped if no longer eligible.
--   Lock waits: job 1 and job 2 run with lock_timeout = 5s (function SET
--   clause, restored when the function returns). A longer wait raises
--   SQLSTATE 55P03 and aborts the WHOLE run: every row of the batch and
--   its notifications roll back, pg_cron records the run as failed in
--   cron.job_run_details and the error goes to the Postgres log. The next
--   run, 5 minutes later, starts the batch again and fails the same way
--   while the lock is held: progress is NOT guaranteed while a row stays
--   locked.
-- ---------------------------------------------------------------------

-- job 1: expire overdue waiting / active games
create function private.expire_friend_games()
returns void
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if not pg_try_advisory_xact_lock(
       hashtextextended('safe-chess:job:expire', 0)) then
    return;                                 -- previous run still busy
  end if;

  update public.games g
     set status     = 'expired',
         end_reason = 'expired',
         ended_at   = now(),
         version    = g.version + 1
   where g.id in (select x.id
                    from public.games x
                   where x.status in ('waiting', 'active')
                     and x.expires_at <= now()
                   order by x.expires_at
                   limit 25)
     and g.status in ('waiting', 'active')
     and g.expires_at <= now();
end $$;

-- job 2: delete finished / expired games 1 hour after they ended
create function private.delete_ended_friend_games()
returns void
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if not pg_try_advisory_xact_lock(
       hashtextextended('safe-chess:job:delete-ended', 0)) then
    return;
  end if;

  delete from public.games g
   where g.id in (select x.id
                    from public.games x
                   where x.status in ('finished', 'expired')
                     and x.ended_at <= now() - interval '1 hour'
                   order by x.ended_at
                   limit 25)
     and g.status in ('finished', 'expired')
     and g.ended_at <= now() - interval '1 hour';
end $$;

-- The schedules for these two functions are created in Step 7.

-- #####################################################################
-- Step 5: ALL grants, revokes and RLS (from step7-3-grants-rls.sql v5)
-- This is the only privileges section of the migration.
-- #####################################################################

-- =====================================================================
-- QUESTION: Can an authenticated/anonymous browser user modify ANY
-- authoritative column of public.games directly through PostgREST,
-- even bypassing the app UI?
--
-- ANSWER: NO. Every browser request runs as role anon or authenticated
-- (PostgREST and Supabase GraphQL use the same roles). Those roles
-- have only the rights granted below.
--
-- v3 changes:
--   B1  service_role has NO table privileges on public.games.
--   M6  no project-wide ALTER DEFAULT PRIVILEGES. Instead, every object
--       of this feature revokes explicitly from public, anon,
--       authenticated and service_role (Supabase's default privileges
--       would otherwise grant them), then grants only what is needed.
--   I3  create_friend_game now takes (p_leaving uuid default null).
--   v4  per-user advisory-lock helpers (design D8) are owner-only.
--   v5  cleanup is three pg_cron jobs (Step 4 §4e); cancel_friend_game
--       now returns (result, game_id).
--   v6  the anonymous-user cleanup job and its function are removed:
--       cleanup is two pg_cron jobs, and nothing here deletes users.
-- =====================================================================

-- private schema: not exposed in the API, no access for any API role
revoke all on schema private
  from public, anon, authenticated, service_role;

-- table: read-only for signed-in users; NOTHING for anon or service_role
revoke all on table public.games
  from public, anon, authenticated, service_role;
grant select on table public.games
  to authenticated;

-- RLS: only a SELECT policy exists
alter table public.games enable row level security;
-- (no FORCE: the SECURITY DEFINER functions run as the table owner and
--  are themselves constrained by the triggers in Step 2)

create policy games_select_players
  on public.games
  for select
  to authenticated
  using ((select auth.uid()) in (white_id, black_id));

-- INSERT: no policy -> denied
-- UPDATE: no policy -> denied
-- DELETE: no policy -> denied

-- Browser RPCs: signed-in (anonymous) users only
revoke all on function public.create_friend_game(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.join_friend_game(text)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_friend_game(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_friend_game(uuid)
  to authenticated;
grant execute on function public.join_friend_game(text)
  to authenticated;
grant execute on function public.cancel_friend_game(uuid)
  to authenticated;

-- Server move: friend-move Edge Function only (Step 3)
revoke all on function public.apply_friend_move(
  uuid, uuid, int, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_friend_move(
  uuid, uuid, int, text, text, text, text)
  to service_role;

-- Cleanup jobs: run only by pg_cron as the owner; no API role may call them
revoke all on function private.expire_friend_games()
  from public, anon, authenticated, service_role;
revoke all on function private.delete_ended_friend_games()
  from public, anon, authenticated, service_role;

-- Per-user lock helpers (design D8): used only inside the owner-run
-- create/cancel/join functions
revoke all on function private.user_lock_key(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.lock_users(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Trigger and helper functions (Step 2): owner-only
revoke all on function
  private.start_fen(),
  private.generate_join_code(),
  private.games_guard_insert(),
  private.games_guard_update(),
  private.games_guard_delete(),
  private.games_no_truncate(),
  private.games_broadcast()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- B1: why the intended server-side operations still work although
-- service_role has no table privileges
--
--   Operation                  Runs as                 Table access via
--   -------------------------  ----------------------  -----------------------
--   create/join/cancel RPCs    owner (SECURITY DEFINER) owner's rights
--   apply_friend_move          owner (SECURITY DEFINER) owner's rights; callable
--                                                       only with EXECUTE, which
--                                                       only service_role has
--   friend-move Edge Function  reads the row with the   authenticated + RLS
--     (read step)              CALLER's token          (SELECT policy)
--   cleanup jobs (2, Step 4)   owner, via pg_cron      owner's rights
--   games_broadcast trigger    owner (SECURITY DEFINER) owner's rights
--
-- So service_role needs only EXECUTE on apply_friend_move. Holding the
-- service_role key no longer allows any direct SELECT, INSERT, UPDATE,
-- DELETE or TRUNCATE on public.games; PostgreSQL checks table
-- privileges before RLS, so BYPASSRLS does not help without them.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Result for an API request:
--   PATCH  /rest/v1/games  (browser or service_role) -> no privilege -> denied
--   POST   /rest/v1/games  (browser or service_role) -> no privilege -> denied
--   DELETE /rest/v1/games  (browser or service_role) -> no privilege -> denied
--   GET    /rest/v1/games  service_role -> no privilege -> denied
--   POST   /rest/v1/rpc/apply_friend_move (browser) -> no EXECUTE  -> denied
--   private.*                                 -> not exposed, no USAGE
--
-- The ONLY application write paths, each limited by Step 2 triggers:
--   create_friend_game(p_leaving)  (browser, authenticated)
--       INSERT fresh waiting row; white_id = auth.uid(); join_code
--       NULL in the INSERT and generated by the 1b trigger; may first
--       delete the caller's own waiting game under a row lock
--       (design D8)
--   join_friend_game(code)         (browser, authenticated)
--       waiting -> active; black_id = auth.uid() (enforced by 1c 4a);
--       version + 1; expires_at = now()+24h
--   cancel_friend_game(id)         (browser, authenticated)
--       DELETE own waiting row under a row lock (design D8; plus 1d)
--   apply_friend_move(...)         (friend-move Edge Function only)
--       one validated move; Step 3
--   expire / delete-ended jobs     (pg_cron only)
--       game expiry and deletion; design B5, Step 4 §4e
-- ---------------------------------------------------------------------

-- #####################################################################
-- Step 6: design §E.3, realtime.messages policies
--
-- Both policies also require the message row's own topic to be the
-- channel topic. Without it, a session whose realtime.topic is one of
-- the caller's games passes the policy for EVERY row, whatever its topic.
-- (In supabase/realtime main, the authorization probes are rows with
-- topic = channel topic; to be confirmed on the project's version.)
-- #####################################################################

create policy game_channel_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and realtime.messages.topic = (select realtime.topic())
    and exists (select 1 from public.games g
                where 'game:' || g.id::text = (select realtime.topic())
                  and (select auth.uid()) in (g.white_id, g.black_id)));

create policy game_channel_presence_only on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and realtime.messages.topic = (select realtime.topic())
    and exists (select 1 from public.games g
                where 'game:' || g.id::text = (select realtime.topic())
                  and (select auth.uid()) in (g.white_id, g.black_id)));

-- #####################################################################
-- Step 7: pg_cron schedules (last: the jobs exist only if every object
-- above was created). Each job runs in its own transaction, as postgres.
-- Step 0 checked that pg_cron is enabled and no safe-chess-* job exists.
-- #####################################################################

select cron.schedule('safe-chess-expire',        '*/5 * * * *',
  $$select private.expire_friend_games()$$);
select cron.schedule('safe-chess-delete-ended',  '*/5 * * * *',
  $$select private.delete_ended_friend_games()$$);
