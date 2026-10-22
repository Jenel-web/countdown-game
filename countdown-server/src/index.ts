/**
 * =============================================================================
 * FILE: src/index.ts
 * RESPONSIBILITY: The entrypoint. This file starts the actual server —
 * everything else in this project is just code that this file wires
 * together and turns on.
 *
 * BEGINNER NOTE — why both Express AND a raw Node http.Server exist here:
 * Socket.io doesn't run "inside" Express the way an Express route does —
 * it needs to attach itself to the lower-level Node HTTP server that
 * Express itself is built on top of, so it can intercept the special
 * WebSocket upgrade request a browser sends. Express is included mainly
 * so you have a normal place to add plain HTTP routes later if you ever
 * need one (e.g. a simple `/health` endpoint for Render to ping) — the
 * real multiplayer logic all happens through Socket.io, not Express routes.
 * =============================================================================
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

import { authMiddleware } from './socket/authMiddleware';
import {
  MAX_PAYLOAD_BYTES,
  createIpRateLimiter,
  createPacketLimiter,
  createUserConnectionCap,
} from './socket/rateLimit';
import { registerRoomHandlers } from './socket/handlers/roomHandlers';
import { registerRoundHandlers } from './socket/handlers/roundHandlers';
import { registerRematchHandlers } from './socket/handlers/rematchHandlers';
import { RoomManager } from './rooms/RoomManager';
import { adminClient } from './supabase/adminClient';
import { startStaleMatchSweeper } from './maintenance/staleMatchSweeper';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from './types/events';

// Last line of defence. Every socket handler is already wrapped in
// safeHandler(), so these should never fire; if one does, log it loudly rather
// than let a single bad event kill every live match.
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err);
});

const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';

const app = express();
const httpServer = createServer(app);

// A tiny plain HTTP route, useful for a quick "is the server even up"
// check in a browser, and for Render's/Railway's automated health checks
// once this is deployed.
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// The four generic types here plug directly into the interfaces we wrote
// in types/events.ts, in this exact order: events the server SENDS, events
// the server RECEIVES, inter-server events, and per-socket custom data.
// Once this is set up, TypeScript will now type-check every single
// `socket.emit(...)` and `socket.on(...)` call across the whole project
// against those interfaces.
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  // Real payloads are tiny; anything bigger is junk and closes the connection.
  maxHttpBufferSize: MAX_PAYLOAD_BYTES,
  cors: {
    // NOTE: Socket.io's CORS configuration is separate from Express's own
    // CORS setup (we're not even using the `cors` package's middleware
    // here, since Socket.io handles its own handshake requests
    // differently from normal Express routes). This is the setting that
    // actually matters for allowing your deployed Vercel frontend to
    // connect to this server.
    origin: ALLOWED_ORIGIN,
    credentials: true,
  },
});

// This is the Socket.io equivalent of your Next.js middleware.ts — it
// runs for every connection attempt, before any of our own event
// listeners are attached, and can reject the connection outright.
// Order matters: the IP limiter runs BEFORE auth so a flood of connection
// attempts is turned away without ever costing a Supabase auth call.
// Set TRUST_PROXY=true only when deployed behind exactly one reverse proxy
// (Render/Railway/Fly), otherwise every player shares the proxy's address.
const ipLimiter = createIpRateLimiter({ trustProxy: process.env.TRUST_PROXY === 'true' });
io.use(ipLimiter.middleware);
io.use(authMiddleware);
io.use(createUserConnectionCap().middleware);

const roomManager = new RoomManager();

// Deletes challenges nobody joined within 30 minutes (every 5 minutes, and once
// at start-up). Rooms live on this server are passed along and never deleted.
const staleMatchSweeper = startStaleMatchSweeper({
  rpc: (fn, args) => adminClient.rpc(fn, args),
  liveMatchIds: () => roomManager.listMatchIds(),
});
void staleMatchSweeper.sweep();

io.on('connection', (socket) => {
  console.log(`[connect] socket ${socket.id} authenticated as user ${socket.data.userId}`);

  // Per-socket flood protection; runs before any of the handlers below.
  socket.use(createPacketLimiter(socket));

  registerRoomHandlers(io, socket, roomManager);
  registerRoundHandlers(io, socket, roomManager);
  registerRematchHandlers(io, socket, roomManager);

  // Note: the actual 'disconnect' listener lives inside
  // registerRoomHandlers (roomHandlers.ts), since disconnect handling is
  // fundamentally about room/match cleanup, not round-specific logic.
});

httpServer.listen(PORT, () => {
  console.log(`countdown-server listening on port ${PORT}`);
  console.log(`Accepting connections from origin: ${ALLOWED_ORIGIN}`);
});