/**
 * =============================================================================
 * FILE: src/socket/handlers/roomHandlers.ts
 * RESPONSIBILITY: Getting two players INTO the same match room safely, and
 * cleaning up correctly if one of them leaves. This is where the
 * database (durable `matches` row) and server memory (RoomManager) halves
 * of our design actually meet — join_room reads/writes the Supabase row to
 * figure out who's allowed in, then hands off to RoomManager for the live
 * in-memory state.
 * =============================================================================
 */

import type { Server, Socket } from 'socket.io';
import { RoomManager } from '../../rooms/RoomManager';
import { adminClient } from '../../supabase/adminClient';
import { startNextRound } from './roundHandlers';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '../../types/events';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** How long a disconnected player has to come back before they forfeit. */
const RECONNECT_GRACE_MS = 15_000;

/**
 * Runs when a disconnected player's grace period expires without them
 * coming back. This is the old "immediate forfeit" logic, moved here.
 */
async function forfeitMatch(
  io: AppServer,
  roomManager: RoomManager,
  matchId: string,
  disconnectedSlot: 'player1' | 'player2'
): Promise<void> {
  const room = roomManager.getRoom(matchId);
  if (!room) return; // match already ended / cleaned up while we waited

  const remainingSlot = disconnectedSlot === 'player1' ? 'player2' : 'player1';

  // Safety net: if they reconnected, the timer should already have been
  // cancelled, but never forfeit someone who has a live socket.
  const disconnectedSocketId =
    disconnectedSlot === 'player1' ? room.player1SocketId : room.player2SocketId;
  if (disconnectedSocketId) return;

  const remainingSocketId =
    remainingSlot === 'player1' ? room.player1SocketId : room.player2SocketId;
  const remainingPlayerId = remainingSlot === 'player1' ? room.player1Id : room.player2Id;
  const disconnectedPlayerId = disconnectedSlot === 'player1' ? room.player1Id : room.player2Id;

  if (!remainingPlayerId || !disconnectedPlayerId) {
    roomManager.removeRoom(matchId);
    return;
  }

  // Both players gone: nobody is left to claim the win, so just clean up.
  if (!remainingSocketId) {
    console.warn(`[match ${matchId}] both players disconnected; discarding room without a winner.`);
    roomManager.removeRoom(matchId);
    return;
  }

  const winnerScore = remainingSlot === 'player1' ? room.player1TotalRaw : room.player2TotalRaw;
  const loserScore = remainingSlot === 'player1' ? room.player2TotalRaw : room.player1TotalRaw;

  roomManager.removeRoom(matchId);

  io.to(matchId).emit('opponent_left');

  const { error: finishError } = await adminClient.rpc('finish_match', {
    p_match_id: matchId,
    p_winner_id: remainingPlayerId,
    p_loser_id: disconnectedPlayerId,
    p_winner_score: winnerScore,
    p_loser_score: loserScore,
  });

  if (finishError) {
    console.error(`[match ${matchId}] finish_match RPC failed on disconnect forfeit:`, finishError);
  }

  // Update MMR ratings AND win/loss records for forfeit resolution.
  // Winner: mmr +25, wins +1. Loser: mmr -15 (floor 0), losses +1.
  try {
    const { data: profiles } = await adminClient
      .from('profiles')
      .select('id, mmr, wins, losses')
      .in('id', [remainingPlayerId, disconnectedPlayerId]);

    if (profiles) {
      const winnerProf = profiles.find((p) => p.id === remainingPlayerId);
      const loserProf = profiles.find((p) => p.id === disconnectedPlayerId);
      const winnerNewMmr = (winnerProf?.mmr ?? 1000) + 25;
      const loserNewMmr = Math.max(0, (loserProf?.mmr ?? 1000) - 15);
      const winnerNewWins = (winnerProf?.wins ?? 0) + 1;
      const loserNewLosses = (loserProf?.losses ?? 0) + 1;

      await Promise.all([
        adminClient.from('profiles').update({ mmr: winnerNewMmr, wins: winnerNewWins }).eq('id', remainingPlayerId),
        adminClient.from('profiles').update({ mmr: loserNewMmr, losses: loserNewLosses }).eq('id', disconnectedPlayerId),
      ]);
    }
  } catch (mmrErr) {
    console.error(`[match ${matchId}] failed to update forfeit MMR/win-loss:`, mmrErr);
  }
}

export function registerRoomHandlers(
  io: AppServer,
  socket: AppSocket,
  roomManager: RoomManager
): void {
  socket.on('join_room', async ({ matchId }) => {
    const userId = socket.data.userId; // set by authMiddleware — trusted, never from payload

    // Step 1: look up the durable match row. This is the ONLY source of
    // truth for "does this match exist, and who is player1?" — the
    // in-memory RoomManager doesn't know anything until we tell it here.
    const { data: matchRow, error: fetchError } = await adminClient
      .from('matches')
      .select('id, player1_id, player2_id, status')
      .eq('id', matchId)
      .single();

    if (fetchError || !matchRow) {
      socket.emit('error', { code: 'not_found', message: 'That match does not exist.' });
      return;
    }

    if (matchRow.status === 'finished') {
      socket.emit('error', { code: 'match_finished', message: 'This match has already ended.' });
      return;
    }

    // Step 2: figure out WHO this connecting user is, relative to the match.
    const isPlayer1 = userId === matchRow.player1_id;
    const isExistingPlayer2 = matchRow.player2_id !== null && userId === matchRow.player2_id;
    const isNewPlayer2 = matchRow.player2_id === null && !isPlayer1;

    if (!isPlayer1 && !isExistingPlayer2 && !isNewPlayer2) {
      // Someone who isn't player1, isn't the existing player2, and the
      // player2 slot is already taken by someone else entirely — this
      // room is full and this user has no legitimate reason to be here.
      socket.emit('error', { code: 'room_full', message: 'This match already has two players.' });
      return;
    }

    // Step 3: get-or-create the in-memory room, and join the Socket.io
    // "room" of the same name. socket.join(matchId) is a built-in
    // Socket.io feature — it groups sockets together so that later,
    // io.to(matchId).emit(...) reaches every socket that called
    // socket.join(matchId) with this exact name, without us having to
    // manually track a list of socket IDs ourselves.
    const room = roomManager.createRoom(matchId, matchRow.player1_id);
    if (matchRow.player2_id && !room.player2Id) {
      roomManager.joinRoom(matchId, matchRow.player2_id);
    }
    socket.join(matchId);
    socket.data.matchId = matchId; // remembered for later events on this same connection (submit_answer, disconnect, etc.)

    // ── RECONNECT PATH ─────────────────────────────────────────────────
    // If this player had a pending forfeit timer, they're coming back
    // inside the grace period: cancel the timer and resync their client.
    const returningSlot: 'player1' | 'player2' | null = isPlayer1
      ? 'player1'
      : isExistingPlayer2
        ? 'player2'
        : null;

    if (returningSlot) {
      roomManager.setSocketId(matchId, returningSlot, socket.id);
      const wasPendingForfeit = roomManager.clearDisconnectTimer(matchId, returningSlot);

      if (wasPendingForfeit && room.currentRound > 0 && room.startTimestamp && room.player2Id) {
        console.log(`[match ${matchId}] ${returningSlot} reconnected within grace period.`);

        // Dismiss the lobby overlay on the returning client...
        socket.emit('opponent_joined', {
          player1Id: room.player1Id,
          player2Id: room.player2Id,
        });
        // ...and send them the round that's currently in progress.
        socket.emit('round_start', {
          roundNumber: room.currentRound,
          tiles: room.currentTiles,
          target: room.currentTarget,
          startTimestamp: room.startTimestamp,
          durationMs: 30_000,
          player1TotalRaw: room.player1TotalRaw,
          player2TotalRaw: room.player2TotalRaw,
        });
        return;
      }
    }

    if (isPlayer1) {
      roomManager.setSocketId(matchId, 'player1', socket.id);

      const effectivePlayer2Id = room.player2Id || matchRow.player2_id;
      if (!effectivePlayer2Id) {
        // Player 1 is alone so far — nothing more to do than let them know.
        socket.emit('waiting_for_opponent');
        return;
      }

      // Second player is already associated with this match!
      if (!room.player2Id && effectivePlayer2Id) {
        roomManager.joinRoom(matchId, effectivePlayer2Id);
      }

      // Only start round 1 if both players have active sockets connected
      if (room.player1SocketId && room.player2SocketId) {
        io.to(matchId).emit('opponent_joined', {
          player1Id: matchRow.player1_id,
          player2Id: effectivePlayer2Id,
        });

        if (room.currentRound === 0) {
          startNextRound(io, roomManager, matchId);
        }
      } else if (room.currentRound > 0 && room.startTimestamp) {
        // Reconnected mid-round — send active round state
        socket.emit('round_start', {
          roundNumber: room.currentRound,
          tiles: room.currentTiles,
          target: room.currentTarget,
          startTimestamp: room.startTimestamp,
          durationMs: 30_000,
        });
      } else {
        socket.emit('waiting_for_opponent');
      }
      return;
    }

    if (isExistingPlayer2) {
      roomManager.setSocketId(matchId, 'player2', socket.id);

      if (room.player1SocketId && room.player2SocketId) {
        io.to(matchId).emit('opponent_joined', {
          player1Id: matchRow.player1_id,
          player2Id: userId,
        });

        if (room.currentRound === 0) {
          startNextRound(io, roomManager, matchId);
        }
      } else if (room.currentRound > 0 && room.startTimestamp) {
        socket.emit('round_start', {
          roundNumber: room.currentRound,
          tiles: room.currentTiles,
          target: room.currentTarget,
          startTimestamp: room.startTimestamp,
          durationMs: 30_000,
          player1TotalRaw: room.player1TotalRaw,
          player2TotalRaw: room.player2TotalRaw,
        });
      } else {
        socket.emit('waiting_for_opponent');
      }
      return;
    }

    // isNewPlayer2 — this is the moment the match actually becomes "real."
    roomManager.joinRoom(matchId, userId);
    roomManager.setSocketId(matchId, 'player2', socket.id);

    const { error: updateError } = await adminClient
      .from('matches')
      .update({ player2_id: userId, status: 'active' })
      .eq('id', matchId);

    if (updateError) {
      console.error(`[match ${matchId}] failed to write player2_id to Supabase:`, updateError);
      // We deliberately continue anyway — the live match can still be
      // played from memory even if this particular write failed.
    }

    if (room.player1SocketId && room.player2SocketId) {
      io.to(matchId).emit('opponent_joined', {
        player1Id: matchRow.player1_id,
        player2Id: userId,
      });

      // Both players are now present — kick off round 1 immediately.
      if (room.currentRound === 0) {
        startNextRound(io, roomManager, matchId);
      }
    } else {
      socket.emit('waiting_for_opponent');
    }
  });

  socket.on('cancel_room', async ({ matchId }) => {
    const room = roomManager.getRoom(matchId);
    const userId = socket.data.userId;

    if (!room) {
      socket.leave(matchId);
      socket.data.matchId = undefined;
      await adminClient.from('matches').delete().eq('id', matchId).eq('player1_id', userId).eq('status', 'pending');
      await adminClient.from('matches').update({ player2_id: null, status: 'pending' }).eq('id', matchId).eq('player2_id', userId);
      return;
    }

    if (room.player1Id === userId) {
      // Host cancelled the match
      roomManager.removeRoom(matchId);
      socket.leave(matchId);
      socket.data.matchId = undefined;
      io.to(matchId).emit('error', {
        code: 'not_found',
        message: 'The host has cancelled the match.',
      });
      const { error } = await adminClient
        .from('matches')
        .delete()
        .eq('id', matchId);
      if (error) {
        console.error(`[match ${matchId}] cancel_room DB delete failed:`, error);
      }
    } else if (room.player2Id === userId) {
      // Player 2 decided not to play and backed out of the lobby
      roomManager.clearPlayer2(matchId);
      socket.leave(matchId);
      socket.data.matchId = undefined;
      await adminClient
        .from('matches')
        .update({ player2_id: null, status: 'pending' })
        .eq('id', matchId);
      // Notify player 1 to revert to waiting state
      io.to(matchId).emit('waiting_for_opponent');
    }
  });

  socket.on('disconnect', () => {
    const matchId = socket.data.matchId;
    if (!matchId) return; // this socket never joined a room — nothing to clean up

    const room = roomManager.getRoom(matchId);
    if (!room) return; // room was already cleaned up (e.g. match already finished)

    const disconnectedSlot = roomManager.getSlotBySocketId(matchId, socket.id);
    // Stale socket: this slot already has a newer socket (player reconnected
    // before this old connection's disconnect event arrived) — ignore.
    if (!disconnectedSlot) return;

    const remainingSlot = disconnectedSlot === 'player1' ? 'player2' : 'player1';
    const remainingPlayerId = remainingSlot === 'player1' ? room.player1Id : room.player2Id;
    const disconnectedPlayerId = disconnectedSlot === 'player1' ? room.player1Id : room.player2Id;

    if (!remainingPlayerId || !disconnectedPlayerId) {
      // The match never actually had two players yet (e.g. player1
      // created a match and left before anyone joined) — just clean up.
      // Also delete the pending match row from Supabase so it doesn't
      // accumulate as a stale 'pending' entry.
      roomManager.removeRoom(matchId);
      adminClient
        .from('matches')
        .delete()
        .eq('id', matchId)
        .eq('status', 'pending')
        .then(({ error }) => {
          if (error) {
            console.error(`[match ${matchId}] failed to delete pending match row on cancel:`, error);
          }
        });
      return;
    }

    // Two-player match: give the disconnected player a grace period to
    // reconnect instead of forfeiting them immediately. The opponent is NOT
    // notified yet; they only see `opponent_left` if the timer expires.
    roomManager.clearSocketId(matchId, disconnectedSlot);

    console.log(
      `[match ${matchId}] ${disconnectedSlot} disconnected; ${RECONNECT_GRACE_MS / 1000}s to reconnect.`
    );

    const timer = setTimeout(() => {
      void forfeitMatch(io, roomManager, matchId, disconnectedSlot);
    }, RECONNECT_GRACE_MS);

    roomManager.setDisconnectTimer(matchId, disconnectedSlot, timer);
  });
}