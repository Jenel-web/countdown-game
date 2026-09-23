/**
 * =============================================================================
 * FILE: src/socket/handlers/roundHandlers.ts
 * RESPONSIBILITY: Everything about the lifecycle of ONE round — generating
 * the puzzle, listening for each player's submitted answer, independently
 * validating those answers, scoring the round, and either starting the next
 * round or ending the match.
 *
 * This file exports THREE things, used by other files:
 *   - startNextRound()      called by roomHandlers.ts once both players
 *                            have joined, and by this file itself after
 *                            each round to begin the next one.
 *   - registerRoundHandlers() called once per connection from index.ts,
 *                            to attach this player's `submit_answer` and
 *                            `player_status` listeners.
 *   - evaluateRound()       exported mainly so it's testable in isolation;
 *                            normally triggered internally by either "both
 *                            players submitted" or "the 30s timer expired."
 * =============================================================================
 */

import type { Server, Socket } from 'socket.io';
import { RoomManager } from '../../rooms/RoomManager';
import { adminClient } from '../../supabase/adminClient';
import {
  generateTilePool,
  generateTarget,
  checkSolvability,
  validateSubmission,
  scoreRound,
  checkMatchOver,
} from '../../game/gameEngine';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '../../types/events';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** How long players get to submit each round, in milliseconds. Matches the
 *  30-second timer already used throughout your solo/training game modes. */
const ROUND_DURATION_MS = 30_000;

/**
 * NOTE ON large-number count for multiplayer rounds:
 * Your solo lobby lets a player pick 0–4 large numbers before playing. For
 * multiplayer, this implementation defaults to 'random' every round, since
 * there's currently no agreed-upon place to store a match-level preference
 * for "how many large numbers." This is a deliberate simplification, not
 * an oversight — if you want it configurable later, the natural fix is
 * adding a `large_count` column to your `matches` table, set at creation
 * time, and reading it here instead of hardcoding 'random'.
 */

/**
 * Begins a brand-new round: generates fresh tiles/target, runs the
 * solvability check ONCE, resets the room's per-round state, starts the
 * 30-second server-side timeout, and broadcasts round_start to both
 * players simultaneously.
 */
export function startNextRound(io: AppServer, roomManager: RoomManager, matchId: string): void {
  const room = roomManager.getRoom(matchId);
  if (!room || !room.player2Id) {
    // Defensive guard: this should never be reachable in normal play,
    // since startNextRound is only ever called once both players are
    // present — but bailing out safely here is cheap insurance against a
    // future bug elsewhere accidentally calling this too early.
    return;
  }

  const tiles = generateTilePool('random');
  const target = generateTarget();
  const solveResult = checkSolvability(
    tiles.map((t) => t.value),
    target
  );

  const startTimestamp = Date.now();
  roomManager.resetRound(matchId, tiles, target, solveResult.solvable, startTimestamp);

  // Broadcast to EVERYONE currently in this Socket.io "room" (both
  // players' sockets are members of a room named after the matchId — see
  // socket.join(matchId) in roomHandlers.ts). io.to(roomName).emit(...) is
  // Socket.io's built-in way to send one message to every socket in a
  // group at once, rather than emitting twice to two individual sockets.
  io.to(matchId).emit('round_start', {
    roundNumber: room.currentRound + 1, // resetRound already incremented internally; +1 here reflects the NEW round about to display, matching resetRound's own increment — see RoomManager.resetRound
    tiles,
    target,
    startTimestamp,
    durationMs: ROUND_DURATION_MS,
  });

  // Re-fetch the room, since resetRound() already bumped currentRound —
  // we want the timer's closure to reference the CURRENT round number for
  // logging/debugging clarity, not a stale value captured before the reset.
  const timer = setTimeout(() => {
    evaluateRound(io, roomManager, matchId).catch((err) => {
      console.error(`[round ${matchId}] evaluateRound failed on timeout:`, err);
    });
  }, ROUND_DURATION_MS);

  roomManager.setRoundTimer(matchId, timer);
}

/**
 * Scores the current round (using whatever submissions exist, treating any
 * missing submission as a timeout), persists the round to Supabase,
 * updates cumulative totals, broadcasts the result, and either starts the
 * next round or ends the match.
 */
export async function evaluateRound(
  io: AppServer,
  roomManager: RoomManager,
  matchId: string
): Promise<void> {
  const room = roomManager.getRoom(matchId);
  if (!room) return;

  const p1sub = room.submissions.player1 ?? { result: null, timeMs: null };
  const p2sub = room.submissions.player2 ?? { result: null, timeMs: null };

  const scoreResult = scoreRound(room.currentTarget, room.currentSolvable, p1sub, p2sub);

  roomManager.addPoints(matchId, scoreResult.player1.pointsRaw, scoreResult.player2.pointsRaw);

  // Persist this round to the database. This is one of the deliberate
  // "meaningful checkpoint" writes from our database/memory design split —
  // everything ELSE about this round (live timer ticks, mid-round
  // selections) never touched Supabase at all.
  const { error: roundInsertError } = await adminClient.from('rounds').insert({
    match_id: matchId,
    round_number: room.currentRound,
    target: room.currentTarget,
    tiles: room.currentTiles,
    solvable: room.currentSolvable,
    player1_result: p1sub.result,
    player2_result: p2sub.result,
    player1_time_ms: p1sub.timeMs,
    player2_time_ms: p2sub.timeMs,
    player1_points: scoreResult.player1.pointsRaw,
    player2_points: scoreResult.player2.pointsRaw,
    player1_outcome: scoreResult.player1.outcome,
    player2_outcome: scoreResult.player2.outcome,
  });

  if (roundInsertError) {
    // We deliberately do NOT stop the match over a logging failure — the
    // live game experience shouldn't grind to a halt because a database
    // write hiccupped. We log it loudly so it's noticed and fixable.
    console.error(`[round ${matchId}] failed to persist round to Supabase:`, roundInsertError);
  }

  const updatedRoom = roomManager.getRoom(matchId);
  if (!updatedRoom) return; // room could theoretically vanish mid-await; bail safely

  io.to(matchId).emit('round_result', {
    roundNumber: updatedRoom.currentRound,
    solvable: scoreResult.solvable,
    player1: scoreResult.player1,
    player2: scoreResult.player2,
    player1TotalRaw: updatedRoom.player1TotalRaw,
    player2TotalRaw: updatedRoom.player2TotalRaw,
  });

  const winnerSlot = checkMatchOver(updatedRoom.player1TotalRaw, updatedRoom.player2TotalRaw);

  if (winnerSlot) {
    const winnerId = winnerSlot === 1 ? updatedRoom.player1Id : updatedRoom.player2Id!;
    const loserId = winnerSlot === 1 ? updatedRoom.player2Id! : updatedRoom.player1Id;

    // Calls the finish_match() Postgres function from Phase 3's scoring
    // schema work — a SECURITY DEFINER function that atomically marks the
    // match finished AND updates both players' wins/losses/MMR in one go.
    const { error: finishError } = await adminClient.rpc('finish_match', {
      p_match_id: matchId,
      p_winner_id: winnerId,
      p_loser_id: loserId,
      p_winner_score: winnerSlot === 1 ? updatedRoom.player1TotalRaw : updatedRoom.player2TotalRaw,
      p_loser_score: winnerSlot === 1 ? updatedRoom.player2TotalRaw : updatedRoom.player1TotalRaw,
    });

    if (finishError) {
      console.error(`[match ${matchId}] finish_match RPC failed:`, finishError);
    }

    io.to(matchId).emit('match_over', {
      winnerId,
      player1TotalRaw: updatedRoom.player1TotalRaw,
      player2TotalRaw: updatedRoom.player2TotalRaw,
    });

    roomManager.removeRoom(matchId);
  } else {
    // Nobody's reached 5 points yet — begin the next round.
    startNextRound(io, roomManager, matchId);
  }
}

/**
 * Attaches this specific connection's `submit_answer` and `player_status`
 * listeners. Called once per socket, from index.ts's connection handler.
 */
export function registerRoundHandlers(
  io: AppServer,
  socket: AppSocket,
  roomManager: RoomManager
): void {
  socket.on('player_status', ({ status }) => {
    const matchId = socket.data.matchId;
    if (!matchId) return;

    // Broadcast to everyone else in the room (not back to the sender) —
    // this is purely a cosmetic "opponent is thinking / submitted"
    // indicator, so the sender doesn't need to see their own echo.
    socket.to(matchId).emit('player_status', { userId: socket.data.userId, status });
  });

  socket.on('submit_answer', async ({ steps, resultValue }) => {
    const matchId = socket.data.matchId;
    const userId = socket.data.userId;
    if (!matchId) {
      socket.emit('error', { code: 'not_in_room', message: 'You are not currently in a match room.' });
      return;
    }

    const room = roomManager.getRoom(matchId);
    if (!room || room.startTimestamp === null) {
      socket.emit('error', { code: 'no_active_round', message: 'There is no active round to submit an answer for.' });
      return;
    }

    const slot = roomManager.getSlotByUserId(matchId, userId);
    if (!slot) {
      // This user isn't recognized as either player in this room — reject
      // outright rather than silently recording a phantom submission.
      socket.emit('error', { code: 'not_a_player', message: 'You are not a player in this match.' });
      return;
    }

    const timeMs = Date.now() - room.startTimestamp;

    // *** THE CORE "NEVER TRUST THE CLIENT" STEP ***
    // We deliberately IGNORE the client's claimed `resultValue` here and
    // independently recompute it ourselves by replaying `steps` against
    // the round's real original tiles. If the replay says the moves were
    // illegal, or the claimed result doesn't match what those moves
    // actually produce, the player is scored as if they submitted nothing
    // valid — exactly like a hostile/forged submission would be handled.
    const { valid, finalValue } = validateSubmission(
      room.currentTiles.map((t) => t.value),
      steps
    );

    const submissionResult = valid ? finalValue : null;

    roomManager.recordSubmission(matchId, slot, { result: submissionResult, timeMs });

    // Let the opponent know a submission has landed (cosmetic only).
    socket.to(matchId).emit('player_status', { userId, status: 'submitted' });

    if (roomManager.bothSubmitted(matchId)) {
      // Both players are in — no reason to wait out the rest of the
      // 30-second timer. Cancel it and evaluate immediately.
      const currentRoom = roomManager.getRoom(matchId);
      if (currentRoom?.roundTimer) clearTimeout(currentRoom.roundTimer);

      await evaluateRound(io, roomManager, matchId);
    }
  });
}