# History Tab - Implementation Plan

Status: IMPLEMENTED (pending the SQL in section 3 being run in Supabase).

Changes agreed after the mockups, which replace the older "one overlay with everything" idea:
- Match row: top line = date/time, round count, status (Completed / Forfeit); below = you (left), score (middle), opponent (right).
- Click a match -> match window with one row per round (target, numbers, each side's time and points, Winner label). No steps there.
- Click a round -> smaller steps window: target + numbers (cyan border and digits), then you (left) and the opponent (right) with time, points, result and steps. The round winner gets a "Winner" badge.
- IMPORTANT: points are stored as integers in hundredths (100 = 1.00), both in `rounds.player*_points` and `matches.player*_total_points`. The UI divides by 100.

## 1. Expectations

### History page (`/history`)
- The Navbar "History" tab becomes a real link and is highlighted while on `/history`.
- Shows the **last 10 matches** of the logged-in player, newest first. No filters, no pagination.
- A match is listed only if it was actually played and finished: `winner_id IS NOT NULL`.
  Pending rooms (created, never played) never appear. Solo/training games are not stored, so they never appear.
- The player may be `player1` or `player2` in the DB. The UI always shows **"you" on the left and the opponent on the right**.
- Empty state: "No matches yet".
- Style: chess.com-like match history, built with our own dark glass-card / cyan design system.

### Match row
- Your username (left), opponent username (right), with a **green indicator (victory) or red indicator (defeat)** between the two names.
- Final score (e.g. `3.5 - 5`), the date, and the number of rounds.
- A small **"Forfeit"** tag appears on matches that ended by disconnect. It is inferred, not stored: a match normally ends when someone reaches 5 points, so if neither player's total reached 5, the match ended by forfeit. `isForfeit(match)` in `lib/history.ts` holds this rule.
- A match cannot end in a draw (it always has a `winner_id`), so there is no gray state. Individual **rounds** can be draws.
- Clicking a row opens the overlay.

### Round overlay (closable: X button, Esc, backdrop click; full-screen on small screens)
One card per round, in order. Each card shows:
- Round number, the **target**, and the **six numbers**.
- Per player (you left, opponent right):
  - Time taken in seconds with **2 decimals** (e.g. `12.43s`), or **"Timeout"** if they did not submit.
  - Points earned this round, shown **as decimals** (max 5 total per match, so e.g. `0.5`, `1.25`).
  - The result they reached.
  - Their **steps**, one per line, e.g. `25 x 4 = 100`.
- The round winner gets a **"Winner"** label. A drawn round gets no winner label.
- Not shown: distance from target, solvable flag.
- Matches played before this feature have no steps stored: show "Steps not recorded".

## 2. What the data looks like today

| Table | Columns used |
|---|---|
| `matches` | id, player1_id, player2_id, player1_total_points, player2_total_points, winner_id, status, created_at, ended_at |
| `rounds` | match_id, round_number, target, tiles (jsonb), player1/2_result, player1/2_time_ms, player1/2_points (numeric), player1/2_outcome |
| `profiles` | id, username (new), email |

- RLS already allows a player to read their own matches, all rounds of those matches, and all profiles. No new read policies needed.
- Forfeit: after a 15 s reconnect grace period the remaining player is passed to `finish_match` as the winner (`roomHandlers.ts` `forfeitMatch`). So forfeited matches have a `winner_id` and appear normally.
- If both players disconnect, the room is discarded with **no winner** (`roomHandlers.ts`). Those rows keep `winner_id = NULL` and are excluded by the filter above.
- Steps are validated in memory (`room.submissions[slot].steps`) and sent to clients in `round_result`, but are **not saved** to the `rounds` insert today.
- `ended_at` is never set today.

## 3. Database changes (run by the user in Supabase)

```sql
-- Steps taken by each player in a round
alter table public.rounds
  add column if not exists player1_steps jsonb,
  add column if not exists player2_steps jsonb;

-- Existing finished matches have no ended_at: fall back to created_at
update public.matches
set ended_at = created_at
where ended_at is null and winner_id is not null;

-- Needed so the History list (filter + sort) stays fast
create index if not exists matches_player1_ended_idx on public.matches (player1_id, ended_at desc);
create index if not exists matches_player2_ended_idx on public.matches (player2_id, ended_at desc);
create index if not exists rounds_match_round_idx on public.rounds (match_id, round_number);
```

`ended_at` going forward is set by the server (section 4), so we do not need to see or edit the body of `finish_match`.

**Confirmed by the user's query:** finished matches have status `completed` (9) or `finished` (1); `active` and `pending` have 0 rows. Both values mean "over", which is why the History filter uses `winner_id IS NOT NULL` and not a status value.

## 4. Server changes (`countdown-server`)

1. `socket/handlers/roundHandlers.ts` - `evaluateRound`
   - Add `player1_steps: p1sub.steps ?? null` and `player2_steps: p2sub.steps ?? null` to the `rounds` insert.
   - After the `finish_match` RPC: `update matches set ended_at = now() where id = matchId and ended_at is null`.
2. `socket/handlers/roomHandlers.ts` - `forfeitMatch`
   - Same `ended_at` update after its `finish_match` RPC.
3. A small shared helper `markMatchEnded(matchId)` (in `supabase/` next to `adminClient.ts`) so both call sites stay identical.
4. Tests: extend the existing integration tests to assert steps are stored and `ended_at` is set.

## 5. Web app changes

### New files
| File | Purpose |
|---|---|
| `lib/history.ts` | Types + data access + pure helpers |
| `app/history/page.tsx` | Page: loads matches, handles loading / error / empty, owns the selected match |
| `components/history/MatchRow.tsx` | One clickable match row |
| `components/history/MatchDetailModal.tsx` | The closable overlay; loads rounds when opened |
| `components/history/RoundCard.tsx` | One round: target, tiles, two player panels, Winner label |
| `lib/history.test.ts` | Vitest unit tests for the pure helpers |

### `lib/history.ts` functions
- `fetchRecentMatches(supabase, userId, limit = 10)` - matches where (`player1_id` or `player2_id` = me) and `winner_id` is not null, ordered by `ended_at` desc (fallback `created_at`); then ONE `profiles` query for both players' usernames; returns `MatchSummary[]`.
- `fetchMatchRounds(supabase, matchId)` - rounds ordered by `round_number`.
- `toMatchSummary(row, userId, profiles)` - flips slots so `me` is always left and `opponent` right; computes `didWin`, scores, round count.
- `toRoundView(round, mySlot)` - flips a round's per-player fields the same way.
- `getRoundWinner(roundView)` - `'me' | 'opponent' | 'draw'` by comparing round points.
- `formatSeconds(ms)` - `12430 -> "12.43s"`; `null` -> `"Timeout"`.
- `formatPoints(n)` - decimal display for the numeric points column.
- `formatStep(step)` - `{a:25, op:'*', b:4, result:100} -> "25 x 4 = 100"`.
- `formatMatchDate(iso)`.
- `isForfeit(match)` - true when neither total points value reached 5.

### `app/history/page.tsx` behavior
- Gets the user, calls `fetchRecentMatches`, renders `<Navbar />` + list of `MatchRow`.
- States: loading skeleton, error message, "No matches yet".
- Click a row -> `selectedMatch` set -> `MatchDetailModal` opens.

### `components/history/MatchDetailModal.tsx` behavior
- On open: `fetchMatchRounds`, shows loading / error inside the overlay.
- Closes on X, Esc, backdrop click. Locks page scroll while open. Full-screen on small screens.
- Renders one `RoundCard` per round.

### Edit
- `components/Navbar.tsx` - remove `/history` from the `isPlaceholder` check.

## 6. Order of work
1. User runs the SQL in section 3 and sends the status query result.
2. Server changes (section 4) + tests.
3. `lib/history.ts` + unit tests.
4. Components and page.
5. Enable the Navbar tab.
6. Manual check: play a match (normal win, timeout round, forfeit), then verify the list, the overlay, and an old match showing "Steps not recorded".

## 7. Open items
- The layout graph the user mentioned did not arrive with the message. Please resend; the components in section 5 will be adjusted to match it.
- DECIDED: show the "Forfeit" tag, inferred as "no player reached 5 points". Caveat: very old matches played under different rules could be mis-tagged.
- Old matches: their `rounds` have no steps, so only target/tiles/time/points/result are shown for them.
