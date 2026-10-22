-- =============================================================================
-- LOCKDOWN STEP C1  (2026-10-21): players' emails become private
--
-- RUN ONLY AFTER the web app version that no longer selects `email` from
-- profiles is DEPLOYED (lobby, match page and lib/history.ts select only public
-- columns). An older deployed app would get "permission denied for column
-- email" on those pages. Undo with 2026-10-21-lockdown-c1-ROLLBACK.sql.
--
-- Before: "profiles are publicly readable" (USING true, every role) - anyone on
-- the internet, logged in or not, could download every player's email with the
-- anon key that ships in the web bundle.
--
-- After:
--   - logged-out visitors read nothing from profiles;
--   - logged-in players read only the public columns of any profile:
--       id, username, mmr, wins, losses, matches_played, created_at
--   - nobody reads `email` through the API (a player's own email comes from
--     their login session, which the app already uses).
-- The game server uses the service role and is not affected.
--
-- Keep the column list identical to PUBLIC_PROFILE_COLUMNS in
-- lib/auth/dbContract.test.ts (that test fails if app code selects anything else).
--
-- Verify afterwards: scripts/db-attack-sim.ts -> X1 and X2 BLOCKED, L1 and L2 ALLOWED.
-- =============================================================================

-- All or nothing: if any statement fails, none of them is applied.
begin;

drop policy if exists "profiles are publicly readable" on public.profiles;

drop policy if exists "players can read public profile fields" on public.profiles;
create policy "players can read public profile fields"
  on public.profiles
  for select
  to authenticated
  using (true);

-- Column-level read access: the table-level SELECT must go first, otherwise it
-- would still cover every column.
revoke select on public.profiles from anon, authenticated;
grant select (id, username, mmr, wins, losses, matches_played, created_at)
  on public.profiles to authenticated;

commit;


-- Verify: authenticated should list exactly the seven columns, anon nothing.
select grantee, string_agg(column_name, ', ' order by column_name) as readable_columns
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and privilege_type = 'SELECT' and grantee in ('anon', 'authenticated')
group by grantee;
