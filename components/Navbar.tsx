'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Swords, Dumbbell, Trophy, Clock, LogIn, UserPlus, Zap } from 'lucide-react';

const navLinks = [
  { href: '/lobby',    label: 'Arena',    icon: Swords,    match: ['/lobby', '/game'] },
  { href: '/training', label: 'Training', icon: Dumbbell,  match: ['/training'] },
  { href: '/rankings', label: 'Rankings', icon: Trophy,    match: ['/rankings'] },
  { href: '/history',  label: 'History',  icon: Clock,     match: ['/history'] },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 w-full">
      <div className="glass-card rounded-none border-x-0 border-t-0 border-b border-white/[0.07] px-6 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-container shadow-glow-green transition-all group-hover:shadow-glow-green">
              <Zap className="h-4 w-4 text-on-primary" strokeWidth={2.5} />
            </div>
            <span className="font-inter font-bold text-base tracking-tight text-on-surface">
              Countdown<span className="text-primary ml-0.5">Arena</span>
            </span>
          </Link>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {navLinks.map(({ href, label, icon: Icon, match }) => {
              const active = match.some(m => pathname === m || pathname.startsWith(m));
              const isPlaceholder = href === '/rankings' || href === '/history';
              return (
                <Link
                  key={href}
                  href={isPlaceholder ? '#' : href}
                  aria-disabled={isPlaceholder}
                  className={`relative flex items-center gap-1.5 rounded-pill px-4 py-1.5 text-sm font-medium transition-all duration-150 ${
                    active
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

          {/* Auth */}
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-secondary px-4 py-1.5 text-sm">
              <LogIn className="h-3.5 w-3.5" /> Sign In
            </Link>
            <Link href="/register" className="btn-primary px-4 py-1.5 text-sm">
              <UserPlus className="h-3.5 w-3.5" /> Join
            </Link>
          </div>

        </div>
      </div>
    </nav>
  );
}
