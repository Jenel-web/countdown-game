import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { Swords, Timer, Brain, Trophy, Zap, ArrowRight } from 'lucide-react';

const features = [
  { icon: Timer, label: '30-Second Clock', desc: 'Race against the countdown — every second counts.' },
  { icon: Brain,  label: 'Recursive Solvability', desc: 'Every puzzle is verified to have a valid solution path.' },
  { icon: Trophy, label: 'ELO Ranked', desc: 'Compete for rank points with every match you play.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <Navbar />

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24 gap-8">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 rounded-pill border border-primary/30 bg-surface-container px-4 py-1.5 text-sm font-mono text-primary">
          <Zap className="h-3.5 w-3.5" />
          Live 1v1 Math Arena
        </div>

        {/* Headline */}
        <h1 className="max-w-3xl text-5xl sm:text-6xl font-inter font-extrabold leading-tight tracking-tight text-on-surface">
          Hit the Target.<br />
          <span className="text-gradient-green">Beat the Clock.</span><br />
          Outsmart Your Rival.
        </h1>

        <p className="max-w-xl text-lg text-on-surface-var leading-relaxed">
          Six numbers. Four operators. One target. Thirty seconds.
          The first player to nail the exact result wins. Can you keep up?
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/lobby"
            className="btn-primary px-8 py-3 text-base gap-2">
            Find a Match
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/game"
            className="btn-secondary px-8 py-3 text-base gap-2">
            <Swords className="h-4 w-4" />
            Practice Board
          </Link>
        </div>

        {/* Features */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl w-full">
          {features.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="glass-card p-6 flex flex-col items-start gap-3 text-left">
              <div className="flex h-10 w-10 items-center justify-center rounded-tile bg-surface-high border border-primary/20">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <p className="font-inter font-semibold text-on-surface">{label}</p>
              <p className="text-sm text-on-surface-var leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-xs font-mono text-outline border-t border-white/5">
        Countdown Arena © 2026 — Powered by Google Stitch Design
      </footer>
    </div>
  );
}
