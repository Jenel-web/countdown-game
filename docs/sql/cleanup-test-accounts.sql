-- =============================================================================
-- CLEAN UP the match rows left behind by scripts/db-attack-sim.ts
--
-- Scope: ONLY matches where one of the two throwaway accounts is a player.
--   test_a_01  69aacaeb-9365-46a3-976c-d2e642e2fb48
--   test_b_01  a26bafe6-ca0f-4ab7-ad6a-bcc8ecf49da8
-- Nothing else is touched: other players' matches, profiles and stats are not
-- affected. A match that already has rounds is never deleted (those would be
-- real games, and rounds.match_id has no cascade anyway).
--
-- HOW TO RUN: the Supabase SQL editor only shows the result of the LAST
-- statement, so run the three blocks ONE AT A TIME: highlight a block, click
-- Run, read the result, then do the next.
-- =============================================================================


-- ── BLOCK 1: PREVIEW (read-only). What would be deleted? ────────────────────
-- Expect only 'pending', 'waiting' and 'completed' rows from the script, all
-- with_rounds = 0. If with_rounds is above 0 anywhere, those rows are kept.
select
  m.status,
  count(*) as matches,
  count(*) filter (where exists (select 1 from public.rounds r where r.match_id = m.id)) as with_rounds
from public.matches m
where m.player1_id in ('69aacaeb-9365-46a3-976c-d2e642e2fb48'::uuid, 'a26bafe6-ca0f-4ab7-ad6a-bcc8ecf49da8'::uuid)
   or m.player2_id in ('69aacaeb-9365-46a3-976c-d2e642e2fb48'::uuid, 'a26bafe6-ca0f-4ab7-ad6a-bcc8ecf49da8'::uuid)
group by m.status
order by m.status;


-- ── BLOCK 2: DELETE. Returns how many rows were deleted, per status. ────────
-- After the first run, running it again deletes 0 rows (safe to repeat).
with deleted as (
  delete from public.matches m
  where (
          m.player1_id in ('69aacaeb-9365-46a3-976c-d2e642e2fb48'::uuid, 'a26bafe6-ca0f-4ab7-ad6a-bcc8ecf49da8'::uuid)
       or m.player2_id in ('69aacaeb-9365-46a3-976c-d2e642e2fb48'::uuid, 'a26bafe6-ca0f-4ab7-ad6a-bcc8ecf49da8'::uuid)
        )
    and not exists (select 1 from public.rounds r where r.match_id = m.id)
  returning m.status
)
select status, count(*) as deleted
from deleted
group by status
order by status;


-- ── BLOCK 3: VERIFY (read-only). Should return no rows. ─────────────────────
select m.id, m.status, m.created_at
from public.matches m
where m.player1_id in ('69aacaeb-9365-46a3-976c-d2e642e2fb48'::uuid, 'a26bafe6-ca0f-4ab7-ad6a-bcc8ecf49da8'::uuid)
   or m.player2_id in ('69aacaeb-9365-46a3-976c-d2e642e2fb48'::uuid, 'a26bafe6-ca0f-4ab7-ad6a-bcc8ecf49da8'::uuid);
