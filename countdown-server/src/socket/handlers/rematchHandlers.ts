/**
 * =============================================================================
 * FILE: src/socket/handlers/rematchHandlers.ts
 * RESPONSIBILITY: Negotiate a rematch after a match ends.
 *
 * Flow:
 *  1. Player A clicks "Play Again" -> emits request_rematch { matchId }.
 *  2. Server records the pending offer (keyed by finished matchId) and
 *     emits rematch_offer to Player B via the shared socket.io room.
 *  3. Player B sees a modal and emits rematch_response { accepted }.
 *  4a. If accepted: server creates a new match row (A as player1_id),
 *      emits rematch_accepted { newMatchId } to both, cleans up.
 *  4b. If declined: server emits rematch_declined to Player A, cleans up.
 *
 * After match_over both sockets are still members of the finished matchId
 * socket.io room (until they navigate away), so socket.to(matchId).emit()
 * still reaches the opponent without any additional bookkeeping.
 * =============================================================================
 */

import type { Server, Socket } from 'socket.io';
import { adminClient } from '../../supabase/adminClient';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '../../types/events';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

interface PendingOffer {
  requesterSocketId: string;
  requesterUserId: string;
}

/** Module-level map: finished matchId -> pending rematch offer */
const pendingOffers = new Map<string, PendingOffer>();

export function registerRematchHandlers(
  io: AppServer,
  socket: AppSocket
): void {

  socket.on('request_rematch', ({ matchId }) => {
    const userId = socket.data.userId;

    // Ignore duplicate requests for the same finished match.
    if (pendingOffers.has(matchId)) return;

    pendingOffers.set(matchId, {
      requesterSocketId: socket.id,
      requesterUserId: userId,
    });

    // Both players are still in the socket.io room named after the finished
    // matchId — emit to everyone else in that room (i.e. the opponent).
    socket.to(matchId).emit('rematch_offer');

    // Auto-expire after 60 s so the Map doesn't leak if the opponent
    // navigates away without responding.
    setTimeout(() => {
      pendingOffers.delete(matchId);
    }, 60_000);
  });

  socket.on('rematch_response', async ({ matchId, accepted }) => {
    const offer = pendingOffers.get(matchId);
    if (!offer) return; // expired or already handled

    // Claim synchronously before any await to prevent a second handler
    // from racing in during the DB insert.
    pendingOffers.delete(matchId);

    if (!accepted) {
      // Notify only the requester that their offer was rejected.
      io.to(offer.requesterSocketId).emit('rematch_declined');
      return;
    }

    // Create a fresh match row; both players are immediately registered.
    const { data, error } = await adminClient
      .from('matches')
      .insert({
        player1_id: offer.requesterUserId,
        player2_id: socket.data.userId,
        status: 'active',
      })
      .select('id')
      .single();

    if (error || !data?.id) {
      console.error('[rematch] failed to create new match row:', error);
      // Unblock both players with an error they can dismiss.
      io.to(matchId).emit('error', {
        code: 'not_found' as const,
        message: 'Could not start rematch. Please return to the lobby.',
      });
      return;
    }

    // Tell both players to navigate to the new match.
    io.to(matchId).emit('rematch_accepted', { newMatchId: data.id });
  });

  socket.on('disconnect', () => {
    for (const [matchId, offer] of pendingOffers.entries()) {
      if (offer.requesterSocketId === socket.id) {
        pendingOffers.delete(matchId);
      } else if (socket.data.matchId === matchId) {
        // The opponent disconnected while a rematch offer was pending for this match
        io.to(offer.requesterSocketId).emit('rematch_declined');
        pendingOffers.delete(matchId);
      }
    }
  });
}
