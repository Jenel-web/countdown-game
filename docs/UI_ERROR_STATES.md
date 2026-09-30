# `docs/UI_ERROR_STATES.md`
## Countdown Math Arena — UI Error States & Edge-Case Screen Specification

> **For AI Agents (Cursor, Antigravity, Claude):** This document is the canonical reference for every non-happy-path screen in the Countdown multiplayer client. Before generating any error modal, waiting state, overlay, or banner, read this file in full. Do not invent error codes or visual treatments not listed here.

---

## 0 — Design Token Reference

All visual specifications below use the existing Tailwind design system defined in `tailwind.config.ts`. Use only these tokens — do not hardcode hex values.

| Token | Usage |
|---|---|
| `bg-background` | Base page background |
| `glass-panel` | The shared translucent card surface |
| `text-primary-fixed-dim` | Cyan accent / emphasis text |
| `bg-error-container` / `text-on-error-container` | Destructive / alert surfaces |
| `bg-surface-container-high` | Elevated neutral surface |
| `border-outline-variant` | Subtle borders |
| `neon-glow` | Box-shadow utility for cyan glow effect |

**Motion library:** Framer Motion (`framer-motion` is already installed). Use `motion.div` with `AnimatePresence` for all modal and toast entry/exit.

---

## 1 — Room Entry Rejections

These states are triggered **before** a match begins, when the server rejects a `join_room` attempt via the `error` socket event.

### 1.1 `ROOM_FULL` — `error.code === 'room_full'`

**Trigger:** Server emits `error({ code: 'room_full', message: '...' })` during `join_room` handling. This happens when `matchRow.player2_id` is already set to a *different* user's ID.

**Visual Treatment:**
- Full-screen modal overlay (`fixed inset-0 z-50 bg-black/70 backdrop-blur-sm`)
- Centered `glass-panel` card, max width `max-w-sm`
- Icon: `lock` (Material Symbols Outlined), size `text-4xl`, color `text-error`
- Headline: `"Match Full"` — `font-bold text-2xl text-on-background`
- Body: `"This challenge link has already been claimed by another player."`
- Single CTA button: **"Back to Lobby"** -> `router.push('/lobby')`; styled `bg-error-container text-on-error-container`
- **No close/dismiss action** — user must navigate away

**State Reset:** On CTA click, disconnect the socket (`socket.disconnect()`) before routing.

---

### 1.2 `MATCH_IN_PROGRESS` — `error.code === 'match_finished'`

**Trigger:** Server emits `error({ code: 'match_finished', message: '...' })`. The match row's `status` is `'finished'`.

**Visual Treatment:**
- Same overlay structure as `ROOM_FULL`
- Icon: `emoji_events`, color `text-primary-fixed-dim`
- Headline: `"Match Already Ended"`
- Body: `"This match has concluded. Check your stats in the lobby."`
- CTA: **"View My Stats"** -> `router.push('/lobby')`

**State Reset:** Disconnect socket on CTA click.

---

### 1.3 `INVALID_ROOM` — `error.code === 'not_found'`

**Trigger:** Server emits `error({ code: 'not_found', message: '...' })`. The `matchId` in the URL does not correspond to any row in `matches`.

**Visual Treatment:**
- Same overlay structure
- Icon: `search_off`, color `text-on-surface-variant`
- Headline: `"Room Not Found"`
- Body: `"This challenge link is invalid or has expired."`
- CTA: **"Back to Lobby"** -> `router.push('/lobby')`

**State Reset:** Disconnect socket on CTA click.

---

### 1.4 `AUTH_FAILURE` — connection-level error

**Trigger:** Socket.io connection is rejected by `authMiddleware` (token missing or expired). The `socket.on('connect_error', ...)` callback fires with `err.message` containing `'Unauthorized'`.

**Visual Treatment:**
- Same overlay structure
- Icon: `no_accounts`, color `text-error`
- Headline: `"Session Expired"`
- Body: `"Your session has expired. Please log in again."`
- CTA: **"Log In"** -> `router.push('/login')`

**Implementation note:** The client must call `socket.on('connect_error', handler)` at socket construction time, **before** emitting `join_room`. Do not attempt to re-emit `join_room` after a `connect_error`.

---

## 2 — Lobby & Waiting States

### 2.1 Waiting for Opponent (1/2 Players)

**Trigger:** Server emits `waiting_for_opponent` after a successful `join_room` where `player2Id` is still `null`.

**Visual Treatment:**
- Replaces the game board entirely with a centered waiting card (`glass-panel rounded-2xl p-8 max-w-md mx-auto`)
- Animated pulse dot (same `animate-ping` pattern used in `lobby/page.tsx` line 252-253)
- Headline: `"Waiting for Opponent..."`
- Sub-copy: `"Share the link below to invite a friend."`
- **Invite link display:** Read-only `<input>` showing the match URL (`window.location.href`), with a **"Copy Link"** button (`navigator.clipboard.writeText`). Mirrors the UI pattern in `app/lobby/page.tsx` lines 237-248 exactly.
- `"Copy Link"` button text transitions to `"Copied! ✓"` for 2 000 ms, then reverts.
- **Cancel button:** `"Cancel & Leave"` (bottom, `text-error` hover) -> calls `socket.disconnect()` then `router.push('/lobby')`. This button is always enabled.

**State Reset:** When `opponent_joined` is received, transition immediately to the `PREPARING` phase (run `startCountdown()` and render the tile-reveal + 5-second prepare overlay as in the solo game). Clear the waiting card via `AnimatePresence` exit animation.

---

### 2.2 Opponent Joining (2/2 — Handshake Flash)

**Trigger:** Server emits `opponent_joined({ player1Id, player2Id })`.

**Visual Treatment:**
- Brief (800 ms) success flash toast: `"Game opponent joined! Get ready..."` — style: `bg-primary-container text-on-primary-container`. Uses the same toast system as `app/game/page.tsx` lines 301-308.
- Immediately followed by the `PREPARING` overlay (5-second countdown).

---

## 3 — Mid-Game Disconnects & Forfeits

### 3.1 Opponent Disconnected — `opponent_left`

**Trigger:** Server emits `opponent_left` (no payload). This means the opponent's socket disconnected. Per `roomHandlers.ts` line 163, this is emitted **before** the `finish_match` RPC is called, so the client should not wait for a `match_over` to follow.

**Visual Treatment:**
- Full-screen modal (same overlay pattern — `fixed inset-0 z-50`)
- **Freeze the game timer immediately** (see Red Zone note in section 8). Do not advance `gameTime`. The timer bar should freeze visually at its current fill percentage.
- **Lock all interactive elements** (tiles, operators, submit, undo, clear) — apply `pointer-events-none` to the controls panel and `opacity-50` to tiles.
- Modal card content:
  - Icon: `wifi_off`, size `text-5xl`, color `text-primary-fixed-dim`, with CSS animation `animate-pulse`
  - Headline: `"Opponent Disconnected"`
  - Body: `"Your opponent left the game. You win by forfeit!"`
  - CTA: **"Claim Victory & Continue"** -> `router.push('/lobby')` (no Supabase call needed from the client; the server already called `finish_match`)
- **Do NOT show a `match_over` payload** — the server does not emit `match_over` on a disconnect forfeit. The modal is driven purely by `opponent_left`.

**State Reset:** On CTA click, call `socket.disconnect()` before routing.

---

### 3.2 Match Over (Normal Completion)

> **Note:** `match_over` is **not** emitted on disconnect (see `roomHandlers.ts`). It is only emitted after the normal round-scoring path. Section 3.1 covers the disconnect case. Do not conflate the two.

**Trigger:** Server emits `match_over({ winnerId, player1TotalRaw, player2TotalRaw })` at the end of a full match.

**Visual Treatment:** This is handled by the existing `components/GameOverModal.tsx`. See that component for the full implementation. Wire it to `match_over` in `useGameSocket`.

---

## 4 — Network Instability

### 4.1 Connection Lost — socket `disconnect` event

**Trigger:** The socket's own `disconnect` event fires (client-side, not a server emit). This covers: browser tab going offline, server restart, network dropout.

**Visual Treatment:**
- **Sticky warning banner** at the top of the game board (not a full modal — the player should see the game state behind it):
  - Position: `fixed top-0 left-0 right-0 z-40`
  - Background: `bg-error-container/95 backdrop-blur-sm`
  - Text: `Connection lost. Reconnecting...` — `text-on-error-container font-bold text-sm text-center py-3`
  - Animated spinner (`animate-spin material-symbols-outlined: progress_activity`) left of text
- **Immediately lock all interactive elements** (tiles, operators, submit button). Apply `disabled` attribute or `pointer-events-none` + `opacity-40`. **This is critical** — preventing the player from clicking "Submit" while reconnecting avoids submitting stale data to a new socket instance.
- The game timer should **freeze** (same mechanism as 3.1).

**State Reset:** When the `connect` event fires again (Socket.io auto-reconnect), remove the banner and unlock elements. Re-emit `join_room` with the current `matchId` to re-register the socket with the server room.

---

### 4.2 Reconnect Attempt — socket `reconnect_attempt` event

**Trigger:** Socket.io fires `reconnect_attempt(attemptNumber)` for each retry.

**Visual Treatment:**
- Update the sticky banner text to: `Reconnecting... (attempt N)`
- No other change from 4.1.

---

### 4.3 Reconnect Failed — socket `reconnect_failed` event

**Trigger:** Socket.io has exhausted all retry attempts (configure `reconnectionAttempts` — recommend `5`).

**Visual Treatment:**
- Upgrade the sticky banner to a **full-screen modal** (same overlay pattern)
- Icon: `signal_disconnected`, `text-error text-5xl`
- Headline: `"Connection Failed"`
- Body: `"We couldn't reconnect to the game server. Your progress has been saved."`
- CTA: **"Return to Lobby"** -> `router.push('/lobby')`

---

### 4.4 Button Lockout During Reconnect (Race Condition Prevention)

> **Red Zone — Human supervision required. Do not delegate this logic to an AI without review.**

When `disconnect` fires, set a React ref `isReconnecting = true`. All event emitters (submit, player_status) must gate on this ref:

```typescript
// In useGameSocket or the submit handler:
if (isReconnecting.current) {
  showNote('Connection lost — cannot submit now.', 'error');
  return;
}
socket.emit('submit_answer', { steps, resultValue });
```

Use a `useRef` (not `useState`) so the gate is synchronous and does not trigger a re-render. This prevents a double-submission if the player clicks "Submit" in the ~100 ms window between reconnect and the `join_room` re-registration completing.

---

## 5 — Intermissions & Math Validation

### 5.1 Round Result Overlay — `round_result`

**Trigger:** Server emits `round_result({ roundNumber, solvable, player1, player2, player1TotalRaw, player2TotalRaw })`.

**Visual Treatment:** Handled by `components/RoundResultModal.tsx`. The modal must:
- Accept the full `round_result` payload
- Know the **local player's slot** (`'player1'` or `'player2'`) to correctly label "You" vs "Opponent"
- Display `player.points` (decimal) for human readability, **not** `player.pointsRaw`
- Display the cumulative scores as `(player1TotalRaw / 100).toFixed(2)` points
- Show `solvable` as a subtle badge: `"Puzzle was solvable"` (teal) or `"Puzzle was unsolvable"` (amber)
- Auto-dismiss after **4 000 ms**, then the next `round_start` event takes over. Do NOT start a new round client-side — wait for the server event.

**State Reset on dismiss:**
1. Clear `steps`, `poolTiles`, `selectedTile`, `selectedOp`, `history` state.
2. Transition back to a `WAITING_ROUND` phase (tiles greyed out, timer bar at 100%).
3. The incoming `round_start` event will populate fresh tiles and a new `startTimestamp`.

---

### 5.2 Math Step Validation Error Toast

**Trigger:** The local client's `applyOp()` returns `null` (invalid operation — negative subtraction or non-integer division). This is a **client-side** guard only; no socket event is involved.

**Visual Treatment:**
- Toast notification (same system as `app/game/page.tsx` lines 301-308)
- Style: `bg-error-container text-on-error-container border border-error`
- Messages (map from error type):

| Condition | Message |
|---|---|
| Subtraction result <= 0 | `"Subtraction must produce a positive number."` |
| Division not exact | `"Division must be exact (no fractions)."` |
| Generic `applyOp` null | `"Invalid operation!"` |

- Duration: **3 000 ms** then auto-dismiss
- **Do not deselect the active tile or operator on error** — let the player try a different second tile without losing their selection state.

---

### 5.3 Server-Side Submission Rejection

**Trigger:** Server emits `error(...)` in response to a `submit_answer` event.

| `error.code` | Message | Cause |
|---|---|---|
| `not_in_room` | `"Submit failed: not in a match room."` | Client emitted `submit_answer` before `join_room` completed |
| `no_active_round` | `"Submit failed: no active round."` | Submission arrived after the round timer already fired |
| `not_a_player` | `"Submit failed: not recognized as a player."` | Auth/identity mismatch |

**Visual Treatment for all three:**
- Error toast (`bg-error-container`), 3 000 ms auto-dismiss
- **Do not transition the game phase** — the player stays in `PLAYING` and can attempt again if the timer has not expired
- Log to `console.error` for debugging

---

## 6 — Player Status Indicators

### 6.1 Opponent Status Badge — `player_status`

**Trigger:** Server emits `player_status({ userId, status: 'thinking' | 'submitted' })` to the opponent.

**Visual Treatment:**
- Small badge in the top-right corner of the opponent's score area
- `thinking`: grey dot + `"Thinking..."` label (no animation)
- `submitted`: green pulsing dot + `"Submitted"` label (`text-primary-fixed-dim`)
- The badge uses the same `animate-ping` dot pattern from `lobby/page.tsx` lines 251-254
- **Never reveal the opponent's actual answer or score** — only this status label is shown

---

## 7 — State Machine Summary

```
IDLE
 |-- join_room emitted
     |-- error (room_full / match_finished / not_found / auth) -> ERROR_MODAL
     |-- waiting_for_opponent -> WAITING_LOBBY
         |-- [user cancels] -> socket.disconnect() -> /lobby
         |-- opponent_joined -> PREPARING (5s countdown)
             |-- round_start -> PLAYING
                 |-- opponent_left -> OPPONENT_LEFT_MODAL -> /lobby
                 |-- disconnect -> RECONNECTING_BANNER (timer frozen)
                 |   |-- reconnect_attempt -> update banner
                 |   |-- connect + rejoin -> PLAYING (resume)
                 |   |-- reconnect_failed -> RECONNECT_FAILED_MODAL -> /lobby
                 |-- submit_answer error -> error toast (stay in PLAYING)
                 |-- round_result -> ROUND_RESULT_OVERLAY (4s)
                     |-- match_over -> GAME_OVER_MODAL (GameOverModal.tsx)
                     |-- next round_start -> PLAYING
```

---

## 8 — Implementation Checklist for AI Agents

When generating any component described in this file, verify:

- [ ] `socket.off('event_name', handler)` is called in the `useEffect` cleanup for every `socket.on(...)` registered — prevents listener accumulation on hot reload or re-mount
- [ ] Timer freeze is implemented via a React ref (`timerFrozen.current = true`), not state, to avoid re-render delay
- [ ] `socket.disconnect()` is called before `router.push(...)` on all modal CTAs
- [ ] All `socket.emit(...)` calls are gated on `isReconnecting.current === false`
- [ ] `player_status` badges never display the opponent's `resultValue` or `steps` — only `'thinking'` or `'submitted'`
- [ ] `round_result` modal reads `player.points` (decimal) for display, `player.pointsRaw` never shown raw to users
- [ ] `opponent_left` does **not** wait for `match_over` — it is self-sufficient
- [ ] `match_over` is **not** expected after `opponent_left` — do not register both handlers for the same resolution path

---

## 9 — Socket Event Quick Reference

| Event | Direction | Payload shape | UI State Triggered |
|---|---|---|---|
| `waiting_for_opponent` | S->C | `void` | Section 2.1 Waiting Lobby |
| `opponent_joined` | S->C | `{ player1Id, player2Id }` | Section 2.2 -> PREPARING |
| `round_start` | S->C | `{ roundNumber, tiles, target, startTimestamp, durationMs }` | PLAYING phase |
| `player_status` | S->C | `{ userId, status }` | Section 6.1 Badge |
| `round_result` | S->C | `{ roundNumber, solvable, player1, player2, player1TotalRaw, player2TotalRaw }` | Section 5.1 Overlay |
| `match_over` | S->C | `{ winnerId, player1TotalRaw, player2TotalRaw }` | GameOverModal.tsx |
| `opponent_left` | S->C | `void` | Section 3.1 Disconnect Modal |
| `error` | S->C | `{ code, message }` | Sections 1.x / 5.3 |
| `join_room` | C->S | `{ matchId }` | Emitted on mount |
| `player_status` | C->S | `{ status }` | Emitted on tile select / submit |
| `submit_answer` | C->S | `{ steps, resultValue }` | Emitted on Submit or timer expiry |

---

*Last updated: 2026-10-01 — reflects `countdown-server` roomHandlers.ts and roundHandlers.ts v1 implementation.*
