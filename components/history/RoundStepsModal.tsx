'use client';

import { X } from 'lucide-react';
import { formatPoints, formatSeconds, formatStep, type RoundView, type SideView } from '@/lib/history';
import Overlay from './Overlay';
import { Avatar, TileChips } from './parts';

interface RoundStepsModalProps {
  round: RoundView;
  totalRounds: number;
  myName: string;
  opponentName: string;
  onClose: () => void;
}

const LABEL = 'text-[10px] font-semibold uppercase tracking-[0.12em] text-outline';

function StepsList({ side }: { side: SideView }) {
  if (side.steps === null) {
    return <p className="rounded-md border border-dashed border-outline-variant px-2.5 py-2 text-xs italic text-outline">Steps not recorded</p>;
  }
  if (side.steps.length === 0) {
    return <p className="rounded-md border border-dashed border-outline-variant px-2.5 py-2 text-xs italic text-outline">No answer submitted</p>;
  }
  return (
    <ol className="flex flex-col gap-[5px]">
      {side.steps.map((step, i) => (
        <li key={i} className="flex items-center gap-2.5 rounded-md bg-background px-2.5 py-[7px]">
          <i className="w-3 font-mono text-[10px] not-italic text-outline">{i + 1}</i>
          <code className="whitespace-nowrap font-mono text-xs sm:text-sm">{formatStep(step)}</code>
        </li>
      ))}
    </ol>
  );
}

function Pane({ side, label, name, mine, won }: { side: SideView; label: string; name: string; mine: boolean; won: boolean }) {
  return (
    <div className="min-w-0 p-3 sm:p-4">
      <div className="mb-3.5 flex min-h-[34px] items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={name} mine={mine} size="sm" />
          <div className="flex min-w-0 flex-col">
            <span className={LABEL}>{label}</span>
            <b className="truncate text-sm">{name}</b>
          </div>
        </div>
        {won && (
          <span className="flex-none rounded-full bg-primary-container px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-on-primary shadow-[0_0_12px_rgba(0,229,255,0.4)]">
            Winner
          </span>
        )}
      </div>

      <div className="mb-3.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1">
          <span className={LABEL}>Time</span>
          <div className={side.timeMs === null ? 'pt-0.5 text-sm font-bold text-[#ff6b78]' : 'font-mono text-[17px] font-semibold tabular-nums'}>
            {formatSeconds(side.timeMs)}
          </div>
        </div>
        <div>
          <span className={LABEL}>Points</span>
          <div className="font-mono text-[17px] font-semibold tabular-nums">{formatPoints(side.pointsRaw)}</div>
        </div>
        <div>
          <span className={LABEL}>Result</span>
          <div className={`font-mono text-[17px] font-semibold tabular-nums ${side.result === null ? 'text-outline' : ''}`}>
            {side.result ?? '—'}
          </div>
        </div>
      </div>

      <div className={`mb-1.5 ${LABEL}`}>Steps</div>
      <StepsList side={side} />
    </div>
  );
}

/** The smaller window: each player's time, points, result and steps for one round. */
export default function RoundStepsModal({ round, totalRounds, myName, opponentName, onClose }: RoundStepsModalProps) {
  return (
    <Overlay onClose={onClose} size="sm" label={`Round ${round.roundNumber} steps`}>
      <div className="border-b border-outline-variant bg-surface-container px-3.5 pb-4 pt-3 sm:px-5 sm:pt-3.5">
        <div className="mb-3.5 flex items-center justify-between">
          <span className={LABEL}>
            Round {round.roundNumber} of {totalRounds || round.roundNumber}
            {round.winner === 'draw' ? ' · Draw' : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant transition-colors hover:border-[#ff6b78] hover:text-[#ff6b78]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col items-center gap-2.5">
          <div className="flex items-baseline gap-2">
            <span className={LABEL}>Target</span>
            <b className="font-mono text-[32px] leading-none tabular-nums text-primary-container [text-shadow:0_0_14px_rgba(0,229,255,0.35)]">
              {round.target}
            </b>
          </div>
          <TileChips tiles={round.tiles} />
        </div>
      </div>

      <div className="grid flex-1 grid-cols-2 divide-x divide-outline-variant overflow-auto">
        <Pane side={round.me} label="You" name={myName} mine won={round.winner === 'me'} />
        <Pane side={round.opponent} label="Opponent" name={opponentName} mine={false} won={round.winner === 'opponent'} />
      </div>
    </Overlay>
  );
}
