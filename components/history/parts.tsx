import { formatMatchDate, formatScore, type MatchSummary } from '@/lib/history';

/** Small building blocks shared by the match row and the match window. */

export function StatusPill({ forfeit }: { forfeit: boolean }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${
        forfeit
          ? 'border-[#f5c26b]/55 bg-[#f5c26b]/10 text-[#f5c26b]'
          : 'border-outline-variant text-on-surface-variant'
      }`}
    >
      {forfeit ? 'Forfeit' : 'Completed'}
    </span>
  );
}

/** Top line of a match: date and time, number of rounds, and the match status. */
export function MatchMeta({ match }: { match: MatchSummary }) {
  return (
    <div className="flex flex-1 flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
      <span>
        <span className="font-medium text-on-surface">{formatMatchDate(match.endedAt)}</span>
        <span className="mx-1.5 text-outline">·</span>
        {match.roundCount} {match.roundCount === 1 ? 'round' : 'rounds'}
      </span>
      <StatusPill forfeit={match.forfeit} />
    </div>
  );
}

export function Avatar({ name, mine, size = 'md' }: { name: string; mine: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'h-11 w-11 text-base' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-9 w-9 text-sm';
  return (
    <span
      aria-hidden="true"
      className={`flex flex-none select-none items-center justify-center rounded-full border-[1.5px] font-bold ${dims} ${
        mine
          ? 'border-primary-container/55 bg-primary-container/10 text-primary-container'
          : 'border-[#82b1ff]/50 bg-[#2962ff]/15 text-[#82b1ff]'
      }`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** You on the left, the opponent on the right, the final score in the middle. */
export function ScoreLine({ match }: { match: MatchSummary }) {
  const win = match.didWin;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3.5">
      <div className="flex min-w-0 items-center justify-end gap-2.5">
        <span className="truncate text-sm font-semibold text-on-surface sm:text-[17px]" title={match.me.name}>
          {match.me.name}
        </span>
        <Avatar name={match.me.name} mine size="lg" />
      </div>
      <div
        className={`flex min-w-[84px] flex-col items-center rounded-[10px] border px-3 py-1.5 sm:min-w-[110px] sm:px-3.5 ${
          win
            ? 'border-[#4be277]/45 bg-[#4be277]/10 text-[#4be277]'
            : 'border-[#ff6b78]/45 bg-[#ff6b78]/10 text-[#ff6b78]'
        }`}
      >
        <b className="font-mono text-[17px] font-bold leading-[1.3] tabular-nums sm:text-[22px]">
          {formatScore(match.me.totalRaw)} – {formatScore(match.opponent.totalRaw)}
        </b>
        <small className="text-[10px] font-bold uppercase tracking-[0.1em]">{win ? 'Victory' : 'Defeat'}</small>
      </div>
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={match.opponent.name} mine={false} size="lg" />
        <span className="truncate text-sm font-semibold text-on-surface sm:text-[17px]" title={match.opponent.name}>
          {match.opponent.name}
        </span>
      </div>
    </div>
  );
}

/** The six round numbers, in the site's cyan: cyan border, cyan digits. */
export function TileChips({ tiles, small = false }: { tiles: number[]; small?: boolean }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {tiles.map((value, i) => (
        <span
          key={i}
          className={`rounded-lg border border-primary-container/50 bg-surface-container-high text-center font-mono font-semibold text-primary-container ${
            small ? 'min-w-[30px] px-1.5 py-0.5 text-[11px]' : 'min-w-[38px] px-2 py-1 text-[13px]'
          }`}
        >
          {value}
        </span>
      ))}
    </div>
  );
}
