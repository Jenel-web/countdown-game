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
import { RoomManager, type SubmissionStep } from '../../rooms/RoomManager';
import { adminClient } from '../../supabase/adminClient';
import {
  generateTilePool,
  generateTarget,
  findBestSolution,
  validateSubmission,
  scoreRound,
  checkMatchOver,
} from '../../game/gameEngine';
import {
  isSubmissionTooEarly,
  parsePlayerStatus,
  parseSubmitPayload,
  safeHandler,
} from '../validation';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '../../types/events';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** How long players spend in preparation countdown before gameplay begins. */
const ROUND_PREP_MS = process.env.NODE_ENV === 'test' ? 0 : 5_000;

/** How long players get to submit once gameplay begins (exactly 30 seconds). */
const ROUND_DURATION_MS = 30_000;

/** How long the RoundResultModal is displayed between rounds before the next round starts. */
export const ROUND_RESULT_DISPLAY_MS = process.env.NODE_ENV === 'test' ? 50 : 5_000;


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
 * 35-second total timeout (5s prep + 30s gameplay), and broadcasts round_start
 * with startTimestamp set to the exact moment gameplay begins.
 */
export function startNextRound(io: AppServer, roomManager: RoomManager, matchId: string): void {
  const room = roomManager.getRoom(matchId);
  if (!room || !room.player2Id) {
    return;
  }

  const tiles = generateTilePool('random');
  const target = generateTarget();
  const bestSolution = findBestSolution(
    tiles.map((t) => t.value),
    target
  );
  const solvable = bestSolution.diff === 0;
  // The 30-second gameplay starts exactly 5 seconds from now (after the 5s prep countdown).
  const now = Date.now();
  const gameplayStartTimestamp = now + ROUND_PREP_MS;
  roomManager.resetRound(matchId, tiles, target, solvable, gameplayStartTimestamp, bestSolution); io.to(matchId).emit('round_start', {
    roundNumber: room.currentRound,
    tiles,
    target,
    startTimestamp: gameplayStartTimestamp,
    durationMs: ROUND_DURATION_MS,
  });

  const totalRoundDurationMs = ROUND_PREP_MS + ROUND_DURATION_MS;
  const timer = setTimeout(() => {
    evaluateRound(io, roomManager, matchId).catch((err) => {
      console.error(`[round ${matchId}] evaluateRound failed on timeout:`, err);
    });
  }, totalRoundDurationMs);

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

  // Claim this round's scoring BEFORE any await. The 30s timer, a "both
  // submitted" and any repeated submit_answer can all arrive here for the same
  // round; only the first caller may score it, otherwise points are added
  // twice, a second rounds row is written and a second next-round is queued.
  if (!roomManager.beginEvaluation(matchId)) return;

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
    // Validated steps each player took, shown in the History tab. Null when
    // nobody submitted (timeout) so old and empty rounds look the same.
    player1_steps: p1sub.steps?.length ? p1sub.steps : null,
    player2_steps: p2sub.steps?.length ? p2sub.steps : null,
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
    bestSolution: updatedRoom.currentBestSolution ?? undefined,
    player1: {
      ...scoreResult.player1,
      result: p1sub.result,
      timeMs: p1sub.timeMs,
      steps: p1sub.steps ?? [],
      diff: p1sub.result !== null ? Math.abs(p1sub.result - room.currentTarget) : null,
    },
    player2: {
      ...scoreResult.player2,
      result: p2sub.result,
      timeMs: p2sub.timeMs,
      steps: p2sub.steps ?? [],
      diff: p2sub.result !== null ? Math.abs(p2sub.result - room.currentTarget) : null,
    },
    player1TotalRaw: updatedRoom.player1TotalRaw,
    player2TotalRaw: updatedRoom.player2TotalRaw,
  });

  const winnerSlot = checkMatchOver(updatedRoom.player1TotalRaw, updatedRoom.player2TotalRaw);

  if (winnerSlot) {
    const winnerId = winnerSlot === 1 ? updatedRoom.player1Id : updatedRoom.player2Id!;
    const loserId = winnerSlot === 1 ? updatedRoom.player2Id! : updatedRoom.player1Id;

    // Snapshot everything we need, then claim (remove) the room BEFORE any
    // `await` — same principle as the disconnect handler: a concurrent
    // disconnect must not be able to find this room and start a second,
    // contradictory forfeit while we're waiting on the database.
    const winnerScore = winnerSlot === 1 ? updatedRoom.player1TotalRaw : updatedRoom.player2TotalRaw;
    const loserScore = winnerSlot === 1 ? updatedRoom.player2TotalRaw : updatedRoom.player1TotalRaw;
    const finalTotals = {
      player1TotalRaw: updatedRoom.player1TotalRaw,
      player2TotalRaw: updatedRoom.player2TotalRaw,
    };
    roomManager.removeRoom(matchId);

    // Calls the 5-argument finish_match() Postgres function (SECURITY
    // DEFINER, idempotent). In ONE transaction it completes the match row
    // (status, winner, scores, ended_at) and updates both players' wins,
    // losses, matches_played and MMR (+25 winner, -15 loser, floor 0).
    // Nothing else may write those columns.
    const { error: finishError } = await adminClient.rpc('finish_match', {
      p_match_id: matchId,
      p_winner_id: winnerId,
      p_loser_id: loserId,
      p_winner_score: winnerScore,
      p_loser_score: loserScore,
    });

    if (finishError) {
      console.error(`[match ${matchId}] finish_match RPC failed:`, finishError);
    }

    io.to(matchId).emit('match_over', { winnerId, ...finalTotals });
  } else {
    // Nobody's reached 5 points yet — give both players 5 seconds to review the RoundResultModal
    setTimeout(() => {
      if (roomManager.getRoom(matchId)) {
        startNextRound(io, roomManager, matchId);
      }
    }, ROUND_RESULT_DISPLAY_MS);
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
  socket.on(
    'player_status',
    safeHandler('player_status', (payload) => {
      const matchId = socket.data.matchId;
      if (!matchId) return;

      const status = parsePlayerStatus(payload);
      if (!status) return;

      // Broadcast to everyone else in the room (not back to the sender) —
      // this is purely a cosmetic "opponent is thinking / submitted"
      // indicator, so the sender doesn't need to see their own echo.
      socket.to(matchId).emit('player_status', { userId: socket.data.userId, status });
    })
  );

  socket.on(
    'submit_answer',
    safeHandler('submit_answer', async (payload) => {
      const matchId = socket.data.matchId;
      const userId = socket.data.userId;
      if (!matchId) {
        socket.emit('error', { code: 'not_in_room', message: 'You are not currently in a match room.' });
        return;
      }

      // Shape check only: the contents of `steps` are validated by the engine.
      const steps = parseSubmitPayload(payload);
      if (!steps) {
        console.warn(`[match ${matchId}] dropped malformed submit_answer from ${userId}`);
        return;
      }

      const room = roomManager.getRoom(matchId);
      // roundPhase !== 'active' covers both "no round yet" and "this round is
      // already being / has been scored" (the window between rounds).
      if (!room || room.roundPhase !== 'active' || room.startTimestamp === null) {
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

      const now = Date.now();
      if (isSubmissionTooEarly(now, room.startTimestamp)) {
        // Tiles are visible during the prep countdown; answers are not
        // accepted until gameplay starts (minus a small clock-skew allowance).
        socket.emit('error', { code: 'no_active_round', message: 'The round has not started yet.' });
        return;
      }

      // The first submission is final. A repeated click, or a client replaying
      // the event, must not overwrite it or re-trigger scoring.
      if (room.submissions[slot]) return;

      // Never negative, so the allowed early window can't win speed tiebreaks.
      const timeMs = Math.max(0, now - room.startTimestamp);

      // *** THE CORE "NEVER TRUST THE CLIENT" STEP ***
      // We deliberately IGNORE the client's claimed `resultValue` here and
      // independently recompute it ourselves by replaying `steps` against
      // the round's real original tiles. If the replay says the moves were
      // illegal, or the claimed result doesn't match what those moves
      // actually produce, the player is scored as if they submitted nothing
      // valid — exactly like a hostile/forged submission would be handled.
      const { valid, finalValue } = validateSubmission(
        room.currentTiles.map((t) => t.value),
        steps as Parameters<typeof validateSubmission>[1]
      );

      const recorded = roomManager.recordSubmission(matchId, slot, {
        result: valid ? finalValue : null,
        timeMs,
        // Only keep steps that passed server-side validation
        steps: valid ? (steps as SubmissionStep[]) : [],
      });
      if (!recorded) return;

      // Let the opponent know a submission has landed (cosmetic only).
      socket.to(matchId).emit('player_status', { userId, status: 'submitted' });

      if (roomManager.bothSubmitted(matchId)) {
        // Both players are in — no reason to wait out the rest of the
        // 30-second timer. Cancel it and evaluate immediately.
        const currentRoom = roomManager.getRoom(matchId);
        if (currentRoom?.roundTimer) clearTimeout(currentRoom.roundTimer);

        await evaluateRound(io, roomManager, matchId);
      }
    })
  );
}
