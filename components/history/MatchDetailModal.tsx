'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  fetchMatchRounds,
  formatPoints,
  formatSeconds,
  type MatchSummary,
  type RoundView,
  type SideView,
} from '@/lib/history';
import Overlay from './Overlay';
import RoundStepsModal from './RoundStepsModal';
import { MatchMeta, ScoreLine, TileChips } from './parts';

interface MatchDetailModalProps {
  match: MatchSummary;
  userId: string;
  onClose: () => void;
}

function RoundSide({ side, won, align }: { side: SideView; won: boolean; align: 'left' | 'right' }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${align === 'left' ? 'items-end text-right' : 'items-start text-left'}`}>
      <span className="min-h-[18px] text-[10px] font-extrabold uppercase tracking-[0.12em] text-primary-container">
        {won ? 'Winner' : ''}
      </span>
      <span
        className={
          side.timeMs === null
            ? 'text-[15px] font-bold text-[#ff6b78]'
            : 'font-mono text-[15px] font-semibold tabular-nums sm:text-lg'
        }
      >
        {formatSeconds(side.timeMs)}
      </span>
      <span className="font-mono text-xs text-on-surface-variant">{formatPoints(side.pointsRaw)} pts</span>
    </div>
  );
}

function RoundRow({ round, onOpen }: { round: RoundView; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-outline-variant bg-surface-container px-2.5 py-3.5 text-left transition-colors hover:border-primary-container/50 hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container sm:gap-3.5 sm:px-4"
    >
      <RoundSide side={round.me} won={round.winner === 'me'} align="left" />
      <div className="flex min-w-[110px] flex-col items-center gap-1.5 sm:min-w-[150px]">
        <span className="text-xs font-bold uppercase tracking-[0.1em] text-on-surface-variant">Round {round.roundNumber}</span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-outline">Target</span>
          <b className="font-mono text-xl leading-none tabular-nums text-primary-container sm:text-2xl">{round.target}</b>
        </div>
        <div className="hidden sm:block">
          <TileChips tiles={round.tiles} small />
        </div>
        {round.winner === 'draw' && (
          <span className="rounded-full border border-dashed border-outline-variant px-2 py-px text-[10px] font-bold uppercase tracking-[0.1em] text-outline">
            Draw
          </span>
        )}
        <span className="text-[11px] text-outline transition-colors group-hover:text-primary-container">View steps ›</span>
      </div>
      <RoundSide side={round.opponent} won={round.winner === 'opponent'} align="right" />
    </button>
  );
}

/** The match window: header with the score, then one row per round. */
export default function MatchDetailModal({ match, userId, onClose }: MatchDetailModalProps) {
  const [rounds, setRounds] = useState<RoundView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setRounds(null);
    setError(null);
    fetchMatchRounds(createClient(), match.id, userId)
      .then((data) => {
        if (active) setRounds(data);
      })
      .catch((err) => {
        if (active) setError(err?.message || 'Could not load the rounds.');
      });
    return () => {
      active = false;
    };
  }, [match.id, userId]);

  return (
    <>
      <Overlay onClose={onClose} label="Match details" escEnabled={selected === null}>
        <div className="border-b border-outline-variant bg-surface-container px-3.5 pb-4 pt-3 sm:px-5 sm:pt-3.5">
          <div className="mb-3.5 flex items-center gap-2.5">
            <MatchMeta match={match} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-outline-variant transition-colors hover:border-[#ff6b78] hover:text-[#ff6b78]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ScoreLine match={match} />
        </div>

        <div className="flex flex-1 flex-col gap-2.5 overflow-auto p-3 sm:px-5 sm:pb-5 sm:pt-4">
          {error ? (
            <p role="alert" className="rounded-lg border border-error bg-error-container/20 px-4 py-3 font-mono text-xs text-error">
              {error}
            </p>
          ) : rounds === null ? (
            <div className="flex flex-col gap-2.5" aria-label="Loading rounds">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-bright/20" />
              ))}
            </div>
          ) : rounds.length === 0 ? (
            <p className="py-6 text-center text-sm text-on-surface-variant">No rounds were recorded for this match.</p>
          ) : (
            <>
              <p className="text-xs text-outline">Tap a round to see the steps each player took.</p>
              {rounds.map((round, i) => (
                <RoundRow key={round.roundNumber} round={round} onOpen={() => setSelected(i)} />
              ))}
            </>
          )}
        </div>
      </Overlay>

      {selected !== null && rounds?.[selected] && (
        <RoundStepsModal
          round={rounds[selected]}
          totalRounds={match.roundCount}
          myName={match.me.name}
          opponentName={match.opponent.name}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
