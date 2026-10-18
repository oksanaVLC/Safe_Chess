-- Safe Chess, Step 7: READ-ONLY pre-flight checks, run BEFORE the
-- friend-mode migration (design §M step 0 and §K items 7, 11, 20).
-- Every statement only reads. Nothing is created, changed or deleted.

-- PostgreSQL version (hashtextextended needs 11+)
select version();

-- Step 0: both extensions must be listed
select extname, extversion
  from pg_extension
 where extname in ('pgcrypto', 'pg_cron');

-- §K 20: must return NO rows (no older draft functions exist)
select oid::regprocedure
  from pg_proc
 where proname in ('create_friend_game', 'cancel_friend_game',
                   'join_friend_game', 'apply_friend_move');

-- The migration creates these; both must be NULL now
select to_regclass('public.games')   as games_table,
       to_regnamespace('private')    as private_schema;

-- §K 11 (first half): must return a number
select hashtextextended('x', 0) as hash_check;

-- §K 7: the role the SQL editor runs as (expected: postgres)
select current_user;

-- Existing realtime.messages policies (§K 4 baseline; expected: none)
select polname
  from pg_policy
 where polrelid = 'realtime.messages'::regclass;

-- Anonymous users that already exist. The cleanup job deletes anonymous
-- users older than 24 hours who are in no Safe Chess game, so this must
-- be 0 (or only disposable test users) before the migration is run.
select count(*) as anonymous_users
  from auth.users
 where is_anonymous;
