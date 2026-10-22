-- =============================================================================
-- LOCKDOWN STEP C2  (2026-10-21): players can no longer edit their own stats
--
-- RUN ONLY AFTER the web app version where
--   - /register saves the username with claimUsername() (no profiles upsert), and
--   - /auth/callback no longer upserts a profiles row
-- is DEPLOYED, and after 2026-10-21-lockdown-a.sql (whose username trigger
-- makes the remaining username write "set once, never reserved").
-- Undo with 2026-10-21-lockdown-c2-ROLLBACK.sql.
--
-- Before: "users can update own profile" (USING auth.uid() = id, no column
-- limits) let any player set their own mmr, wins, losses, matches_played,
-- email and created_at from the browser console, bypassing finish_match.
--
-- After:
--   - the only profile column a player may write is `username` (and the A8
--     trigger allows that once, from empty to a valid, non-reserved name);
--   - players cannot insert or delete profile rows (the handle_new_user
--     trigger creates them; finish_match and the server change the stats).
-- The game server (service role) and finish_match (SECURITY DEFINER) are not
-- affected.
--
-- Before running: check audit-tampering.sql -> users_without_profile is empty.
-- Afterwards a missing row can no longer be created from the browser; ask
-- Claude for a one-off backfill statement if that list is not empty.
--
-- Verify afterwards: scripts/db-attack-sim.ts -> X4 and X5 BLOCKED.
-- =============================================================================

-- All or nothing: if any statement fails, none of them is applied.
begin;

-- Profile rows are created by handle_new_user, never by the browser.
drop policy if exists "users can insert their own profile" on public.profiles;
revoke insert, delete on public.profiles from authenticated;

-- Column-level write access: the table-level UPDATE must go first, otherwise it
-- would still cover every column. The existing policy "users can update own
-- profile" (auth.uid() = id) still limits WHICH row; this limits WHICH column.
revoke update on public.profiles from authenticated;
grant update (username) on public.profiles to authenticated;

commit;


-- Verify: authenticated may UPDATE only username, and may not INSERT or DELETE.
select privilege_type, string_agg(column_name, ', ' order by column_name) as columns
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
group by privilege_type;
