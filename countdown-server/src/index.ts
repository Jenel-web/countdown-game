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
import { registerRoomHandlers } from './socket/handlers/roomHandlers';
import { registerRoundHandlers } from './socket/handlers/roundHandlers';
import { RoomManager } from './rooms/RoomManager';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from './types/events';

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
io.use(authMiddleware);

const roomManager = new RoomManager();

io.on('connection', (socket) => {
  console.log(`[connect] socket ${socket.id} authenticated as user ${socket.data.userId}`);

  registerRoomHandlers(io, socket, roomManager);
  registerRoundHandlers(io, socket, roomManager);

  // Note: the actual 'disconnect' listener lives inside
  // registerRoomHandlers (roomHandlers.ts), since disconnect handling is
  // fundamentally about room/match cleanup, not round-specific logic.
});

httpServer.listen(PORT, () => {
  console.log(`countdown-server listening on port ${PORT}`);
  console.log(`Accepting connections from origin: ${ALLOWED_ORIGIN}`);
});