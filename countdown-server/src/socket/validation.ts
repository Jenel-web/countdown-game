/**
 * =============================================================================
 * FILE: src/socket/validation.ts
 * RESPONSIBILITY: The "front door" checks for everything a socket client can
 * send. TypeScript types only exist at compile time - at runtime a modified
 * client can send ANY JSON (null, a missing payload, a string where an object
 * should be). Handlers therefore take their payload as `unknown` and run it
 * through the parsers here before touching it, and are wrapped in
 * safeHandler() so a bug or a hostile payload can never take the process down.
 *
 * These checks are SHAPE checks only. Whether a set of steps is legal against
 * the round's tiles is still decided by validateSubmission() in the engine.
 * =============================================================================
 */

/** Match ids are Supabase UUIDs; allow a slightly wider safe charset so tests can use readable ids. */
const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A six-tile round allows at most 5 steps. We accept a larger array here and
 * let the engine reject it, but cap it so a client can't make the server walk
 * a huge array.
 */
const MAX_STEPS_ARRAY_LENGTH = 20;

/**
 * Clock skew allowance: a client whose clock runs slightly ahead of the
 * server's starts its 30s phase a moment before the server's startTimestamp.
 * Submissions earlier than this before startTimestamp are rejected.
 */
export const SUBMIT_EARLY_TOLERANCE_MS = 1_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the matchId if `payload` is `{ matchId: <safe string> }`, otherwise null. */
export function parseMatchPayload(payload: unknown): string | null {
  if (!isPlainObject(payload)) return null;
  const { matchId } = payload;
  if (typeof matchId !== 'string' || !MATCH_ID_PATTERN.test(matchId)) return null;
  return matchId;
}

/**
 * Returns the raw `steps` array of a submit_answer payload, or null if the
 * payload isn't shaped like `{ steps: [...] }`. The step contents are NOT
 * trusted - they go to validateSubmission() next. `resultValue` is ignored on
 * purpose (the server recomputes the result from the steps).
 */
export function parseSubmitPayload(payload: unknown): unknown[] | null {
  if (!isPlainObject(payload)) return null;
  const { steps } = payload;
  if (!Array.isArray(steps) || steps.length > MAX_STEPS_ARRAY_LENGTH) return null;
  return steps;
}

/** Returns the status if it is one of the two allowed values, otherwise null. */
export function parsePlayerStatus(payload: unknown): 'thinking' | 'submitted' | null {
  if (!isPlainObject(payload)) return null;
  const { status } = payload;
  return status === 'thinking' || status === 'submitted' ? status : null;
}

/** Returns the accepted flag of a rematch_response payload (`{ matchId, accepted }`), or null if malformed. */
export function parseRematchResponse(payload: unknown): { matchId: string; accepted: boolean } | null {
  const matchId = parseMatchPayload(payload);
  if (matchId === null) return null;
  const { accepted } = payload as Record<string, unknown>;
  if (typeof accepted !== 'boolean') return null;
  return { matchId, accepted };
}

/** True when `nowMs` is before the round's gameplay start by more than the skew allowance. */
export function isSubmissionTooEarly(
  nowMs: number,
  startTimestamp: number,
  toleranceMs: number = SUBMIT_EARLY_TOLERANCE_MS
): boolean {
  return nowMs < startTimestamp - toleranceMs;
}

/**
 * Wraps a socket event listener so that neither a synchronous throw nor a
 * rejected promise can escape. Socket.io does not catch errors from listeners,
 * and an unhandled rejection in an async listener terminates Node by default -
 * which would kill every live match. Failures are logged, never rethrown.
 *
 * The wrapped function takes its payload as `unknown`; parse it first.
 */
export function safeHandler(
  eventName: string,
  fn: (payload: unknown) => void | Promise<void>
): (payload: unknown) => void {
  return (payload: unknown) => {
    try {
      const result = fn(payload);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((err) => {
          console.error(`[socket] handler "${eventName}" failed:`, err);
        });
      }
    } catch (err) {
      console.error(`[socket] handler "${eventName}" failed:`, err);
    }
  };
}
