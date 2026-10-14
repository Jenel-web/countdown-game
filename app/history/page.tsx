'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import MatchRow from '@/components/history/MatchRow';
import MatchDetailModal from '@/components/history/MatchDetailModal';
import { createClient } from '@/lib/supabase/client';
import { fetchRecentMatches, type MatchSummary } from '@/lib/history';

const HISTORY_LIMIT = 10;

export default function HistoryPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MatchSummary | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.replace('/login');
          return;
        }
        const recent = await fetchRecentMatches(supabase, user.id, HISTORY_LIMIT);
        if (active) {
          setUserId(user.id);
          setMatches(recent);
        }
      } catch (err: any) {
        if (active) setError(err?.message || 'Could not load your match history.');
      }
    })();

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-background text-on-background">
      <Navbar />

      <main className="mx-auto max-w-[900px] px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        <h1 className="text-3xl font-semibold tracking-tight text-on-surface">Match History</h1>
        <p className="mb-5 mt-0.5 text-on-surface-variant">Your last {HISTORY_LIMIT} matches</p>

        {error ? (
          <p role="alert" className="rounded-lg border border-error bg-error-container/20 px-4 py-3 font-mono text-xs text-error">
            {error}
          </p>
        ) : matches === null ? (
          <div className="flex flex-col gap-3" aria-label="Loading matches">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[132px] animate-pulse rounded-xl bg-surface-bright/20" />
            ))}
          </div>
        ) : matches.length === 0 ? (
          <div className="glass-card px-6 py-14 text-center">
            <b className="mb-1 block text-base text-on-surface">No matches yet</b>
            <span className="text-sm text-on-surface-variant">Finish a match in the Arena and it will show up here.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {matches.map((match) => (
              <MatchRow key={match.id} match={match} onOpen={() => setSelected(match)} />
            ))}
          </div>
        )}
      </main>

      {selected && userId && (
        <MatchDetailModal match={selected} userId={userId} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
