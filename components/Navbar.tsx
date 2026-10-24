'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Swords, Dumbbell, Trophy, Clock, LogIn, UserPlus, LogOut } from 'lucide-react';
import Logo from '@/components/Logo';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { displayName } from '@/lib/auth/username';

const navLinks = [
  { href: '/lobby', label: 'Arena', icon: Swords, match: ['/lobby', '/game'] },
  { href: '/training', label: 'Training', icon: Dumbbell, match: ['/training'] },
  { href: '/history', label: 'History', icon: Clock, match: ['/history'] },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    const fetchUsername = async (userId: string | undefined) => {
      if (!userId) {
        if (isMounted) setUsername(null);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      if (isMounted) setUsername(data?.username ?? null);
    };

    const fetchUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (isMounted) {
          setUser(user);
          setLoading(false);
        }
        await fetchUsername(user?.id);
      } catch {
        if (isMounted) setLoading(false);
      }
    };

    fetchUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
      // Deferred so we never await a Supabase call inside the auth callback.
      setTimeout(() => fetchUsername(session?.user?.id), 0);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setUsername(null);
    router.push('/login');
    router.refresh();
  };

  return (
    <nav className="sticky top-0 z-50 w-full">
      <div className="glass-card rounded-none border-x-0 border-t-0 border-b border-white/[0.07] px-6 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <Logo size={36} className="transition-transform group-hover:scale-105" />
            <span className="font-inter font-bold text-base tracking-tight text-on-surface hidden min-[380px]:inline">
              Countdown<span className="text-primary ml-0.5">Arena</span>
            </span>
          </Link>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {navLinks.map(({ href, label, icon: Icon, match }) => {
              const active = match.some(m => pathname === m || pathname.startsWith(m));
              const isPlaceholder = href === '/rankings';
              return (
                <Link
                  key={href}
                  href={isPlaceholder ? '#' : href}
                  aria-disabled={isPlaceholder}
                  className={`relative flex items-center gap-1.5 rounded-pill px-4 py-1.5 text-sm font-medium transition-all duration-150 ${active
                    ? 'text-[#00F0FF] bg-surface-high'
                    : isPlaceholder
                      ? 'text-on-surface-var/40 cursor-not-allowed'
                      : 'text-on-surface-var hover:text-on-surface hover:bg-surface-high/60'
                    }`}
                  style={active ? { textShadow: '0 0 8px #00F0FF, 0 0 20px rgba(0,240,255,0.4)' } : {}}
                  onClick={isPlaceholder ? e => e.preventDefault() : undefined}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  {active && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-3/4 rounded-full"
                      style={{ background: '#00F0FF', boxShadow: '0 0 8px #00F0FF' }} />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Auth State */}
          <div className="flex items-center gap-2 min-h-[36px]">
            {loading ? (
              <div className="h-8 w-24 bg-surface-bright/20 animate-pulse rounded-pill"></div>
            ) : user ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-surface-high/80 border border-outline-variant/20 text-xs font-mono text-on-surface">
                  <div className="w-2 h-2 rounded-full bg-primary-container shadow-[0_0_8px_rgba(0,229,255,0.8)] animate-pulse"></div>
                  <span className="max-w-[140px] truncate text-primary-container font-medium">
                    {displayName({ username, email: user.email })}
                  </span>
                </div>
                <button
                  onClick={handleSignOut}
                  className="btn-secondary px-3 py-1.5 text-xs sm:text-sm flex items-center gap-1.5 hover:border-error/50 hover:text-error transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : (
              <>
                <Link href="/login" className="btn-secondary px-4 py-1.5 text-sm">
                  <LogIn className="h-3.5 w-3.5" /> Sign In
                </Link>
                <Link href="/register" className="btn-primary px-4 py-1.5 text-sm">
                  <UserPlus className="h-3.5 w-3.5" /> Join
                </Link>
              </>
            )}
          </div>

        </div>
      </div>
    </nav>
  );
}
