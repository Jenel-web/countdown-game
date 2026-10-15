import { getRankProgress, MMR_LOSS, MMR_WIN } from '@/lib/ranks';

/** "Next rank" card: how far the player is from the next rank. */
export default function RankProgress({ mmr }: { mmr: number }) {
  const progress = getRankProgress(mmr);
  const { nextRank } = progress;

  return (
    <div className="glass-panel rounded-xl p-stack-lg flex flex-col gap-stack-md">
      <div className="flex items-center justify-between gap-2">
        <span className="font-label-caps text-label-caps text-on-surface-variant">
          {nextRank ? 'Next rank' : 'Current rank'}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-container px-3 py-1 font-label-caps text-label-caps text-on-surface">
          <span className="material-symbols-outlined text-sm text-primary-container">workspace_premium</span>
          {(nextRank ?? progress.rank).name}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        {nextRank ? (
          <>
            <span className="font-mono-metric text-mono-metric text-primary-container font-bold">
              {progress.mmrToGo} MMR
            </span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">
              about {progress.winsToGo} {progress.winsToGo === 1 ? 'win' : 'wins'} to go
            </span>
          </>
        ) : (
          <span className="font-body-sm text-body-sm text-on-surface-variant">Top rank reached</span>
        )}
      </div>

      <div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress.percent)}
          aria-label="Progress to next rank"
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-bright"
        >
          <div
            className="h-full rounded-full bg-primary-container shadow-[0_0_8px_rgba(0,229,255,0.6)] transition-all duration-500"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        {nextRank && (
          <div className="mt-1 flex justify-between font-mono text-xs text-on-surface-variant">
            <span>{progress.floor}</span>
            <span>{progress.ceiling}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-base">
        <div className="flex items-center gap-2 rounded-lg bg-surface-container px-3 py-2 text-xs">
          <span className="material-symbols-outlined text-sm text-primary-container">trending_up</span>
          <span className="text-on-surface-variant">
            Win <b className="text-primary-container">+{MMR_WIN}</b>
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-surface-container px-3 py-2 text-xs">
          <span className="material-symbols-outlined text-sm text-[#ff6b78]">trending_down</span>
          <span className="text-on-surface-variant">
            Loss <b className="text-[#ff6b78]">-{MMR_LOSS}</b>
          </span>
        </div>
      </div>
    </div>
  );
}
