import { adminClient } from './adminClient';

/**
 * Stamps `matches.ended_at` once a match is over (normal finish or forfeit).
 * The History tab sorts and displays by this value. A failure is logged but
 * never thrown: the match result itself has already been saved by
 * finish_match and must not be affected.
 */
export async function markMatchEnded(matchId: string): Promise<void> {
  const { error } = await adminClient
    .from('matches')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', matchId);

  if (error) {
    console.error(`[match ${matchId}] failed to set ended_at:`, error);
  }
}
