/**
 * lib/gameEngine.ts
 * Pure helper functions for Countdown Math Arena game logic.
 * No side effects — safe to import on server or client.
 */

export interface Tile {
  id: string;
  value: number;
  used: boolean;
  selected: boolean;
  isGenerated?: boolean;
}

export interface Step {
  a: number;
  op: string;
  b: number;
  result: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** The four large Countdown numbers. */
export const LARGE_POOL = [25, 50, 75, 100] as const;

/**
 * The small pool: two copies of 1–10 (20 values total).
 * Stored as an array so index-based selection avoids duplicates.
 */
export const SMALL_POOL: number[] = [
  1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
  6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Fisher-Yates shuffle — returns a new shuffled copy. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the 6-tile starting pool.
 *
 * @param largeCount  Number of large tiles to include (0–4).
 *                    Pass -1 (or "random") to choose a random count.
 */
export function generateTilePool(largeCount: number | 'random'): Tile[] {
  const n =
    largeCount === 'random'
      ? Math.floor(Math.random() * 5) // 0–4
      : Math.max(0, Math.min(4, largeCount));

  // Pick n unique large numbers
  const large = shuffle([...LARGE_POOL]).slice(0, n);

  // Pick (6 - n) small numbers without reusing the same index slot
  const smallIndices = shuffle([...Array(SMALL_POOL.length).keys()]).slice(0, 6 - n);
  const small = smallIndices.map((i) => SMALL_POOL[i]);

  // Combine: large first, then small
  return [...large, ...small].map((value, i) => ({
    id: `tile-${i}`,
    value,
    used: false,
    selected: false,
  }));
}

/**
 * Generate a random 3-digit target number (100–999 inclusive).
 */
export function generateTarget(): number {
  return Math.floor(Math.random() * 900) + 100;
}

/**
 * Apply an arithmetic operation.
 * Returns the result or null if the operation is invalid by Countdown rules:
 *   - Division must be exact (integer result, divisor ≠ 0)
 *   - Subtraction result must be positive
 */
export function applyOp(
  a: number,
  op: '+' | '−' | '×' | '÷',
  b: number
): number | null {
  switch (op) {
    case '+':
      return a + b;
    case '−': {
      const r = a - b;
      return r > 0 ? r : null;
    }
    case '×':
      return a * b;
    case '÷':
      return b !== 0 && a % b === 0 ? a / b : null;
  }
}

/**
 * Find the closest active tile value to the target.
 * Returns { value, diff }.
 */
export function closestValue(
  tiles: Tile[],
  target: number
): { value: number; diff: number } {
  const active = tiles.filter((t) => !t.used).map((t) => t.value);
  if (active.length === 0) return { value: 0, diff: Infinity };
  const value = active.reduce((best, curr) =>
    Math.abs(curr - target) < Math.abs(best - target) ? curr : best
  );
  return { value, diff: Math.abs(value - target) };
}
