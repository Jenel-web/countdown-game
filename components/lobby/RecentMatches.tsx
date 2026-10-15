'use client';

import { useState } from 'react';
import Link from 'next/link';
import MatchDetailModal from '@/components/history/MatchDetailModal';
import { formatScore, type MatchSummary } from '@/lib/history';
import { formatRelativeTime } from '@/lib/lobby';
import { MMR_LOSS, MMR_WIN } from '@/lib/ranks';

interface RecentMatchesProps {
  matches: MatchSummary[];
  loading: boolean;
  error: string | null;
  userId: string;
  onCreateChallenge: () => void;
  isCreatingChallenge: boolean;
}

/** The player's last few finished matches, or a prompt to play the first one. */
export default function RecentMatches({
  matches,
  loading,
  error,
  userId,
  onCreateChallenge,
  isCreatingChallenge,
}: RecentMatchesProps) {
  const [selected, setSelected] = useState<MatchSummary | null>(null);

  return (
    <div className="glass-panel rounded-xl p-stack-lg flex flex-col gap-stack-md">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-label-caps text-label-caps text-on-surface-variant">RECENT MATCHES</h2>
        {matches.length > 0 && (
          <Link
            href="/history"
            className="font-label-caps text-label-caps text-primary-container hover:text-primary-fixed transition-colors"
          >
            View all
          </Link>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2 animate-pulse" aria-label="Loading recent matches">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-surface-bright/20" />
          ))}
        </div>
      ) : error ? (
        <p className="text-error text-xs font-mono">{error}</p>
      ) : matches.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-on-surface-variant">
            <span className="material-symbols-outlined">swords</span>
          </div>
          <h3 className="font-semibold text-on-surface">No matches yet</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant max-w-xs">
            Create a challenge link and send it to a friend. Your first ranked result shows up here.
          </p>
          <button
            type="button"
            onClick={onCreateChallenge}
            disabled={isCreatingChallenge}
            className="mt-2 bg-[#0A192F] border border-[#2962FF] hover:border-[#00E5FF] text-[#00E5FF] hover:bg-[#2962FF]/15 px-4 py-2.5 rounded-lg font-label-caps text-label-caps transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">add_link</span>
            <span>{isCreatingChallenge ? 'Creating Match...' : 'Create Challenge Link'}</span>
          </button>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-outline-variant/15">
          {matches.map((match) => (
            <li key={match.id}>
              <button
                type="button"
                onClick={() => setSelected(match)}
                className="w-full grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 py-3 text-left transition-colors hover:bg-surface-container/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container rounded-lg px-1"
              >
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${
                    match.didWin
                      ? 'bg-primary-container/15 text-primary-container'
                      : 'bg-surface-container text-on-surface-variant'
                  }`}
                >
                  {match.didWin ? 'Win' : 'Loss'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-on-surface">
                    vs {match.opponent.name}
                  </span>
                  <span className="block text-xs text-on-surface-variant">{formatRelativeTime(match.endedAt)}</span>
                </span>
                <span className="font-mono text-sm text-on-surface tabular-nums">
                  {formatScore(match.me.totalRaw)} – {formatScore(match.opponent.totalRaw)}
                </span>
                <span
                  className={`w-10 text-right font-mono text-sm font-bold tabular-nums ${
                    match.didWin ? 'text-primary-container' : 'text-[#ff6b78]'
                  }`}
                >
                  {match.didWin ? `+${MMR_WIN}` : `-${MMR_LOSS}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && <MatchDetailModal match={selected} userId={userId} onClose={() => setSelected(null)} />}
    </div>
  );
}
