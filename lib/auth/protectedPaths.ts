/**
 * Pages that need a logged-in player with a username. Used by middleware.ts;
 * kept here so the rule can be unit tested without running Next.js.
 *
 * `/match` is included: a live match page without a session has nothing to
 * show, and the game server refuses its socket anyway.
 */
export const PROTECTED_PATHS = ['/lobby', '/game', '/training', '/history', '/match'] as const;

/**
 * True when `pathname` is a protected page or sits under one. Matches whole
 * path segments, so `/match/abc` is protected but `/matchmaking-faq` is not.
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some((base) => pathname === base || pathname.startsWith(`${base}/`));
}
