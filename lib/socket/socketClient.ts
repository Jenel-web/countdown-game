/**
 * lib/socket/socketClient.ts
 *
 * Module-level singleton factory for the Socket.io client connection.
 *
 * ARCHITECTURE RULES (enforced here, not in components):
 *
 * 1. ONE socket per browser session — the module-level `_socket` variable
 *    is the single instance. Calling getSocket() a second time returns the
 *    exact same object without reconnecting.
 *
 * 2. The socket is NEVER created inside a React component or hook. Creating
 *    it at module scope (via getSocket()) means it survives re-renders,
 *    React Strict Mode double-invocations, and hot-module replacement.
 *
 * 3. Authentication is passed in the Socket.io handshake `auth` object so
 *    the server's authMiddleware can read it from `socket.handshake.auth.token`
 *    without the client having to emit a separate auth event.
 *
 * 4. destroySocket() is provided for logout / test teardown only. In normal
 *    gameplay, the socket lives for the entire browser session.
 */

import { io, Socket } from 'socket.io-client';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from '@/lib/socket/types';

// The typed socket used throughout the client codebase.
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// --------------------------------------------------------------------------
// Module-level singleton state
// --------------------------------------------------------------------------

let _socket: AppSocket | null = null;

/**
 * Returns the live socket, creating it on the first call.
 *
 * @param token  Supabase `session.access_token`. Required on first call;
 *               ignored on subsequent calls (the socket already exists).
 *
 * @example
 *   const session = await supabase.auth.getSession();
 *   const socket  = getSocket(session.data.session?.access_token ?? '');
 */
export function getSocket(token?: string): AppSocket {
  if (_socket) return _socket;

  if (!token) {
    throw new Error(
      '[socketClient] getSocket() called for the first time without a token. ' +
        'Fetch the Supabase session before initialising the socket.'
    );
  }

  const serverUrl =
    process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

  _socket = io(serverUrl, {
    // Pass the Supabase JWT in the handshake so authMiddleware can verify
    // it synchronously before any game event fires.
    auth: { token },

    // Socket.io will automatically try to upgrade from HTTP long-polling to
    // a true WebSocket after the initial handshake. Starting with polling
    // avoids issues with proxies that intercept the initial WS upgrade.
    transports: ['polling', 'websocket'],

    // Limit reconnect attempts to 5 so reconnect_failed fires predictably
    // (see UI_ERROR_STATES.md §4.3). Infinite retries would prevent the
    // "Connection Failed" modal from ever appearing.
    reconnectionAttempts: 5,

    // Grow the reconnect delay up to 10 s to avoid hammering a restarting
    // server. randomizationFactor adds jitter so two clients don't retry
    // simultaneously.
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
    randomizationFactor: 0.5,

    // Do NOT auto-connect — the GameSocketContext Provider controls when
    // connect() is called, ensuring the auth token is always ready first.
    autoConnect: false,
  });

  return _socket;
}

/**
 * Disconnects and destroys the singleton.
 *
 * Call this on logout or in test afterEach() blocks.
 * After this, the next call to getSocket() will create a fresh connection.
 */
export function destroySocket(): void {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

/**
 * Returns true if a socket instance currently exists, regardless of its
 * connected state. Useful for guards that need to know whether getSocket()
 * is safe to call without a token.
 */
export function hasSocket(): boolean {
  return _socket !== null;
}
