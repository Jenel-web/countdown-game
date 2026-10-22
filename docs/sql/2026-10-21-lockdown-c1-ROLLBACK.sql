-- =============================================================================
-- ROLLBACK for LOCKDOWN STEP C1 (2026-10-21-lockdown-c1.sql)
-- Restores the original read access on profiles exactly as it was on
-- 2026-10-21. This RE-OPENS the email leak (everyone, including logged-out
-- visitors, can read every player's email again). Use it only if C1 broke a
-- page, and tell Claude which one. Safe to re-run.
-- =============================================================================

begin;

drop policy if exists "players can read public profile fields" on public.profiles;

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles
  for select
  to public
  using (true);

grant select on public.profiles to anon, authenticated;

commit;
