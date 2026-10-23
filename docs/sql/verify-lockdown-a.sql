-- =============================================================================
-- READ-ONLY: which parts of LOCKDOWN STEP A (2026-10-21-lockdown-a.sql) are
-- currently applied? Changes nothing. Returns ONE row, ONE JSON cell.
--
-- Each flag is true when that part is IN PLACE:
--   a1_privileges  no TRUNCATE/TRIGGER/REFERENCES for the browser roles, no
--                  writes by logged-out users, no browser writes to rounds
--   a2_no_join     the old "join as player2" policy and the column UPDATE are gone
--   a3_clean_insert new matches from the browser must be status 'pending'
--   a4_cancel      players can delete their own open challenge
--   a5_limit       the 3-open-challenges trigger exists
--   a6_sweeper     delete_stale_pending_matches() exists and only the server
--                  (service role) may call it
--   a7_signup_fn   handle_new_user has a fixed search_path and the browser
--                  roles cannot call it
--   a8_usernames   the username rules trigger exists
--
-- all_applied = true  -> lockdown A is fully on.
-- all_applied = false -> some parts are off (for example after running the
--                        ROLLBACK file). Run 2026-10-21-lockdown-a.sql again.
-- =============================================================================

with checks as (
  select
    -- A1
    not (
      has_table_privilege('anon', 'public.profiles', 'TRUNCATE') or has_table_privilege('anon', 'public.matches', 'TRUNCATE') or has_table_privilege('anon', 'public.rounds', 'TRUNCATE')
      or has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE') or has_table_privilege('authenticated', 'public.matches', 'TRUNCATE') or has_table_privilege('authenticated', 'public.rounds', 'TRUNCATE')
      or has_table_privilege('anon', 'public.profiles', 'INSERT') or has_table_privilege('anon', 'public.profiles', 'UPDATE') or has_table_privilege('anon', 'public.profiles', 'DELETE')
      or has_table_privilege('anon', 'public.matches', 'INSERT') or has_table_privilege('anon', 'public.matches', 'UPDATE') or has_table_privilege('anon', 'public.matches', 'DELETE')
      or has_table_privilege('anon', 'public.rounds', 'INSERT') or has_table_privilege('anon', 'public.rounds', 'UPDATE') or has_table_privilege('anon', 'public.rounds', 'DELETE')
      or has_table_privilege('authenticated', 'public.rounds', 'INSERT') or has_table_privilege('authenticated', 'public.rounds', 'UPDATE') or has_table_privilege('authenticated', 'public.rounds', 'DELETE')
    ) as a1_privileges,

    -- A2
    not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'matches'
                and policyname = 'users can join an open match as player2')
    and not has_column_privilege('authenticated', 'public.matches', 'player2_id', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.matches', 'status', 'UPDATE') as a2_no_join,

    -- A3
    exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'matches'
            and policyname = 'users can create their own pending match' and cmd = 'INSERT'
            and with_check like '%pending%') as a3_clean_insert,

    -- A4
    exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'matches'
            and policyname = 'players can delete their own open challenge' and cmd = 'DELETE') as a4_cancel,

    -- A5
    exists (select 1 from pg_trigger where tgrelid = 'public.matches'::regclass
            and tgname = 'matches_pending_limit' and not tgisinternal) as a5_limit,

    -- A6
    (to_regprocedure('public.delete_stale_pending_matches(integer,uuid[])') is not null
      and has_function_privilege('service_role', to_regprocedure('public.delete_stale_pending_matches(integer,uuid[])'), 'EXECUTE')
      and not has_function_privilege('authenticated', to_regprocedure('public.delete_stale_pending_matches(integer,uuid[])'), 'EXECUTE')
      and not has_function_privilege('anon', to_regprocedure('public.delete_stale_pending_matches(integer,uuid[])'), 'EXECUTE')
    ) as a6_sweeper,

    -- A7
    (select coalesce(bool_or(c like 'search_path=%'), false)
       from pg_proc p, unnest(coalesce(p.proconfig, array[]::text[])) c
       where p.oid = 'public.handle_new_user()'::regprocedure)
    and not has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE') as a7_signup_fn,

    -- A8
    exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass
            and tgname = 'profiles_username_rules' and not tgisinternal) as a8_usernames
)
select json_build_object(
  'a1_privileges', a1_privileges,
  'a2_no_join', a2_no_join,
  'a3_clean_insert', a3_clean_insert,
  'a4_cancel', a4_cancel,
  'a5_limit', a5_limit,
  'a6_sweeper', a6_sweeper,
  'a7_signup_fn', a7_signup_fn,
  'a8_usernames', a8_usernames,
  'all_applied', (a1_privileges and a2_no_join and a3_clean_insert and a4_cancel and a5_limit and a6_sweeper and a7_signup_fn and a8_usernames)
) as lockdown_a_status
from checks;
