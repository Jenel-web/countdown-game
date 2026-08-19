'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Password strength visual indicator
  const getStrength = (pw: string) => {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 10) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    return score; // 0 to 4
  };

  const strength = getStrength(password);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !password || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!agreeTerms) {
      setError('You must acknowledge the Terms of Engagement.');
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
    <div className="bg-background text-on-background min-h-screen flex flex-col font-body-md relative overflow-x-hidden selection:bg-primary-container/30 selection:text-primary-fixed">
      {/* Ambient Kinetic Background */}
      <div className="kinetic-bg">
        <div className="kinetic-line" style={{ top: '20%', animationDelay: '0s' }}></div>
        <div className="kinetic-line" style={{ top: '50%', animationDelay: '2s', height: '2px', opacity: 0.7 }}></div>
        <div className="kinetic-line" style={{ top: '80%', animationDelay: '4s' }}></div>
      </div>

      {/* Minimal Header / Brand Anchor */}
      <header className="fixed top-0 w-full flex justify-between items-center px-container-margin h-16 max-w-7xl mx-auto border-b border-white/5 bg-background/80 backdrop-blur-md z-50">
        <div className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg font-black tracking-tighter text-primary-container">
          COUNTDOWN
        </div>
        <div className="flex gap-4 items-center">
          <Link href="/login" className="font-label-caps text-label-caps text-on-surface-variant hover:text-primary-container transition-colors duration-200">
            LOGIN
          </Link>
          <Link href="/register" className="font-label-caps text-label-caps text-primary-container font-bold px-4 py-2 border border-primary-container/30 rounded hover:bg-primary-container/10 transition-colors">
            SIGN UP
          </Link>
        </div>
      </header>

      {/* Main Registration Area */}
      <main className="flex-grow flex items-center justify-center px-gutter md:px-container-margin py-24 relative z-10">
        <div className="glass-card rounded-xl p-8 md:p-12 w-full max-w-md shadow-2xl relative overflow-hidden animate-[fadeIn_0.5s_ease-out]">
          {/* Decorative accent top line */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-secondary-container via-primary-container to-secondary-container"></div>
          
          <div className="text-center mb-10">
            <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold mb-2">Initialize Profile</h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">Enter your credentials to join the arena.</p>
          </div>

          {error && (
            <div className="mb-6 px-4 py-2 rounded-lg border border-error bg-error-container/20 text-error text-xs font-mono">
              {error}
            </div>
          )}

          <form className="space-y-6" onSubmit={handleSubmit}>
            {/* Username Input */}
            <div>
              <label className="block font-label-caps text-label-caps text-outline mb-2" htmlFor="username">USERNAME / CALLSIGN</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">person</span>
                <input
                  id="username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className="w-full bg-[#0A192F] border border-outline-variant rounded py-3 pl-10 pr-4 text-on-surface font-mono-metric text-mono-metric focus:outline-none focus:ring-0 input-glow transition-all"
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label className="block font-label-caps text-label-caps text-outline mb-2" htmlFor="password">SECURE PASSWORD</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">lock</span>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#0A192F] border border-outline-variant rounded py-3 pl-10 pr-4 text-on-surface font-mono-metric text-mono-metric focus:outline-none focus:ring-0 input-glow transition-all"
                />
              </div>
              {/* Password Strength Indicator */}
              <div className="mt-2 flex gap-1 h-1">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={`flex-1 rounded-full transition-all duration-300 ${
                      i <= strength
                        ? strength === 1
                          ? 'bg-error-container'
                          : strength === 2
                          ? 'bg-yellow-500'
                          : strength === 3
                          ? 'bg-primary'
                          : 'bg-primary-container shadow-[0_0_8px_rgba(0,229,255,0.8)]'
                        : 'bg-surface-bright'
                    }`}
                  ></div>
                ))}
              </div>
            </div>

            {/* Confirm Password Input */}
            <div>
              <label className="block font-label-caps text-label-caps text-outline mb-2" htmlFor="confirm_password">VERIFY PASSWORD</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">verified_user</span>
                <input
                  id="confirm_password"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#0A192F] border border-outline-variant rounded py-3 pl-10 pr-4 text-on-surface font-mono-metric text-mono-metric focus:outline-none focus:ring-0 input-glow transition-all"
                />
              </div>
            </div>

            {/* Terms Checkbox */}
            <div className="flex items-start gap-3 mt-4">
              <div className="flex items-center h-5">
                <input
                  id="terms"
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="w-4 h-4 bg-[#0A192F] border-outline-variant rounded text-primary-container focus:ring-primary-container focus:ring-offset-0 focus:ring-2 focus:ring-offset-background cursor-pointer"
                />
              </div>
              <label className="font-body-sm text-body-sm text-on-surface-variant cursor-pointer select-none" htmlFor="terms">
                I acknowledge the <a className="text-primary-container hover:underline hover:text-primary-fixed transition-colors" href="#">Terms of Engagement</a> and <a className="text-primary-container hover:underline hover:text-primary-fixed transition-colors" href="#">Data Privacy Protocols</a>.
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary rounded font-label-caps text-label-caps py-4 font-bold flex justify-center items-center gap-2 mt-8 active:scale-[0.98] transition-transform duration-100"
            >
              <span>{loading ? 'INITIALIZING...' : 'CREATE ACCOUNT'}</span>
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>

            {/* Login Link */}
            <div className="text-center mt-6">
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Already registered in the system?{' '}
                <Link href="/login" className="text-primary-container font-medium hover:text-primary-fixed transition-colors">
                  Authenticate Here
                </Link>
              </p>
            </div>
          </form>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-stack-md bg-surface-container-lowest border-t border-white/5 mt-auto z-50">
        <div className="flex flex-col md:flex-row justify-between items-center px-container-margin w-full max-w-7xl mx-auto gap-4">
          <div className="font-body-sm text-body-sm text-on-surface-variant opacity-80">
            © 2024 COUNTDOWN ARENA. ALL SYSTEMS NOMINAL.
          </div>
        </div>
      </footer>

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
