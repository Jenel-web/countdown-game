'use client';

/**
 * context/GameSocketContext.tsx
 *
 * React Context that owns the Socket.io connection for a multiplayer match.
 *
 * WHAT THIS CONTEXT PROVIDES:
 *   socket        — the typed AppSocket instance (never null inside the tree)
 *   isConnected   — true once the socket's 'connect' event has fired
 *   isReconnecting — true between a 'disconnect' and the next 'connect'
 *
 * USAGE:
 *   Wrap the multiplayer match page (app/match/[matchId]/page.tsx) with
 *   <GameSocketProvider token={accessToken}>.
 *   Children will only mount after the socket is fully connected, so every
 *   hook inside can safely call socket.emit() on first render.
 *
 * WHY THE PROVIDER BLOCKS CHILDREN UNTIL CONNECTED:
 *   If children mounted immediately, the first useEffect in useGameSocket
 *   would try to emit 'join_room' before the WebSocket handshake completed.
 *   Socket.io would buffer the event, but this creates a subtle ordering
 *   dependency. Waiting for 'connect' makes the timing explicit and testable.
 *
 * RECONNECT FLOW:
 *   'disconnect' → isReconnecting = true  (banner shown, buttons locked)
 *   'connect'    → isReconnecting = false (banner dismissed, buttons unlocked,
 *                                          join_room re-emitted by the page)
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { getSocket, destroySocket, type AppSocket } from '@/lib/socket/socketClient';

// --------------------------------------------------------------------------
// Context shape
// --------------------------------------------------------------------------

interface GameSocketContextValue {
  /** The live, typed Socket.io instance. Never null inside the Provider tree. */
  socket: AppSocket;
  /** True once the 'connect' event has fired at least once. */
  isConnected: boolean;
  /**
   * True between a 'disconnect' and the next successful 'connect'.
   * All emit calls should be gated on !isReconnecting before firing.
   * Use this from useGameSocket — never check isReconnecting separately
   * to avoid race conditions between multiple state reads.
   */
  isReconnecting: boolean;
}

// Context is typed as `GameSocketContextValue | null` so the error thrown
// by useGameSocketContext is caught at component authoring time, not runtime.
const GameSocketContext = createContext<GameSocketContextValue | null>(null);

// --------------------------------------------------------------------------
// Provider
// --------------------------------------------------------------------------

interface GameSocketProviderProps {
  children: React.ReactNode;
  /**
   * Supabase access_token from `session.access_token`.
   * Passed directly to the socket handshake auth. Must be a non-empty
   * string — if the session is null, redirect to /login before mounting
   * this Provider.
   */
  token: string;
}

export function GameSocketProvider({ children, token }: GameSocketProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // useRef to keep a stable reference to the socket that never changes
  // across renders. We initialise it once in the ref initialiser and
  // never reassign socketRef.current.
  // Lazy initializer: getSocket runs once per provider, not on every render.
  const [socket] = useState<AppSocket>(() => getSocket(token));
  useEffect(() => {
    // Guard: if the socket is already connected (e.g. hot reload in dev),
    // update state to reflect reality without emitting a second connect.
    if (socket.connected) {
      setIsConnected(true);
      setIsReconnecting(false);
    }

    // ── Lifecycle handlers ──────────────────────────────────────────────
    // Each handler is defined as a named const so the exact same function
    // reference can be passed to both socket.on() and socket.off().

    const onConnect = () => {
      setIsConnected(true);
      setIsReconnecting(false);
    };

    const onDisconnect = () => {
      // We do NOT set isConnected to false here — the socket may reconnect
      // within seconds. isReconnecting is the signal the UI should react to.
      // isConnected will be reset if reconnect_failed eventually fires and
      // destroySocket() is called.
      setIsReconnecting(true);
    };

    const onReconnect = () => {
      // Socket.io 'reconnect' fires after a successful reconnect (after one
      // or more failed attempts). The 'connect' event also fires on reconnect,
      // so onConnect() handles the state update — this handler exists as a
      // hook for future telemetry/logging.
    };

    const onReconnectFailed = () => {
      // All reconnection attempts exhausted. The ReconnectBanner will upgrade
      // to the full-screen modal (UI_ERROR_STATES.md §4.3).
      setIsConnected(false);
      setIsReconnecting(false);
      // The socket is now effectively dead — destroy the singleton so that
      // if the user navigates away and back, a fresh connection is created.
      destroySocket();
    };

    // Register all listeners with named references so cleanup is exact.
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect', onReconnect);
    socket.io.on('reconnect_failed', onReconnectFailed);

    // Open the connection. autoConnect: false means the socket is inert
    // until this explicit call. Supabase token is already in the handshake.
    socket.connect();

    return () => {
      // Cleanup: remove every listener with its exact reference.
      // Failing to do this causes listener accumulation across React
      // Strict Mode double-mounts and hot reloads.
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect', onReconnect);
      socket.io.off('reconnect_failed', onReconnectFailed);

      // NOTE: we do NOT call socket.disconnect() here. The socket outlives
      // the Provider — it is owned by the module-level singleton. Disconnect
      // is the caller's responsibility (e.g. on logout or navigating to /lobby).
    };
  }, [socket]);

  // Block children until the socket is connected. This eliminates any
  // ambiguity about whether emit calls during the first child render will
  // actually reach the server.
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-4 border-primary-fixed-dim border-t-transparent animate-spin" />
          <p className="text-on-surface-variant text-sm font-mono tracking-widest uppercase">
            Connecting…
          </p>
        </div>
      </div>
    );
  }

  return (
    <GameSocketContext.Provider value={{ socket, isConnected, isReconnecting }}>
      {children}
    </GameSocketContext.Provider>
  );
}

// --------------------------------------------------------------------------
// Context consumer — internal use only
// --------------------------------------------------------------------------

/**
 * Returns the raw context value. Prefer useGameSocket for all game logic.
 * This hook is exported for the rare case where a component needs direct
 * access to isReconnecting without going through useGameSocket.
 */
export function useGameSocketContext(): GameSocketContextValue {
  const ctx = useContext(GameSocketContext);
  if (!ctx) {
    throw new Error(
      'useGameSocketContext must be used inside a <GameSocketProvider>. ' +
      'Wrap your match page with <GameSocketProvider token={...}>.'
    );
  }
  return ctx;
}

// --------------------------------------------------------------------------
// Convenience hook: session-aware Provider factory
// --------------------------------------------------------------------------

/**
 * Higher-level component that fetches the Supabase session itself and
 * renders <GameSocketProvider> once the token is available.
 *
 * Use this in app/match/[matchId]/layout.tsx (or the page itself) when
 * you want to avoid threading the token down as a prop.
 *
 * @example
 *   export default function MatchLayout({ children }: { children: React.ReactNode }) {
 *     return <AutoGameSocketProvider>{children}</AutoGameSocketProvider>;
 *   }
 */
export function AutoGameSocketProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data, error }) => {
      if (error || !data.session) {
        setAuthError(true);
        return;
      }
      setToken(data.session.access_token);
    });
  }, []);

  if (authError) {
    // The page-level middleware should have already redirected unauthenticated
    // users to /login, but this is a safety net for edge cases.
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-error font-mono text-sm">Session expired. Please log in again.</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border-4 border-primary-fixed-dim border-t-transparent animate-spin" />
      </div>
    );
  }

  return <GameSocketProvider token={token}>{children}</GameSocketProvider>;
}
