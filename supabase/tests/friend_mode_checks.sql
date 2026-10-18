-- Safe Chess, Step 7: read-only privilege checks (design §K item 9).
-- Copied verbatim from step7-3-grants-rls.sql. Each line notes the expected value.

-- ---------------------------------------------------------------------
-- Verification queries to run on the dev project (expected results):
-- ---------------------------------------------------------------------
select has_table_privilege('anon', 'public.games',
  'select,insert,update,delete,truncate,references,trigger'); -- false
select has_table_privilege('authenticated', 'public.games',
  'insert,update,delete,truncate,references,trigger');        -- false
select has_table_privilege('service_role', 'public.games',
  'select,insert,update,delete,truncate,references,trigger'); -- false
select count(*) from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'games'
   and grantee in ('anon', 'authenticated', 'service_role')
   and privilege_type <> 'SELECT';                           -- 0
select count(*) from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'games'
   and grantee = 'service_role';                             -- 0
select has_function_privilege('anon',
  'public.apply_friend_move(uuid,uuid,int,text,text,text,text)',
  'execute');                                                -- false
select has_function_privilege('authenticated',
  'public.apply_friend_move(uuid,uuid,int,text,text,text,text)',
  'execute');                                                -- false
select has_function_privilege('service_role',
  'public.apply_friend_move(uuid,uuid,int,text,text,text,text)',
  'execute');                                                -- true
select has_function_privilege('service_role',
  'public.create_friend_game(uuid)', 'execute');             -- false
select has_function_privilege('service_role',
  'public.join_friend_game(text)', 'execute');               -- false
select has_function_privilege('service_role',
  'public.cancel_friend_game(uuid)', 'execute');             -- false
select has_function_privilege('authenticated',
  'private.generate_join_code()', 'execute');                -- false
select has_function_privilege('service_role',
  'private.expire_friend_games()', 'execute');               -- false
select has_function_privilege('service_role',
  'private.delete_ended_friend_games()', 'execute');         -- false
select to_regprocedure(
  'private.delete_stale_anonymous_users()') is null;         -- true (removed)
select has_function_privilege('authenticated',
  'private.lock_users(uuid,uuid)', 'execute');               -- false
select has_function_privilege('service_role',
  'private.lock_users(uuid,uuid)', 'execute');               -- false
select has_schema_privilege('authenticated', 'private', 'usage'); -- false
select has_schema_privilege('service_role',  'private', 'usage'); -- false
select has_schema_privilege('authenticated', 'public', 'create'); -- false

-- Trust boundary: a DIRECT database login (Dashboard SQL editor /
-- database password, i.e. the table owner) can set request.jwt.claims
-- by hand or disable triggers. No trigger can restrain the owner. All
-- API paths (browser, service_role key, RPC, GraphQL) are covered.
--
-- Remaining limitation: anyone holding the service_role key can call
-- apply_friend_move with any server-computed-looking values; every
-- such write is still checked by FILE 2 and the FILE 1 triggers. The
-- key exists only in the Edge Function runtime and is never sent to
-- the browser.
