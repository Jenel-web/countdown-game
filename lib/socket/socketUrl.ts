/**
 * Where the browser connects for multiplayer.
 *
 * In development a missing NEXT_PUBLIC_SOCKET_URL falls back to the local game
 * server. In a production build it is an ERROR: the old silent fallback made a
 * deployed site try the visitor's own http://localhost:4000, so multiplayer
 * simply never connected and nothing said why.
 */
export const DEV_SOCKET_URL = 'http://localhost:4000';

export function resolveSocketUrl(value: string | undefined, nodeEnv: string | undefined): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    if (nodeEnv === 'production') {
      throw new Error(
        '[socketClient] NEXT_PUBLIC_SOCKET_URL is not set. Set it to the game server address ' +
          '(for example https://your-game-server.onrender.com) and rebuild: NEXT_PUBLIC_ values are ' +
          'fixed when the site is built.'
      );
    }
    return DEV_SOCKET_URL;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`[socketClient] NEXT_PUBLIC_SOCKET_URL is not a valid URL: "${trimmed.slice(0, 60)}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`[socketClient] NEXT_PUBLIC_SOCKET_URL must start with http:// or https://, got "${url.protocol}"`);
  }
  // Socket.io wants the origin; a trailing path would be read as a namespace.
  return url.origin;
}
