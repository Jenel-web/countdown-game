/**
 * =============================================================================
 * FILE: src/types/events.ts
 * RESPONSIBILITY: This is the central "rulebook" for every message that can
 * ever travel between a browser (your Next.js client) and this server over
 * the WebSocket connection.
 *
 * BEGINNER NOTE — why this file exists at all:
 * Socket.io technically lets you send ANY data under ANY event name you
 * want. That's convenient, but dangerous — a typo in an event name, or
 * sending the wrong shape of data, wouldn't be caught until something
 * broke while the app was actually running.
 *
 * By writing these interfaces and handing them to Socket.io's generic
 * types (you'll see this in src/index.ts), TypeScript checks your code
 * at COMPILE time — before you even run it — and will refuse to let you
 * emit an event that doesn't exist here, or send the wrong payload shape.
 * This is the same idea as a shared API contract between a frontend and
 * backend, just applied to a persistent connection instead of one-off
 * HTTP requests.
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// Shared game-data shapes
// ---------------------------------------------------------------------------
// These mirror the Tile / Step types in your Next.js app's lib/gameEngine.ts
// EXACTLY, on purpose. If you ever change one, change the other — any
// mismatch here is precisely the "client and server quietly disagree about
// what a tile looks like" bug we designed against during system planning.

export interface Tile {
  id: string;
  value: number;
  used: boolean;
  selected: boolean;
  /**
   * CLIENT-ONLY FLAG — the server's generateTilePool() never sets this.
   * It is always `undefined` in tiles received from `round_start`.
   * The client sets it to `true` on intermediate computed tiles (pool tiles
   * created during a calculation step) to distinguish them from the
   * original six tiles. Do not read this field in any server-side logic.
   */
  isGenerated?: boolean;
}

/**
 * CRITICAL — `op` uses Unicode math symbols, NOT ASCII equivalents:
 *
 *   '+'  U+002B  (standard plus — same as ASCII)
 *   '−'  U+2212  MINUS SIGN       ← NOT the hyphen/dash '-' (U+002D)
 *   '×'  U+00D7  MULTIPLICATION SIGN ← NOT the letter 'x'
 *   '÷'  U+00F7  DIVISION SIGN    ← NOT the slash '/'
 *
 * TypeScript will NOT catch a wrong literal here because each is a
 * distinct string type that satisfies the union at compile time, but
 * validateSubmission()'s applyOp() switch will fall through and return
 * null, scoring the submission as invalid with no error thrown.
 *
 * Always reference the operator characters by copy-pasting from this
 * comment, from the lib/gameEngine.ts OPERATORS constant, or from the
 * UI button labels — never by typing them from your keyboard.
 */
export interface Step {
  a: number;
  op: '+' | '−' | '×' | '÷';
  b: number;
  result: number;
}

/** A single player's outcome for one round, as computed by scoreRound(). */
export interface PlayerRoundResult {
  /** Decimal, e.g. 0.7 — for DISPLAY only, never compare this with === */
  points: number;
  /** Integer (points * 100) — the number to actually store/compare, to
   *  avoid floating-point rounding bugs. See game/gameEngine.ts for why. */
  pointsRaw: number;
  outcome: 'win' | 'loss' | 'draw';
  /** Final calculated value submitted, or null if timed out. */
  result?: number | null;
  /** Time in ms taken from round start to submission, or null if timed out. */
  timeMs?: number | null;
  /** Absolute difference to target, or null if timed out. */
  diff?: number | null;
  /** Detailed scoring explanation based on gameEngine rules. */
  reason?: string;
  steps?: { a: number; op: string; b: number; result: number }[];
}

// ---------------------------------------------------------------------------
// SERVER -> CLIENT events
// ---------------------------------------------------------------------------
// Everything in this interface is something the SERVER calls
// (socket.emit('eventName', payload)) and the BROWSER listens for
// (socket.on('eventName', payload => {...})). Think of this as
// "everything the server is allowed to say."
export interface ServerToClientEvents {
  /** Sent to the first player in a room, while they wait for an opponent. */
  waiting_for_opponent: () => void;

  /** Sent to BOTH players the instant the second player joins the room. */
  opponent_joined: (payload: { player1Id: string; player2Id: string }) => void;

  /**
   * Sent to BOTH players at the start of every round, including round 1.
   *
   * `startTimestamp` is the SERVER's own clock (Date.now()) at the exact
   * moment the round began. Clients should calculate "time remaining" by
   * comparing THEIR clock against this timestamp — NOT by just starting
   * their own independent 30-second countdown the moment they receive this
   * event. That distinction is what keeps both players' timers in sync
   * despite small, unavoidable differences in network latency.
   */
  round_start: (payload: {
    roundNumber: number;
    tiles: Tile[];
    target: number;
    startTimestamp: number;
    durationMs: number;
  }) => void;

  /**
   * Re-broadcast to the OTHER player whenever someone's status changes
   * (e.g. they've submitted an answer). Purely cosmetic — drives a
   * "Submitted..." badge in the UI. This NEVER reveals the other player's
   * actual answer, tiles used, or result — only a status label.
   */
  player_status: (payload: { userId: string; status: 'thinking' | 'submitted' }) => void;

  /** Sent to BOTH players once a round has been fully scored. */
  round_result: (payload: {
    /**
     * This equals the SAME value as the `roundNumber` in the preceding
     * `round_start` event for this round — it is already incremented by
     * `resetRound()` at round-start time, not at result time. Display it
     * directly as "Round N result", never add 1.
     */
    roundNumber: number;
    solvable: boolean;
    player1: PlayerRoundResult;
    player2: PlayerRoundResult;
    player1TotalRaw: number;
    player2TotalRaw: number;
  }) => void;

  /** Sent to BOTH players the moment checkMatchOver() finds a winner. */
  match_over: (payload: {
    winnerId: string;
    player1TotalRaw: number;
    player2TotalRaw: number;
  }) => void;

  /** Sent to whichever player is LEFT after their opponent disconnects. */
  opponent_left: () => void;

  /**
   * Sent to the opponent of the player who requested a rematch.
   * The recipient should show a modal asking if they want to play again.
   */
  rematch_offer: () => void;

  /**
   * Sent to BOTH players when both accept a rematch.
   * newMatchId is the freshly created match row — both clients should
   * navigate to /match/<newMatchId>.
   */
  rematch_accepted: (payload: { newMatchId: string }) => void;

  /**
   * Sent to the player who requested the rematch when their opponent declines.
   */
  rematch_declined: () => void;

  /** Generic error channel: bad/missing token, room full, match not found, etc. */
  error: (payload: { code: string; message: string }) => void;
}

// ---------------------------------------------------------------------------
// CLIENT -> SERVER events
// ---------------------------------------------------------------------------
// Everything the BROWSER is allowed to ask the SERVER to do.
export interface ClientToServerEvents {
  /** Fired once, right after connecting, to join a specific match's room. */
  join_room: (payload: { matchId: string }) => void;

  /**
   * Fired when the host cancels the room while waiting for an opponent.
   * Server deletes the pending match and cleans up RoomManager.
   */
  cancel_room: (payload: { matchId: string }) => void;

  /** Fired whenever the local player's status changes (e.g. they start typing/clicking). */
  player_status: (payload: { status: 'thinking' | 'submitted' }) => void;

  /**
   * Fired when the local player wants to invite their opponent to a rematch.
   * Only valid after match_over has been received.
   */
  request_rematch: (payload: { matchId: string }) => void;

  /**
   * Fired by the opponent in response to a rematch_offer.
   * accepted=true means both proceed to the new match;
   * accepted=false cancels the rematch and both return to lobby.
   */
  rematch_response: (payload: { matchId: string; accepted: boolean }) => void;

  /**
   * Fired when the player hits Submit, OR when their local 30s timer hits
   * zero and the client auto-submits whatever they currently have.
   *
   * IMPORTANT: the server must NEVER trust `resultValue` by itself — it
   * must independently re-run `steps` against the round's original tiles
   * to confirm the claimed result is actually legal. See
   * game/gameEngine.ts's validateSubmission() and
   * socket/handlers/roundHandlers.ts for where that happens.
   *
   * CLIENT RULE: always compute resultValue as
   *   `steps[steps.length - 1]?.result ?? 0`
   * The server ignores this field entirely, but a mismatch between what
   * the client displays and what it sends is a latent debugging hazard.
   * Sending the real last-step result keeps the two in agreement.
   */
  submit_answer: (payload: { steps: Step[]; resultValue: number }) => void;
}

// ---------------------------------------------------------------------------
// InterServerEvents
// ---------------------------------------------------------------------------
// Socket.io's TypeScript API requires this fourth generic even when you're
// only running a single server instance (no multi-server clustering via
// Redis, etc.). We're not using this feature — it exists purely so the
// type signature in src/index.ts is complete and matches Socket.io's API.
export interface InterServerEvents {
  // Intentionally empty for now — a placeholder for future server-to-server
  // messages if you ever scale to multiple server instances.
  ping: () => void;
}

// ---------------------------------------------------------------------------
// SocketData
// ---------------------------------------------------------------------------
// Custom data WE attach to each individual socket connection after it has
// been authenticated. Once socket/authMiddleware.ts sets socket.data.userId,
// every event handler for that specific connection can trust it without
// re-checking — this is what "server-authoritative identity" actually
// looks like in code, instead of just a design principle on paper.
export interface SocketData {
  userId: string;
  /** Set once the player successfully joins a room via join_room. */
  matchId?: string;
}