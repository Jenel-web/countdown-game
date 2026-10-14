'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase/client';
import { validateUsername } from '@/lib/auth/username';
import { claimUsername, isUsernameAvailable } from '@/lib/auth/claimUsername';

const supabase = createClient();

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function ChooseUsernamePage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [username, setUsername] = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [hint, setHint] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Only logged-in players without a username belong on this page.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .maybeSingle();
      if (profile?.username) {
        router.replace('/lobby');
        return;
      }
      if (active) {
        setUserId(user.id);
        setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  // Debounced live availability check.
  useEffect(() => {
    setError('');
    if (!username) {
      setAvailability('idle');
      setHint('');
      return;
    }
    const invalid = validateUsername(username);
    if (invalid) {
      setAvailability('invalid');
      setHint(invalid);
      return;
    }
    setAvailability('checking');
    setHint('Checking availability...');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const free = await isUsernameAvailable(supabase, username);
        if (cancelled) return;
        setAvailability(free ? 'available' : 'taken');
        setHint(free ? 'Username is available.' : 'That username is already taken.');
      } catch {
        if (cancelled) return;
        setAvailability('idle');
        setHint('');
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || saving) return;
    setError('');

    const invalid = validateUsername(username);
    if (invalid) {
      setError(invalid);
      return;
    }

    setSaving(true);
    const result = await claimUsername(supabase, userId, username);
    if (!result.ok) {
      setSaving(false);
      setError(result.error);
      if (/taken/i.test(result.error)) setAvailability('taken');
      return;
    }
    router.replace('/lobby');
    router.refresh();
  };

  const hintColor =
    availability === 'available'
      ? 'text-primary-container'
      : availability === 'taken' || availability === 'invalid'
        ? 'text-error'
        : 'text-on-surface-variant';

  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col font-body-md relative overflow-x-hidden selection:bg-primary-container/30 selection:text-primary-fixed">
      <div className="kinetic-bg">
        <div className="kinetic-line" style={{ top: '20%', animationDelay: '0s' }}></div>
        <div className="kinetic-line" style={{ top: '50%', animationDelay: '2s', height: '2px', opacity: 0.7 }}></div>
        <div className="kinetic-line" style={{ top: '80%', animationDelay: '4s' }}></div>
      </div>

      <Navbar />

      <main className="flex-grow flex items-start justify-center px-gutter md:px-container-margin pt-24 pb-10 relative z-10">
        <div className="glass-card rounded-xl p-6 md:p-8 w-full max-w-md shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-secondary-container via-primary-container to-secondary-container"></div>

          <div className="text-center mb-6">
            <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold mb-2">Choose Your Callsign</h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              This is the name other players will see. It can&apos;t be changed later.
            </p>
          </div>

          {error && (
            <div className="mb-6 px-4 py-3 rounded-lg border border-error bg-error-container/20 text-error text-xs font-mono">
              {error}
            </div>
          )}

          {!ready ? (
            <div className="h-24 bg-surface-bright/20 animate-pulse rounded-lg" />
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="block font-label-caps text-label-caps text-outline mb-2" htmlFor="username">USERNAME / CALLSIGN</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">person</span>
                  <input
                    id="username"
                    type="text"
                    required
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={20}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-[#0A192F] border border-outline-variant rounded py-3 pl-10 pr-4 text-on-surface font-mono-metric text-mono-metric focus:outline-none focus:ring-0 input-glow transition-all"
                  />
                </div>
                <p className={`mt-2 text-xs font-mono min-h-[1rem] ${hintColor}`}>
                  {hint || '3-20 characters: letters, numbers and underscore.'}
                </p>
              </div>

              <button
                type="submit"
                disabled={saving || availability === 'taken' || availability === 'invalid' || availability === 'checking'}
                className="w-full btn-primary rounded font-label-caps text-label-caps py-4 font-bold flex justify-center items-center gap-2 mt-4 active:scale-[0.98] transition-transform duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>{saving ? 'SAVING...' : 'CONFIRM USERNAME'}</span>
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
