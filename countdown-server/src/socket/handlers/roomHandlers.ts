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
      socket.emit('error', { code: 'room_full', message: 'This match already has two players.' });
      return;
    }

    // Step 3: get-or-create the in-memory room, and join the Socket.io room.
    const room = roomManager.createRoom(matchId, matchRow.player1_id);
    socket.join(matchId);
    socket.data.matchId = matchId;

    if (isPlayer1) {
      roomManager.setSocketId(matchId, 'player1', socket.id);

      if (!room.player2Id) {
        socket.emit('waiting_for_opponent');
      }
      return;
    }

    if (isExistingPlayer2) {
      roomManager.setSocketId(matchId, 'player2', socket.id);
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
    }

    io.to(matchId).emit('opponent_joined', {
      player1Id: matchRow.player1_id,
      player2Id: userId,
    });

    // Both players are now present — kick off round 1 immediately.
    startNextRound(io, roomManager, matchId);
  });

  socket.on('disconnect', async () => {
    const matchId = socket.data.matchId;
    if (!matchId) return;

    const room = roomManager.getRoom(matchId);
    if (!room) return;

    const disconnectedSlot = roomManager.getSlotBySocketId(matchId, socket.id);
    if (!disconnectedSlot) return;

    const remainingSlot = disconnectedSlot === 'player1' ? 'player2' : 'player1';
    const remainingPlayerId = remainingSlot === 'player1' ? room.player1Id : room.player2Id;
    const disconnectedPlayerId = disconnectedSlot === 'player1' ? room.player1Id : room.player2Id;

    if (!remainingPlayerId || !disconnectedPlayerId) {
      roomManager.removeRoom(matchId);
      return;
    }

    io.to(matchId).emit('opponent_left');

    const { error: finishError } = await adminClient.rpc('finish_match', {
      p_match_id: matchId,
      p_winner_id: remainingPlayerId,
      p_loser_id: disconnectedPlayerId,
    });

    if (finishError) {
      console.error(`[match ${matchId}] finish_match RPC failed on disconnect forfeit:`, finishError);
    }

    roomManager.removeRoom(matchId);
  });
}
