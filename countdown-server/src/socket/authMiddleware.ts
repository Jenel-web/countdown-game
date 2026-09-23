/**
 * =============================================================================
 * FILE: src/socket/authMiddleware.ts
 * RESPONSIBILITY: Run BEFORE any game logic touches a new connection, to
 * verify the connecting browser really is who it claims to be — using the
 * same Supabase session token your Next.js app already has, no separate
 * password prompt needed.
 *
 * BEGINNER NOTE — what a Socket.io "middleware" actually is:
 * This is conceptually identical to Next.js middleware.ts, which you've
 * already used to protect /lobby and /game — code that runs on EVERY
 * incoming request/connection, before your actual route/event logic gets
 * a chance to run. Here, `io.use(authMiddleware)` (wired up in
 * src/index.ts) means this function runs for every single socket that
 * tries to connect, and it has the power to REJECT a connection outright
 * by calling `next(someError)` instead of `next()`.
 * =============================================================================
 */

import type { Socket } from 'socket.io';
import { adminClient } from '../supabase/adminClient';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '../types/events';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export async function authMiddleware(
  socket: AppSocket,
  next: (err?: Error) => void
): Promise<void> {
  // The CLIENT sends its token as part of the connection handshake itself
  // (not as a regular event) — see the matching client-side code, which
  // calls `io(url, { auth: { token: session.access_token } })`. Socket.io
  // exposes whatever was passed there via `socket.handshake.auth`.
  const token = socket.handshake.auth?.token;

  if (!token || typeof token !== 'string') {
    return next(new Error('Unauthorized: no auth token provided'));
  }

  // Ask Supabase itself to verify this token is genuine and not expired,
  // and to tell us which user it belongs to. This costs one network
  // round-trip per connection attempt — perfectly fine at this project's
  // scale. (A faster option exists — verifying the JWT's signature
  // locally using your project's JWT secret, no network call needed — but
  // that's an optimization worth deferring until you have an actual
  // reason to care about shaving off that round-trip.)
  const { data, error } = await adminClient.auth.getUser(token);

  if (error || !data.user) {
    return next(new Error('Unauthorized: invalid or expired token'));
  }

  // Attach the verified userId directly onto this socket's own data
  // object. Every event handler for THIS connection (see roomHandlers.ts,
  // roundHandlers.ts) can now read `socket.data.userId` and trust it
  // completely — it was set here, server-side, after real verification,
  // never taken from anything the client claimed in a message payload.
  socket.data.userId = data.user.id;

  next(); // no error passed = connection is allowed to proceed
}