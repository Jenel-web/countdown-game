-- =============================================================================
-- ROLLBACK for LOCKDOWN STEP C2 (2026-10-21-lockdown-c2.sql)
-- Restores the original write access on profiles exactly as it was on
-- 2026-10-21. This RE-OPENS the hole where any player can set their own MMR,
-- wins and losses from the browser. Use it only if C2 broke registration,
-- choosing a username or Google sign-in, and tell Claude which. Safe to re-run.
-- =============================================================================

begin;

grant insert, update, delete on public.profiles to authenticated;

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
  on public.profiles
  for insert
  to public
  with check (auth.uid() = id);

commit;
