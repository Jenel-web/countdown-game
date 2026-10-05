/**
 * lib/socket/types.ts
 *
 * CLIENT-SIDE MIRROR of countdown-server/src/types/events.ts
 *
 * SYNC RULE: whenever countdown-server/src/types/events.ts changes,
 * this file must be updated to match. The two must be identical in
 * every interface shape, operator literal, and optional field.
 *
 * WHY A COPY instead of importing from the server source directly:
 * The Next.js client and the countdown-server are separate compilation
 * units with separate tsconfig.json files. Importing across that boundary
 * would couple the client's build to the server's full node_modules tree
 * (including express, socket.io server types, etc.) and break Vercel's
 * build. A maintained copy is the safest approach at this repo's scale.
 *
 * ─────────────────────────────────────────────────────────────────────
 * EXTRA CONTEXT FOR ITEMS 6 & 7 (gap analysis):
 *
 * Item 6 — matchId is NOT in round_start:
 *   The `round_start` payload has no `matchId` field. The multiplayer
 *   page at `app/match/[matchId]/page.tsx` must read matchId from
 *   Next.js route params (`useParams().matchId`) on mount and keep it
 *   in a ref for the lifetime of the session. It cannot be recovered
 *   from any server event.
 *
 * Item 7 — mySlot is NOT sent by the server:
 *   No server event ever says "you are player1" or "you are player2".
 *   The client derives its slot by comparing the authenticated Supabase
 *   userId against the `player1Id` field in the `opponent_joined` event:
 *
 *     const mySlot = userId === payload.player1Id ? 'player1' : 'player2';
 *
 *   Store this in a `useRef<'player1' | 'player2' | null>` — NOT in
 *   useState — so it is captured synchronously in the event handler
 *   before any re-render, and is still available on the first round_start.
 * ─────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Shared game-data shapes
// ---------------------------------------------------------------------------

export interface Tile {
  id: string;
  value: number;
  used: boolean;
  selected: boolean;
  /**
   * CLIENT-ONLY FLAG — never present in payloads received from the server.
   *
   * Tiles arriving in a `round_start` event always have this field as
   * `undefined`. The client sets it to `true` on intermediate computed
   * tiles (e.g. the result of 25 + 50 = 75) to distinguish them from
   * the original six tiles in the pool display. Never reference this
   * field inside a socket event handler or submission logic.
   */
  isGenerated?: boolean;
}

/**
 * CRITICAL — `op` uses Unicode math symbols, NOT ASCII equivalents:
 *
 *   '+'  U+002B  (standard plus — same as ASCII)
 *   '−'  U+2212  MINUS SIGN        ← NOT the hyphen '-' (U+002D)
 *   '×'  U+00D7  MULTIPLICATION SIGN ← NOT the letter 'x'
 *   '÷'  U+00F7  DIVISION SIGN     ← NOT the slash '/'
 *
 * TypeScript will NOT catch a wrong literal because each is a distinct
 * string type that satisfies the union at compile time. A wrong literal
 * silently makes validateSubmission() return { valid: false } and scores
 * the submission as a timeout with no error thrown anywhere.
 *
 * Always use the OPERATORS constant from lib/gameEngine.ts, or copy-paste
 * the characters from that file — never type them from the keyboard.
 */
export interface Step {
  a: number;
  op: '+' | '\u2212' | '\u00D7' | '\u00F7';
  b: number;
  result: number;
}

/** A single player's outcome for one round, as computed by scoreRound(). */
export interface PlayerRoundResult {
  /**
   * Decimal, e.g. 0.7 — for DISPLAY only.
   * Use `.toFixed(2)` when rendering to the user.
   * Never use this for comparisons — use pointsRaw.
   */
  points: number;
  /**
   * Integer (points × 100) — the value stored in the database.
   * 100 = 1 point, 70 = 0.7 points, 35 = 0.35 points.
   */
  pointsRaw: number;
  outcome: 'win' | 'loss' | 'draw';
}

// ---------------------------------------------------------------------------
// SERVER → CLIENT events
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  /** Sent to the first player in a room, while they wait for an opponent. */
  waiting_for_opponent: () => void;

  /**
   * Sent to BOTH players the instant the second player joins the room.
   *
   * This is the ONLY event that reveals both player IDs to the clients.
   * Use it to derive `mySlot`:
   *
   *   const mySlot = userId === payload.player1Id ? 'player1' : 'player2';
   *
   * Store in a useRef<'player1'|'player2'|null>, not useState, so it is
   * set synchronously before the first round_start event fires.
   */
  opponent_joined: (payload: { player1Id: string; player2Id: string }) => void;

  /**
   * Sent to BOTH players at the start of every round, including round 1.
   *
   * TIMER SYNC: derive remaining seconds from the server's clock, not a
   * local countdown. The correct calculation is:
   *
   *   const remaining = Math.max(
   *     0,
   *     Math.floor((startTimestamp + durationMs - Date.now()) / 1000)
   *   );
   *
   * This keeps both players' timers in sync despite network latency.
   *
   * NOTE: `matchId` is NOT included in this payload. Persist it from
   * the route params (`useParams().matchId`) at mount time.
   */
  round_start: (payload: {
    /**
     * Round counter, already incremented by the server's resetRound().
     * Display directly as "Round N" — never add 1.
     */
    roundNumber: number;
    tiles: Tile[];
    target: number;
    /** Server's Date.now() at the exact moment the round began. */
    startTimestamp: number;
    /** Always 30_000 (30 seconds) in the current server implementation. */
    durationMs: number;
  }) => void;

  /**
   * Broadcast to the OTHER player when someone's status changes.
   * Cosmetic only — drives a "Submitted…" badge in the opponent UI.
   * NEVER reveals the other player's answer, tiles, or result.
   */
  player_status: (payload: {
    userId: string;
    status: 'thinking' | 'submitted';
  }) => void;

  /** Sent to BOTH players once a round has been fully scored. */
  round_result: (payload: {
    /**
     * Equals the same value as `roundNumber` in the preceding `round_start`.
     * Already incremented at round-start time. Display as "Round N result",
     * never add 1.
     */
    roundNumber: number;
    /** Whether the puzzle had an exact solution. Safe to show after the round. */
    solvable: boolean;
    player1: PlayerRoundResult;
    player2: PlayerRoundResult;
    /** Cumulative raw score for player1 across all rounds so far. */
    player1TotalRaw: number;
    /** Cumulative raw score for player2 across all rounds so far. */
    player2TotalRaw: number;
  }) => void;

  /**
   * Sent to BOTH players the moment checkMatchOver() finds a winner.
   *
   * NOTE: this event is NOT emitted when an opponent disconnects.
   * The disconnect path emits `opponent_left` only (no match_over).
   * Do not build UI that waits for match_over after opponent_left.
   */
  match_over: (payload: {
    winnerId: string;
    player1TotalRaw: number;
    player2TotalRaw: number;
  }) => void;

  /**
   * Sent to the player who is LEFT in the room after their opponent's
   * socket disconnects. No payload.
   *
   * This event is SELF-SUFFICIENT for ending the game on the client.
   * The server has already called finish_match() internally — the client
   * does not need to make any Supabase call. Navigate to the lobby after
   * showing the forfeit win modal.
   *
   * match_over is NOT emitted after this event. Do not register both
   * handlers for the same resolution path.
   */
  opponent_left: () => void;

  /** Generic server error: bad token, room full, match not found, etc. */
  error: (payload: { code: string; message: string }) => void;
}

// ---------------------------------------------------------------------------
// CLIENT → SERVER events
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  /**
   * Fired once on mount to join a specific match's socket room.
   * Must also be re-emitted after a reconnect to re-register the
   * new socket ID with the server's RoomManager.
   */
  join_room: (payload: { matchId: string }) => void;

  /**
   * Fired when the local player's UI status changes.
   * The server re-broadcasts this to the opponent as a cosmetic badge.
   * Do NOT emit 'submitted' manually — the server emits it automatically
   * to the opponent inside submit_answer handling (roundHandlers.ts:271).
   */
  player_status: (payload: { status: 'thinking' | 'submitted' }) => void;

  /**
   * Fired when the player hits Submit, OR when the local timer hits zero
   * and the client auto-submits (one emission only — guard with a useRef).
   *
   * SERVER BEHAVIOUR: `resultValue` is ignored by the server. It re-runs
   * the steps itself against the original tiles. The client must still
   * provide a real value:
   *
   *   resultValue: steps[steps.length - 1]?.result ?? 0
   *
   * Sending a crafted value has no effect on scoring but creates a
   * hard-to-debug display/logic mismatch if the two ever differ.
   */
  submit_answer: (payload: { steps: Step[]; resultValue: number }) => void;
}

// ---------------------------------------------------------------------------
// Convenience type aliases (client-specific)
// ---------------------------------------------------------------------------

/** The slot identifier the local player occupies in a match. */
export type PlayerSlot = 'player1' | 'player2';

/**
 * Error codes emitted by the server's `error` event.
 * Exhaustive list from roomHandlers.ts and roundHandlers.ts.
 */
export type ServerErrorCode =
  | 'not_found'       // matchId does not exist in the database
  | 'match_finished'  // match.status is already 'finished'
  | 'room_full'       // player2_id is set to a different user
  | 'not_in_room'     // submit_answer arrived before join_room completed
  | 'no_active_round' // submit_answer arrived after round timer fired
  | 'not_a_player';   // userId not found in either player slot
