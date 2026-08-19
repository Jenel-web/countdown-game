'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError('Please enter your Operative ID and password.');
      return;
    }

    setLoading(true);
    // Simulating quick authorization
    setTimeout(() => {
      setLoading(false);
      router.push('/lobby');
    }, 800);
  };

  return (
    <div className="bg-background text-on-background min-h-screen flex items-center justify-center relative font-body-md text-body-md overflow-hidden selection:bg-primary-container/30 selection:text-primary-fixed">
      {/* Immersive Background Layers */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        {/* Deep Ambient Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary-container/5 rounded-full blur-[120px] opacity-70"></div>
        {/* Technical Grid Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"></div>
      </div>

      {/* Login Container (Float Glassmorphism) */}
      <main className="w-full max-w-md mx-4 p-10 rounded-xl bg-surface-container-low/40 backdrop-blur-[20px] border border-primary-container/15 relative z-10 flex flex-col gap-10 shadow-[0_0_60px_rgba(0,229,255,0.03)] animate-[fadeIn_0.5s_ease-out]">
        
        {/* Header Section */}
        <header className="text-center flex flex-col gap-2 items-center">
          {/* Brand Mark */}
          <div className="w-12 h-12 rounded-lg bg-surface flex items-center justify-center border border-primary-container/30 mb-2 shadow-[0_0_15px_rgba(0,229,255,0.1)]">
            <span className="material-symbols-outlined text-primary-container text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>calculate</span>
          </div>
          <h1 className="font-headline-xl text-headline-xl font-black tracking-tighter text-primary-container">COUNTDOWN</h1>
          <div className="flex items-center gap-2 text-on-surface-variant font-label-caps text-label-caps uppercase tracking-[0.2em]">
            <span className="w-2 h-2 rounded-full bg-primary-container animate-pulse shadow-[0_0_8px_rgba(0,229,255,0.8)]"></span>
            System Authentication
          </div>
        </header>

        {/* Error notification */}
        {error && (
          <div className="px-4 py-2 rounded-lg border border-error bg-error-container/20 text-error text-xs font-mono">
            {error}
          </div>
        )}

        {/* Form Section */}
        <form className="flex flex-col gap-6 w-full" onSubmit={handleSubmit}>
          {/* Username Input Group */}
          <div className="flex flex-col gap-2 relative group">
            <label className="font-label-caps text-label-caps text-on-surface-variant uppercase ml-1 transition-colors group-focus-within:text-primary-container" htmlFor="username">Username</label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary-container">person</span>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter Operative ID"
                spellCheck="false"
                className="w-full bg-surface-container text-on-surface pl-12 pr-4 py-4 rounded-lg border border-outline-variant focus:border-primary-container focus:ring-1 focus:ring-primary-container outline-none transition-all duration-300 placeholder:text-on-surface-variant/40 focus:shadow-[inset_0_0_12px_rgba(0,229,255,0.1)] font-mono-metric text-mono-metric"
              />
            </div>
          </div>

          {/* Password Input Group */}
          <div className="flex flex-col gap-2 relative group">
            <div className="flex justify-between items-end ml-1">
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase transition-colors group-focus-within:text-primary-container" htmlFor="password">Password</label>
              <a href="#" className="font-label-caps text-label-caps text-primary-container hover:text-primary-fixed transition-colors duration-200 hover:shadow-[0_0_8px_rgba(0,229,255,0.4)]">Forgot Password?</a>
            </div>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary-container">key</span>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-surface-container text-on-surface pl-12 pr-4 py-4 rounded-lg border border-outline-variant focus:border-primary-container focus:ring-1 focus:ring-primary-container outline-none transition-all duration-300 placeholder:text-on-surface-variant/40 focus:shadow-[inset_0_0_12px_rgba(0,229,255,0.1)] font-mono-metric text-mono-metric tracking-widest"
              />
            </div>
          </div>

          {/* Primary Action Button */}
          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full bg-primary-container text-on-primary-container font-label-caps text-label-caps uppercase py-4 rounded-lg hover:bg-primary-fixed hover:shadow-[0_0_24px_rgba(0,229,255,0.5)] transition-all duration-300 active:scale-[0.98] flex items-center justify-center gap-2 relative overflow-hidden group"
          >
            <span className="relative z-10 flex items-center gap-2">
              {loading ? 'Initializing...' : 'Initialize Login'}
              <span className="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </span>
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent group-hover:animate-[shimmer_1.5s_infinite]"></div>
          </button>
        </form>

        {/* Footer Section */}
        <footer className="text-center pt-2 border-t border-white/5">
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            New to Countdown?{' '}
            <Link href="/register" className="text-primary-container hover:text-primary-fixed transition-colors font-bold ml-1 relative after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1px] after:bg-primary-container after:origin-bottom-right after:scale-x-0 hover:after:origin-bottom-left hover:after:scale-x-100 after:transition-transform after:duration-300">
              Register
            </Link>
          </p>
        </footer>
      </main>

      <style jsx global>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
