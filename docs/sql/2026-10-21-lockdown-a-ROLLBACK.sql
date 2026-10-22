-- =============================================================================
-- ROLLBACK for LOCKDOWN STEP A (2026-10-21-lockdown-a.sql)
-- Puts every policy, grant, trigger and function back exactly as it was in the
-- live schema pasted on 2026-10-21. Safe to re-run.
--
-- Use the whole file to undo everything, or only the section for the part that
-- caused a problem (each section undoes the matching A1..A8 section).
--
-- Note: rolling back re-opens the holes step A closed. If only ONE part broke
-- something, roll back just that part and tell Claude what broke.
-- If you roll back A6 while the game server is running, the server logs a
-- "delete_stale_pending_matches" error every 5 minutes; that is harmless.
-- =============================================================================


-- All or nothing: if any statement fails, none of them is applied.
begin;


-- ── undo A8. Username rules ────────────────────────────────────────────────
drop trigger if exists profiles_username_rules on public.profiles;
drop function if exists public.enforce_username_rules();


-- ── undo A7. handle_new_user ───────────────────────────────────────────────
alter function public.handle_new_user() reset search_path;
grant execute on function public.handle_new_user() to public, anon, authenticated;


-- ── undo A6. Sweeper ───────────────────────────────────────────────────────
drop function if exists public.delete_stale_pending_matches(integer, uuid[]);


-- ── undo A5. Open-challenge limit ──────────────────────────────────────────
drop trigger if exists matches_pending_limit on public.matches;
drop function if exists public.enforce_pending_match_limit();


-- ── undo A4. Cancel own challenge ──────────────────────────────────────────
drop policy if exists "players can delete their own open challenge" on public.matches;


-- ── undo A3. Original insert policy (any status, roles: public) ────────────
drop policy if exists "users can create their own pending match" on public.matches;
create policy "users can create their own pending match"
  on public.matches
  for insert
  to public
  with check ((auth.uid() = player1_id) and (player2_id is null) and (winner_id is null));


-- ── undo A2. Original "join as player2" policy and its column grant ────────
drop policy if exists "users can join an open match as player2" on public.matches;
create policy "users can join an open match as player2"
  on public.matches
  for update
  to authenticated
  using ((status = 'waiting'::text) and (player2_id is null) and (player1_id <> auth.uid()))
  with check ((player2_id = auth.uid()) and (status = 'in_progress'::text));
grant update (player2_id, status) on public.matches to authenticated;


-- ── undo A1. Original grants ───────────────────────────────────────────────
-- These were never needed by the app; restore them only for an exact rollback.
grant insert, update, delete on public.rounds to authenticated;
grant insert, update, delete on public.profiles, public.matches, public.rounds to anon;
grant truncate, trigger, references on public.profiles, public.matches, public.rounds to anon, authenticated;

commit;
