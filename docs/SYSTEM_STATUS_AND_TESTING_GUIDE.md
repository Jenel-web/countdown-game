# Countdown Game - System Status and QA Testing Guide

Audit date: 2026-10-03
Scope: lib/socket/, context/GameSocketContext.tsx, hooks/useGameSocket.ts, hooks/useRoundTimer.ts, app/game/page.tsx, app/lobby/page.tsx, components/{ErrorModal,WaitingLobby,ReconnectBanner,OpponentStatusBadge}.tsx, countdown-server/src/socket/handlers/{roomHandlers,roundHandlers}.ts, countdown-server/src/index.ts

---

## 1. Executive Summary and Capabilities Matrix

### 1.1 Implemented and Functional Features

#### Client - Socket Infrastructure

Feature | File | Status
Singleton socket factory (getSocket / destroySocket / hasSocket) | lib/socket/socketClient.ts | IMPLEMENTED
Typed ServerToClientEvents / ClientToServerEvents interfaces | lib/socket/types.ts | IMPLEMENTED
All 6 server-error codes typed as ServerErrorCode union | lib/socket/types.ts | IMPLEMENTED
GameSocketProvider - blocks child render until connect fires | context/GameSocketContext.tsx | IMPLEMENTED
AutoGameSocketProvider - fetches Supabase token automatically | context/GameSocketContext.tsx | IMPLEMENTED
isReconnecting state, set on disconnect, cleared on connect | context/GameSocketContext.tsx | IMPLEMENTED
reconnect_failed handler: destroySocket() + state reset | context/GameSocketContext.tsx | IMPLEMENTED
useGameSocket - typed emit wrapper, reconnect-gated, returns bool | hooks/useGameSocket.ts | IMPLEMENTED
useSocketEvent - safe named-handler subscription with auto-cleanup | hooks/useGameSocket.ts | IMPLEMENTED
useJoinRoom - emits join_room on mount and after every reconnect | hooks/useGameSocket.ts | IMPLEMENTED
submitAnswer convenience wrapper (auto-computes resultValue) | hooks/useGameSocket.ts | IMPLEMENTED
emitThinking convenience wrapper | hooks/useGameSocket.ts | IMPLEMENTED
Server-synchronised round timer (250ms tick, from startTimestamp) | hooks/useRoundTimer.ts | IMPLEMENTED
Timer freeze() / unfreeze() for disconnect/reconnect scenarios | hooks/useRoundTimer.ts | IMPLEMENTED
formatTimerDisplay(s) -> MM:SS helper | hooks/useRoundTimer.ts | IMPLEMENTED


#### Client - Pages and Routes

Feature | File | Status
Solo mode (/game) - full state machine IDLE->SELECTING->REVEALING->PREPARING->PLAYING->DONE | app/game/page.tsx | IMPLEMENTED
Tile pool generation, target generation, 6-tile board | app/game/page.tsx | IMPLEMENTED
Staggered tile reveal animation (200ms per tile, spring) | app/game/page.tsx | IMPLEMENTED
5-second Prepare countdown overlay | app/game/page.tsx | IMPLEMENTED
30-second local game clock with animated progress bar | app/game/page.tsx | IMPLEMENTED
Operator selection (Unicode +, minus, times, divide) | app/game/page.tsx | IMPLEMENTED
Tile click -> select -> operator -> second tile -> result pool tile | app/game/page.tsx | IMPLEMENTED
Undo (step-by-step history stack) | app/game/page.tsx | IMPLEMENTED
Clear (reset to Step 0 snapshot) | app/game/page.tsx | IMPLEMENTED
Submit -> closestValue -> toast notification | app/game/page.tsx | IMPLEMENTED
Auth guard (redirect to /login if no Supabase user) | app/game/page.tsx | IMPLEMENTED
Solvability check computed on tile generation | app/game/page.tsx | COMPUTED - not surfaced in UI
Lobby (/lobby) - profile stats (wins/losses/MMR) from Supabase | app/lobby/page.tsx | IMPLEMENTED
Create Challenge Link button | app/lobby/page.tsx | STUB - random ID only, NOT persisted to DB
Quick Match button | app/lobby/page.tsx | STUB - routes to /game (solo only), no real matchmaking

#### Client - UI Components

Component | Spec Coverage | Status
ErrorModal - full-screen glass modal with 8 preset configs | Room entry errors + reconnect_failed | IMPLEMENTED
ErrorModal - destroySocket() called before router.push() | Spec section 8 checklist | IMPLEMENTED
WaitingLobby - waiting phase (invite link + copy + cancel) | Spec section 2.1 | IMPLEMENTED
WaitingLobby - opponent_left phase (forfeit win modal) | Spec section 3.1 | IMPLEMENTED
ReconnectBanner - slide-down banner during reconnect attempts | Spec section 4.1-4.2 | IMPLEMENTED
ReconnectBanner - full-page lockout overlay (pointer-events-auto) | Spec section 4.1 | IMPLEMENTED
ReconnectBanner - section 4.3 reconnect-failed modal upgrade | Spec section 4.3 | IMPLEMENTED
OpponentStatusBadge - thinking (grey dot) / submitted (cyan ping) | Spec section 6.1 | IMPLEMENTED
OpponentScoreHeader - label + totalRaw/100 score + badge | Spec section 5.1 + 6.1 | IMPLEMENTED
GameOverModal - full match summary with MMR delta, round history | Spec section 5.x | COMPONENT READY - not integrated
RoundResultModal | Spec section 5.x | COMPONENT READY - not integrated

#### Server (countdown-server)

Feature | File | Status
Express + Socket.io server on port 4000 | index.ts | IMPLEMENTED
JWT auth middleware validates Supabase token on every connection | authMiddleware | IMPLEMENTED
CORS configured via ALLOWED_ORIGIN env var | index.ts | IMPLEMENTED
/health HTTP endpoint | index.ts | IMPLEMENTED
RoomManager - in-memory room/round state | rooms/RoomManager.ts | IMPLEMENTED
join_room handler - DB lookup, player1/player2 slot logic | roomHandlers.ts | IMPLEMENTED
waiting_for_opponent emitted to solo player1 | roomHandlers.ts | IMPLEMENTED
opponent_joined broadcast when player2 joins | roomHandlers.ts | IMPLEMENTED
Match activated in Supabase (status active, player2_id) on join | roomHandlers.ts | IMPLEMENTED
Round started immediately when both players present | roomHandlers.ts | IMPLEMENTED
error emitted for: not_found, match_finished, room_full | roomHandlers.ts | IMPLEMENTED
Disconnect = immediate forfeit; opponent_left broadcast; finish_match RPC called | roomHandlers.ts | IMPLEMENTED
startNextRound() - tile/target gen, solvability, round_start broadcast, 30s timer | roundHandlers.ts | IMPLEMENTED
submit_answer - server-side replay validation (never trusts client resultValue) | roundHandlers.ts | IMPLEMENTED
evaluateRound() - scoring, round DB insert, round_result broadcast | roundHandlers.ts | IMPLEMENTED
Match-over check after every round; match_over + finish_match RPC | roundHandlers.ts | IMPLEMENTED
Early evaluation when both players submit before timer expires | roundHandlers.ts | IMPLEMENTED
player_status - broadcast to opponent (cosmetic only) | roundHandlers.ts | IMPLEMENTED
not_in_room, no_active_round, not_a_player error codes | roundHandlers.ts | IMPLEMENTED


---

### 1.2 User Experience Overview - What a Player Can Do Today

1. Register / Login (/login, /register) - Supabase email auth. Next.js middleware enforces auth on /lobby, /game, /training; unauthenticated users are redirected to /login.

2. Lobby (/lobby) - Profile card shows wins, losses, and MMR pulled live from the profiles Supabase table. A Large Numbers stepper (0-4) is interactive but not wired to anything functional. Two CTAs exist:
   - Quick Match: navigates to /game (solo mode only).
   - Create Challenge Link: generates a 5-char random ID locally, shows a copy-link field, but the ID is NOT written to the database and cannot start a real multiplayer match.

3. Solo Game (/game) - Fully functional standalone puzzle:
   - Choose 0-4 large tiles (or random) in the SELECTING modal.
   - 6 tiles reveal one-by-one with staggered spring animations.
   - 5-second Prepare countdown overlay.
   - 30-second game clock; combine tiles with operators to reach target.
   - Calculation Log tracks steps live; computed results appear as pool tiles.
   - Undo reverts one step; Clear resets to initial board state.
   - Exact match shows a success toast; Submit or timer expiry shows closest result.
   - Play Again restarts the entire flow.

4. Multiplayer Match (/match/[matchId]) - ROUTE DOES NOT EXIST.
   The app/match/ directory is absent. All multiplayer infrastructure (socket context, hooks, server handlers, overlay components) is fully built and waiting but has not been assembled into a working page.

---

### 1.3 Pending / Not Yet Implemented Items

Gap | Severity | Detail
/match/[matchId] page does not exist | CRITICAL | app/match/ directory is absent. Socket hooks, overlays, and server handlers are ready but unassembled.
Multiplayer match creation is a stub | CRITICAL | lobby/page.tsx handleCreateChallenge() uses Math.random() and never writes to Supabase. No real match row created.
Quick Match routes to solo mode | CRITICAL | handleQuickMatch() calls router.push('/game'). No matchmaking queue exists.
Server .env is completely empty | CRITICAL | countdown-server/.env has no content. SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, ALLOWED_ORIGIN, PORT must all be set.
NEXT_PUBLIC_SOCKET_URL missing from .env.local | CRITICAL | socketClient.ts falls back to http://localhost:4000. Without this var, production deployments fail silently.
/match route not in middleware PROTECTED_PATHS | MEDIUM | middleware.ts does not protect /match. When added, unauthenticated users could load the page with no token.
Reconnect mid-round restores no state | MEDIUM | roomHandlers.ts line 89 explicitly marks this out-of-scope. Reconnecting player sees no current tiles; must wait for next round.
Large-number lobby preference not threaded to multiplayer | MEDIUM | roundHandlers.ts line 53 hardcodes 'random' for tile pool generation.
Solvability result not shown in UI | LOW | solveInfo state is computed and stored but no component renders it.
Solo game results not persisted | LOW | Solo mode is client-side only. Wins/losses/MMR are not updated after solo games.
Profile avatar is a hardcoded placeholder URL | LOW | lobby/page.tsx uses a static Google image URL for all users.
GameOverModal and RoundResultModal not integrated | LOW | Both components are fully built but not wired into any page.

---

## 2. Step-by-Step QA Testing Workflows

### Prerequisites

    # Terminal 1 - Next.js client (port 3000)
    cd "Countdown Game"
    npm run dev

    # Terminal 2 - Socket.io server (port 4000)
    # First: populate countdown-server/.env with required variables (see Section 4.4)
    cd "Countdown Game/countdown-server"
    npm run dev

---

### Test Suite 1 - Solo Mode (/game)

#### T1.1 - Full Happy-Path Game

    1. Open http://localhost:3000/login and log in with a valid account.
    2. Navigate to http://localhost:3000/game.
    3. VERIFY: 6 placeholder dimmed tile squares visible (phase=IDLE).
    4. Click "Start Game".
    5. VERIFY: SELECTING modal appears: 0 Large, 1 Large, 2 Large, 3 Large, 4 Large, Random.
    6. Click "2 Large".
    7. VERIFY: Modal closes; tiles reveal one-by-one with spring animation (~200ms per tile).
    8. VERIFY: Target number is blurred during REVEALING phase.
    9. VERIFY: After all 6 tiles reveal, "Prepare" overlay counts down 5 to 1.
    10. VERIFY: Target number becomes crisp once PLAYING starts.
    11. VERIFY: Timer bar depletes; clock shows 00:30 counting down.
    12. Click any non-used tile -> VERIFY: tile highlights (neon border, scale-105).
    13. Click operator "x" -> VERIFY: operator button highlights.
    14. Click a second non-used tile -> VERIFY: both tiles dim (used); result tile appears in
        pool row; Calculation Log shows "A x B = result".
    15. If result equals target: VERIFY success toast appears for ~3.5 seconds.
    16. Click "Submit".
    17. VERIFY: Toast shows "Solved!" (exact) or "Closest: X (off by Y)" (approximate).
    18. VERIFY: Phase = DONE; timer at 0%; "Play Again" button appears.

#### T1.2 - Operator Disabled When No Tile Selected

    1. Reach PLAYING phase.
    2. Without clicking any tile, click any operator button.
    3. VERIFY: Nothing happens. Operator does not highlight.
    Reason: disabled={phase !== 'PLAYING' || !selectedTile} on all operator buttons.

#### T1.3 - Invalid Operations

    Division non-integer (7 / 3):
      Select tile 7, op divide, tile 3.
      VERIFY: "Invalid operation!" red toast. No pool tile created.

    Subtraction negative (5 - 10):
      Select tile 5, op minus, tile 10.
      VERIFY: "Invalid operation!" red toast. No pool tile created.

    Division by zero:
      Select any tile, op divide, tile 0 (if one exists).
      VERIFY: "Invalid operation!" red toast.

#### T1.4 - Undo and Clear

    1. Perform 3 arithmetic steps.
    2. Click "Undo" -> VERIFY: last step removed from Calculation Log; original tiles restored.
    3. Perform 2 more steps.
    4. Click "Clear" -> VERIFY: board resets to initial 6-tile state; all pool tiles removed;
       Calculation Log empty.
    5. With history.length <= 1 (initial snapshot), click "Undo".
    6. VERIFY: Button is disabled.

#### T1.5 - Timer Expiry

    1. Start a game and do NOT submit.
    2. Wait 30 seconds.
    3. VERIFY: "Time's up!" error toast; phase -> DONE; Submit button gone; Play Again shown.

#### T1.6 - Auth Guard

    1. Open a private/incognito window (no session).
    2. Navigate directly to http://localhost:3000/game.
    3. VERIFY: Redirected to /login by Next.js middleware before page content renders.


---

### Test Suite 2 - Multiplayer 2-Player Flow (/match/[matchId])

NOTE: The /match/[matchId] page does not currently exist. These tests describe the
intended behaviour once the page is assembled using the existing infrastructure.

#### T2.0 - Server Health Check

    curl http://localhost:4000/health
    Expected: {"status":"ok"}
    If no response: server is not running or .env is misconfigured.

#### T2.1 - Room Pairing (Two Browser Tabs)

    1. In Supabase SQL editor, create a match row manually:
       INSERT INTO matches (player1_id, status) VALUES ('<user1_uuid>', 'pending') RETURNING id;
       Note the returned matchId (UUID).

    2. Open Tab A as User 1: navigate to http://localhost:3000/match/<matchId>
       VERIFY server console: "[connect] socket <id> authenticated as user <user1_id>"
       VERIFY Tab A WS (DevTools Network -> WS): join_room { matchId } sent.
       VERIFY Tab A WS: waiting_for_opponent received (no payload).
       VERIFY Tab A UI: WaitingLobby "Waiting for Opponent..." overlay with invite link shown.

    3. Open Tab B as User 2 (different browser or incognito):
       Navigate to http://localhost:3000/match/<matchId>
       VERIFY server console: second connection log for user2.
       VERIFY both tabs WS: opponent_joined { player1Id, player2Id } received.
       VERIFY Tab A UI: WaitingLobby overlay dismisses; round tiles appear.
       VERIFY Tab B UI: Round tiles appear immediately.
       VERIFY both tabs WS: round_start { roundNumber:1, tiles:[...], target, startTimestamp,
                                          durationMs:30000 } received.

#### T2.2 - Round Timer Synchronisation

    1. After round_start fires (T2.1 step 3):
    2. In Tab A DevTools WS, note the startTimestamp from round_start payload.
    3. In Tab B DevTools WS, note the same startTimestamp.
    4. VERIFY: Both tabs received the identical startTimestamp integer.
    5. VERIFY: Both MM:SS timers show the same integer second (within +/-1 second for render lag).
    6. Wait 10 seconds -> VERIFY: Both timers still agree within +/-1 second.

#### T2.3 - Opponent Status Badge

    1. In Tab A (User 1): Click any tile.
       VERIFY Tab A WS: player_status { status: "thinking" } emitted.
       VERIFY Tab B UI: OpponentStatusBadge shows "Thinking..." (grey dot, no animation).

    2. In Tab A: Click Submit.
       VERIFY Tab A WS: submit_answer { steps:[...], resultValue } emitted.
       VERIFY Tab B WS: player_status { userId, status: "submitted" } received.
       VERIFY Tab B UI: OpponentStatusBadge shows "Submitted" (cyan pulsing dot).

#### T2.4 - Phase Transitions and Scoring

    1. Both players submit (or let timer expire).
       VERIFY both tabs WS: round_result { roundNumber, solvable, player1, player2,
                                           player1TotalRaw, player2TotalRaw } within ~200ms.
       VERIFY both tabs UI: RoundResultModal appears.

    2. Next round starts automatically.
       VERIFY both tabs WS: round_start for roundNumber+1 received.
       VERIFY UI: OpponentStatusBadge resets to null.

    3. Continue rounds until match-over threshold reached.
       VERIFY both tabs WS: match_over { winnerId, player1TotalRaw, player2TotalRaw } received.
       VERIFY both tabs UI: GameOverModal appears.

---

### Test Suite 3 - Room and Auth Edge Cases

#### T3.1 - Join a Full Room (Third Player)

    1. Set both player1_id and player2_id in the match row in Supabase:
       UPDATE matches SET player2_id = '<other_uuid>', status = 'active' WHERE id = '<matchId>';
    2. Open a Tab as a THIRD user -> navigate to /match/<matchId>.
       VERIFY WS: error { code: "room_full", message: "This match already has two players." }
       VERIFY UI: ErrorModal "Match Full" - "This challenge link has already been claimed."
       VERIFY: User MUST click "Back to Lobby" to exit (no dismiss action on backdrop).

#### T3.2 - Join a Non-Existent Match

    1. Navigate to /match/totally-fake-id-00000.
       VERIFY WS: error { code: "not_found" }
       VERIFY UI: ErrorModal "Room Not Found".

#### T3.3 - Join a Finished Match

    1. Set a match to status = 'finished' in Supabase.
    2. Navigate to /match/<matchId>.
       VERIFY WS: error { code: "match_finished" }
       VERIFY UI: ErrorModal "Match Already Ended".

#### T3.4 - Auth Token Missing or Expired

    1. Navigate to /match/<matchId> without a valid Supabase session.
       Middleware path: Next.js middleware redirects to /login (once /match added to PROTECTED_PATHS).
       AutoGameSocketProvider path: If page renders, getSession() returns null ->
         DOM renders "Session expired. Please log in again."
       VERIFY: No WS frames visible in DevTools Network tab.

#### T3.5 - Submit After Round Timer Server-Side Expiry

    1. In a live match, let the server's 30s timer naturally fire evaluateRound().
    2. Immediately attempt to emit submit_answer from the client.
       VERIFY WS: error { code: "no_active_round" }
       VERIFY: No double-scoring occurs.

#### T3.6 - Operator Constraint Edge Cases (Solo Mode)

    Case A - Division non-integer (7 / 3):
      VERIFY: "Invalid operation!" toast. No NaN tile in pool.

    Case B - Subtraction negative (5 - 10):
      VERIFY: "Invalid operation!" toast. No negative tile in pool.

    Case C - Valid calculation chain:
      5 x 5 = 25 -> use 25 pool tile -> 25 + 50 = 75.
      VERIFY: Each step appears correctly in Calculation Log.

---

### Test Suite 4 - Network and Disconnect Resiliency

#### T4.1 - Client Disconnects and Reconnects (Chrome DevTools Offline Toggle)

    1. Open a 2-player match (T2.1 complete, round in progress).
    2. In Tab A DevTools -> Network -> throttle dropdown -> select "Offline".
       VERIFY Tab A UI: ReconnectBanner slides in from the top (spinning icon).
       VERIFY Tab A UI: Full-page lockout overlay covers all buttons (pointer-events-auto).
       VERIFY Tab A console: Any emit attempt logs:
         "[useGameSocket] emit('...') dropped - socket is reconnecting"
       VERIFY Tab B: No immediate visible change.

    3. Re-enable network (remove Offline mode).
       VERIFY Tab A UI: Banner slides back up; lockout overlay fades out; buttons interactive.
       VERIFY Tab A WS: join_room { matchId } re-emitted automatically by useJoinRoom().
       VERIFY server console: new connection log for Tab A's user.

#### T4.2 - Opponent Tab Closed Mid-Match

    1. Open a 2-player match (T2.1 complete).
    2. Close Tab B entirely (User 2 leaves).
       VERIFY server console: disconnect handler fires; slot identified.
       VERIFY Tab A WS: opponent_left (no payload) received within ~2 seconds.
       VERIFY Tab A UI: WaitingLobby "opponent_left" phase:
         - wifi_off icon (pulsing, primary-fixed-dim colour)
         - Headline: "Opponent Disconnected"
         - Body: "Your opponent left the game. You win by forfeit!"
         - CTA: "Claim Victory & Continue"
       VERIFY server: finish_match RPC called with remaining player as winner.

    3. Click "Claim Victory & Continue" in Tab A.
       VERIFY: destroySocket() called -> router.push('/lobby').
       VERIFY server logs: No "finish_match RPC failed" error message.

#### T4.3 - All 5 Reconnect Attempts Fail

    1. Open a 2-player match.
    2. In Tab A, go Offline and keep it offline for >2 minutes.
       VERIFY Tab A UI: Banner updates each attempt:
         "Reconnecting... (attempt 1)" -> ... -> "Reconnecting... (attempt 5)"
       VERIFY: Delays grow with jitter (1s, ~2s, ~4s, ~8s, ~10s - capped by reconnectionDelayMax).

    3. After 5 failures, reconnect_failed fires.
       VERIFY Tab A GameSocketContext: onReconnectFailed() runs:
         setIsConnected(false), setIsReconnecting(false), destroySocket() called (singleton cleared).
       VERIFY Tab A UI: ReconnectBanner upgrades to full-page modal:
         - signal_disconnected icon (error colour)
         - Headline: "Connection Failed"
         - Body: "We couldn't reconnect to the game server. Your progress has been saved."
         - CTA: "Return to Lobby"

    4. Click "Return to Lobby".
       VERIFY: destroySocket() called (safe no-op - singleton already null).
       VERIFY: Navigates to /lobby.

#### T4.4 - Player1 Creates Match Then Leaves Before Opponent Joins

    1. Player1 joins /match/<matchId> (player2_id = null in DB).
       VERIFY Tab A: WaitingLobby "waiting" phase shown.
    2. Player1 closes the tab.
       VERIFY server: disconnect handler fires; room found; player2Id = null.
       VERIFY server: roomManager.removeRoom() called.
       VERIFY server: NO opponent_left emitted; NO finish_match RPC called.
       VERIFY Supabase: Match row stays in 'pending' status (no forfeit recorded).


---

## 3. Expected Behavior vs. Failure Indicators

### Solo Mode Tests

Test Case | Expected Behavior (PASS) | Failure Indicators (FAIL)
T1.1 Happy Path | Phases cycle IDLE to DONE. Each transition is animated. Toast on submit. | Phase stuck at IDLE. Tiles do not reveal (revealedCount stuck). Timer never starts.
T1.2 Operator No-Tile | Operator buttons are visually disabled; no state changes. | Operator highlights with no tile selected - selectedOp state set erroneously.
T1.3 Invalid Ops | "Invalid operation!" toast. No NaN or negative pool tile appears. | applyOp() returns null silently without toast. Pool tile with NaN or negative value appears. App throws TypeError.
T1.4 Undo/Clear | Undo removes exactly one snapshot. Clear restores the exact initial state. | History grows beyond undo scope. Clear leaves generated pool tiles on the board. Undo below index 0 causes undefined state crash.
T1.5 Timer Expiry | Phase -> DONE after gameTime reaches 0. "Time's up!" toast visible. Submit button gone. | Timer hits 0 but Submit remains active. Phase stays PLAYING. Multiple setTimeout handles leaked.
T1.6 Auth Guard | Redirected to /login before page content renders. | /game page renders fully for unauthenticated user. No redirect occurs.

### Multiplayer Flow Tests

Test Case | Expected Behavior (PASS) | Failure Indicators (FAIL)
T2.1 Room Pairing | Two server connection logs; opponent_joined in both tabs; WaitingLobby dismisses. | Only one connection log (second player failed auth). opponent_joined in one tab only. WaitingLobby never dismisses.
T2.2 Timer Sync | Both timers agree within +/-1 second throughout the round. | Timers diverge by >2 seconds. One timer hits 0 before the other by >2 seconds.
T2.3 Status Badge | Badge changes on tile click (thinking) and on submit (submitted). Resets on new round_start. | Badge never updates - listener not registered or handler leaked. Shows own player's status instead of opponent's.
T2.4 Phase Transitions | round_result in both tabs within ~200ms. round_start auto-fires. match_over fires correctly. | round_result in one tab only. Server logs evaluateRound failed. match_over fires prematurely.

### Room and Auth Edge Case Tests

Test Case | Expected Behavior (PASS) | Failure Indicators (FAIL)
T3.1 Full Room | error { code: "room_full" } received; ErrorModal shown; game does not start. | No error; third user silently joins; 3-player state corruption; server crash.
T3.2 Not Found | error { code: "not_found" } received; ErrorModal shown. | Page crashes with unhandled error. Infinite loading spinner. No WS error event.
T3.3 Finished Match | error { code: "match_finished" } received; ErrorModal shown. | Server restarts a completed match and re-emits round_start on a finished DB row.
T3.4 Auth Failure | No socket connection attempted; session-expired message displayed. | Socket connects with null userId; server logs unhandled middleware rejection; game renders with no identity.
T3.5 Late Submit | error { code: "no_active_round" } received; no double-scoring occurs. | Server records phantom submission; round scored twice; evaluateRound throws on null room.
T3.6 Bad Operators | All invalid ops produce toast; no corrupted pool tiles. | NaN or negative tile appears in pool and is usable as an operand; final score corrupted.

### Network and Disconnect Resiliency Tests

Test Case | Expected Behavior (PASS) | Failure Indicators (FAIL)
T4.1 Offline Toggle | ReconnectBanner appears within 1s. Lockout prevents all clicks. Banner dismisses on reconnect. join_room re-emitted automatically. | Banner never appears. Buttons remain clickable while offline. join_room not re-emitted after reconnect (player unregistered in RoomManager).
T4.2 Opponent Tab Close | opponent_left arrives within ~2s. Forfeit win modal appears. finish_match RPC succeeds. | opponent_left never fires. Modal never appears. Supabase RPC error. Stats not updated.
T4.3 All 5 Retries Fail | After 5 attempts, full-page failed modal appears. destroySocket() clears singleton. | Infinite reconnection loop (ignores reconnectionAttempts: 5). Full-page modal never appears. Dead singleton reused on next match visit.
T4.4 Abandon Pre-Join | No opponent_left emitted. No finish_match called. Room cleaned up quietly. | finish_match called with null player IDs; Supabase RPC crash; unhandled rejection logged to server.


---

## 4. Diagnostics and Debugging Cheatsheet

### 4.1 Browser Console Logs to Expect

On successful multiplayer connection (server terminal, not browser):
    [connect] socket <socket_id> authenticated as user <user_uuid>

On emit dropped during reconnect (browser console):
    [useGameSocket] emit('submit_answer') dropped - socket is reconnecting

If you see this without a visible ReconnectBanner, isReconnecting is not propagating
correctly from GameSocketContext to the component tree.

On auth failure in AutoGameSocketProvider (DOM rendered text, not console):
    Session expired. Please log in again.

If user is actually authenticated, check whether supabase.auth.getSession() is returning
a stale null before the session refreshes.

---

### 4.2 Network Tab / WebSocket Inspection Guide

Open DevTools -> Network -> filter by "WS" -> click the WebSocket entry -> Messages tab.

FRAMES TO VERIFY AT MATCH START:
  Direction          | Event                 | Expected Payload
  Client -> Server   | join_room             | { matchId: "<uuid>" }
  Server -> Client   | waiting_for_opponent  | (no payload)
  Server -> Client   | opponent_joined       | { player1Id: "<uuid>", player2Id: "<uuid>" }
  Server -> Client   | round_start           | { roundNumber: 1, tiles: [...], target: N,
                     |                        |   startTimestamp: <epoch_ms>, durationMs: 30000 }

FRAMES TO VERIFY DURING A ROUND:
  Direction          | Event                 | Expected Payload
  Client -> Server   | player_status         | { status: "thinking" }
  Server -> Client   | player_status         | { userId: "<uuid>", status: "thinking" or "submitted" }
  Client -> Server   | submit_answer         | { steps: [{a,op,b,result},...], resultValue: N }
  Server -> Client   | round_result          | { roundNumber, solvable, player1, player2,
                     |                        |   player1TotalRaw, player2TotalRaw }
  Server -> Client   | match_over            | { winnerId, player1TotalRaw, player2TotalRaw }

RED-FLAG FRAMES (investigate immediately):
  Frame Received                        | What It Signals
  error { code: "not_in_room" }         | submit_answer fired before join_room completed - race condition in page mount
  error { code: "no_active_round" }     | Client submitted after server's 30s timer already called evaluateRound
  error { code: "not_a_player" }        | socket.data.userId not matching either slot - authMiddleware set wrong userId
  Duplicate round_start events          | startNextRound() called twice - possible race between timer expiry and bothSubmitted
  No WS frames at all                   | CORS block, missing SUPABASE_SERVICE_ROLE_KEY, or server not running

---

### 4.3 Common Root Causes

PROBLEM: Socket never connects (no WS frames in DevTools)
  1. countdown-server/.env is empty - SUPABASE_SERVICE_ROLE_KEY required for authMiddleware;
     without it every handshake is rejected before any game event can fire.
  2. NEXT_PUBLIC_SOCKET_URL missing - socketClient.ts defaults to http://localhost:4000; if the
     server is on a different host/port, the connection silently fails.
  3. CORS mismatch - ALLOWED_ORIGIN in server .env must exactly match the client origin string
     (protocol + host + port). A mismatch causes a failed WebSocket upgrade request.

PROBLEM: Event listener accumulation (events fire 2x or more per emission)
  Root cause: inline arrow function passed to socket.on() inside a React component.
  socket.off() cannot remove it because each render creates a new function reference.
  Fix: always use useSocketEvent() from hooks/useGameSocket.ts. It uses the stable-wrapper
  + ref pattern and structurally guarantees cleanup.
  Diagnosis: add a render counter inside a handler. If it increments by >1 per server
  emission, listeners are leaking across mounts or hot reloads.

PROBLEM: Timer desync between two clients
  Root cause: using Date.now() at the moment the client receives round_start, instead of
  using payload.startTimestamp.
  Fix: always call timerControls.start(payload.startTimestamp, payload.durationMs).
  The useRoundTimer hook computes remaining time against the server's clock, not the local
  receive time, so latency differences are absorbed once at round_start and never accumulate.

PROBLEM: Buttons unresponsive after reconnect (lockout overlay persists)
  Root cause: destroySocket() was called mid-session (not on reconnect_failed). The
  GameSocketContext holds a stale ref to the destroyed socket; isReconnecting may never
  transition back to false.
  Fix: only call destroySocket() inside onReconnectFailed, on explicit logout, or on
  deliberate navigation away from the match page. Never call it during a normal reconnect cycle.

PROBLEM: Server throws on finish_match (second call on an already-finished match)
  Root cause: evaluateRound and the disconnect handler both found a non-null room and raced
  to call finish_match.
  Guard already in place: roomManager.removeRoom() is called SYNCHRONOUSLY before any await
  in both handlers. Node.js only context-switches at await points; the first handler to run
  owns the room removal, and any concurrent handler finds no room and exits early.
  If still occurring, check whether roomManager.getRoom() is returning a stale reference.

---

### 4.4 Required Environment Variables Checklist

CLIENT (Countdown Game/.env.local):
  Variable                        | Current Status | Required For
  NEXT_PUBLIC_SUPABASE_URL        | SET            | All Supabase client calls
  NEXT_PUBLIC_SUPABASE_ANON_KEY   | SET            | Auth, DB reads
  NEXT_PUBLIC_SOCKET_URL          | MISSING        | Socket connection in any non-localhost environment

SERVER (countdown-server/.env):
  Variable                        | Current Status | Required For
  SUPABASE_URL                    | MISSING        | adminClient initialisation
  SUPABASE_SERVICE_ROLE_KEY       | MISSING        | authMiddleware JWT verification; all server-side DB writes
  ALLOWED_ORIGIN                  | MISSING        | CORS (defaults to http://localhost:3000)
  PORT                            | MISSING        | Server listen port (defaults to 4000)

WARNING: The server .env file is completely empty. The countdown-server cannot authenticate
any player without SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL. Every socket connection will
be rejected at the authMiddleware stage before any game event can be processed.

---

## 5. Event Flow Reference Diagram

    Player 1 joins /match/<id>
      +-> AutoGameSocketProvider fetches session -> GameSocketProvider connects socket
      +-> useJoinRoom emits: join_room { matchId }
      +-> [server] roomHandlers: DB lookup -> player1 registered in RoomManager
             +-> waiting_for_opponent -> Tab A: WaitingLobby "Waiting..." overlay

    Player 2 joins /match/<id>
      +-> join_room { matchId }
      +-> [server] joinRoom() -> writes player2_id + status='active' to Supabase
             +-> opponent_joined { player1Id, player2Id }
                   -> Both tabs: mySlot derived from userId vs player1Id comparison
             +-> startNextRound()
                    +-> round_start { roundNumber:1, tiles, target, startTimestamp, durationMs:30000 }
                          -> Both tabs: useRoundTimer.start(startTimestamp, durationMs)

    [During 30-second round]
      Tab A clicks tile  --> emitThinking() -> player_status { "thinking" }
                                            -> Tab B: "Thinking..." badge (grey dot)
      Tab A submits      --> submit_answer { steps, resultValue }
                               +-> [server] validateSubmission() - server-side replay,
                                   IGNORES client's claimed resultValue
                                      +-> player_status { "submitted" } -> Tab B: cyan pulsing dot
                                      +-> if bothSubmitted: clearTimeout + evaluateRound()

    [30s timer fires OR both submitted]
      evaluateRound()
        +-> scoreRound() -> persist round row to Supabase rounds table
        +-> round_result { roundNumber, solvable, player1, player2, totals }
              -> Both tabs receive simultaneously
        +-> checkMatchOver()?
              YES -> finish_match RPC called
                  -> match_over { winnerId, totals } -> Both tabs: GameOverModal
              NO  -> startNextRound() -> next round_start emitted

    [Opponent disconnects / tab closes]
      socket 'disconnect'
        +-> [server] roomManager.removeRoom() called SYNCHRONOUSLY (before any await)
        +-> opponent_left emitted -> Remaining tab: WaitingLobby forfeit win modal
        +-> finish_match RPC called (async, after emit)

    [All 5 reconnect attempts fail]
      reconnect_failed fires
        +-> [context] onReconnectFailed: setIsConnected(false), destroySocket() singleton cleared
        +-> [UI] ReconnectBanner upgrades to full-page "Connection Failed" modal

