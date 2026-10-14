import type { MatchSummary } from '@/lib/history';
import { MatchMeta, ScoreLine } from './parts';

/** One finished match in the list. Click to open its rounds. */
export default function MatchRow({ match, onOpen }: { match: MatchSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-3.5 rounded-xl border border-outline-variant bg-surface-container-low px-3 pb-4 pt-3.5 text-left transition-all hover:border-primary-container/50 hover:shadow-[0_0_18px_rgba(0,229,255,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container sm:px-[18px]"
    >
      <div className="flex border-b border-white/[0.07] pb-3">
        <MatchMeta match={match} />
      </div>
      <ScoreLine match={match} />
    </button>
  );
}
