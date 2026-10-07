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
    socket.join(matchId);
    socket.data.matchId = matchId; // remembered for later events on this same connection (submit_answer, disconnect, etc.)

    if (isPlayer1) {
      roomManager.setSocketId(matchId, 'player1', socket.id);

      if (!room.player2Id) {
        // Player 1 is alone so far — nothing more to do than let them know.
        socket.emit('waiting_for_opponent');
      }
      // (If player2 already exists and player1 is reconnecting, we fall
      // through without re-emitting opponent_joined here — a fuller
      // reconnect experience, like re-sending the current round_start
      // payload so a refreshed page can resume mid-round, is a reasonable
      // stretch goal for later but is intentionally out of scope for this
      // first working version.)
      return;
    }

    if (isExistingPlayer2) {
      roomManager.setSocketId(matchId, 'player2', socket.id);
      return; // same reconnect note as above applies here too
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
      // played from memory even if this particular write failed; the
      // failure is logged loudly so it can be investigated and, if
      // needed, the row patched up manually afterward.
    }

    io.to(matchId).emit('opponent_joined', {
      player1Id: matchRow.player1_id,
      player2Id: userId,
    });

    // Both players are now present — kick off round 1 immediately.
    startNextRound(io, roomManager, matchId);
  });

  socket.on('cancel_room', async ({ matchId }) => {
    const room = roomManager.getRoom(matchId);
    if (!room || room.player1Id !== socket.data.userId || room.player2Id) {
      return;
    }
    roomManager.removeRoom(matchId);
    socket.leave(matchId);
    const { error } = await adminClient
      .from('matches')
      .delete()
      .eq('id', matchId)
      .eq('status', 'pending');
    if (error) {
      console.error(`[match ${matchId}] cancel_room DB delete failed:`, error);
    }
  });

  socket.on('disconnect', async () => {
    const matchId = socket.data.matchId;
    if (!matchId) return; // this socket never joined a room — nothing to clean up

    const room = roomManager.getRoom(matchId);
    if (!room) return; // room was already cleaned up (e.g. match already finished)

    const disconnectedSlot = roomManager.getSlotBySocketId(matchId, socket.id);
    if (!disconnectedSlot) return; // stale socket reference, nothing to do

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

    // Design decision from system planning: a disconnect mid-match is
    // treated as an immediate forfeit, not a pause. The remaining player
    // wins outright.
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

    // Update MMR for forfeit resolution
    try {
      const { data: profiles } = await adminClient
        .from('profiles')
        .select('id, mmr')
        .in('id', [remainingPlayerId, disconnectedPlayerId]);

      if (profiles) {
        const winnerProf = profiles.find((p) => p.id === remainingPlayerId);
        const loserProf = profiles.find((p) => p.id === disconnectedPlayerId);
        const winnerNew = (winnerProf?.mmr ?? 1000) + 25;
        const loserNew = Math.max(0, (loserProf?.mmr ?? 1000) - 15);

        await Promise.all([
          adminClient.from('profiles').update({ mmr: winnerNew }).eq('id', remainingPlayerId),
          adminClient.from('profiles').update({ mmr: loserNew }).eq('id', disconnectedPlayerId),
        ]);
      }
    } catch (mmrErr) {
      console.error(`[match ${matchId}] failed to update forfeit MMR:`, mmrErr);
    }
  });
}