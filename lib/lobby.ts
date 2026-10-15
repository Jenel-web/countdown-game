const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "Just now", "5m ago", "2h ago", "Yesterday", "Mon", then "Oct 3". */
export function formatRelativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const diff = now - then.getTime();
  if (diff < MINUTE) return 'Just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)}h ago`;

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(then)) / (24 * HOUR));
  if (days <= 1) return 'Yesterday';
  if (days < 7) return then.toLocaleDateString('en-US', { weekday: 'short' });
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
