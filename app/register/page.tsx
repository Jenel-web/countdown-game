'use client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { createClient } from '@/lib/supabase/client';
import { useState } from 'react';
import Navbar from '@/components/Navbar';
import GoogleOAuthButton from '@/components/GoogleOAuthButton';
import { usernameToEmail, validateUsername } from '@/lib/auth/username';
import { claimUsername } from '@/lib/auth/claimUsername';
import { PASSWORD_RULES, isPasswordValid, passedRuleCount } from '@/lib/auth/password';

const supabase = createClient();

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Password strength visual indicator
  // Bar fills as more of the 5 checklist rules pass (0 to 4 segments)
  const strength = Math.min(4, passedRuleCount(password));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!username || !password || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }

    const usernameError = validateUsername(username);
    if (usernameError) {
      setError(usernameError);
      return;
    }

    if (!isPasswordValid(password)) {
      setError('Password does not meet all the requirements below.');
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

    const email = usernameToEmail(username);

    const { data, error: authError } = await supabase.auth.signUp({
      email, // synthetic email derived from the username
      password,
    });

    if (authError) {
      setLoading(false);
      setError(
        /already|registered|exists/i.test(authError.message)
          ? 'That username is already taken.'
          : authError.message
      );
      return;
    }

    // With email confirmation off, Supabase returns a fake user with no
    // identities when the address already exists.
    if (data.user && data.user.identities?.length === 0) {
      setLoading(false);
      setError('That username is already taken.');
      return;
    }

    // The profiles row is created by the database (handle_new_user) when the
    // account is. The browser may only set its username, once: every other
    // profile column is written by the game server alone
    // (docs/sql/2026-10-21-lockdown-c2.sql).
    if (data.user) {
      const claim = await claimUsername(supabase, data.user.id, username);
      if (!claim.ok) {
        // The account exists but the name did not stick (e.g. someone took it a
        // moment ago). The middleware sends them to /choose-username after login.
        setLoading(false);
        setSuccess(`Account created, but ${claim.error.replace(/\.$/, '').toLowerCase()}. You can pick a username after logging in.`);
        setTimeout(() => router.push('/login?registered=true'), 2600);
        return;
      }
    }

    setLoading(false);
    setSuccess('Player is registered! Redirecting to login screen...');

    setTimeout(() => {
      router.push('/login?registered=true');
    }, 1800);
  };

  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col font-body-md relative overflow-x-hidden selection:bg-primary-container/30 selection:text-primary-fixed">
      {/* Ambient Kinetic Background */}
      <div className="kinetic-bg">
        <div className="kinetic-line" style={{ top: '20%', animationDelay: '0s' }}></div>
        <div className="kinetic-line" style={{ top: '50%', animationDelay: '2s', height: '2px', opacity: 0.7 }}></div>
        <div className="kinetic-line" style={{ top: '80%', animationDelay: '4s' }}></div>
      </div>

      <Navbar />

      {/* Main Registration Area */}
      <main className="flex-grow flex items-start justify-center px-gutter md:px-container-margin pt-24 pb-10 relative z-10">
        <div className="glass-card rounded-xl p-6 md:p-8 w-full max-w-md shadow-2xl relative overflow-hidden animate-[fadeIn_0.5s_ease-out]">
          {/* Decorative accent top line */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-secondary-container via-primary-container to-secondary-container"></div>

          <div className="text-center mb-6">
            <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold mb-2">Initialize Profile</h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">Enter your credentials to join the arena.</p>
          </div>

          {error && (
            <div className="mb-6 px-4 py-3 rounded-lg border border-error bg-error-container/20 text-error text-xs font-mono animate-[fadeIn_0.3s_ease-out]">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-6 px-4 py-3 rounded-lg border border-primary-container/40 bg-primary-container/10 text-primary-container text-xs font-mono flex items-center gap-2 animate-[fadeIn_0.3s_ease-out] shadow-[0_0_15px_rgba(0,229,255,0.15)]">
              <span className="material-symbols-outlined text-base">check_circle</span>
              <span>{success}</span>
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            {/* Username Input */}
            <div>
              <label className="block font-label-caps text-label-caps text-outline mb-2" htmlFor="username">USERNAME / CALLSIGN</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">person</span>
                <input
                  id="username"
                  type="text"
                  required
                  autoComplete="username"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username (3-20 letters, numbers, _)"
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
                    className={`flex-1 rounded-full transition-all duration-300 ${i <= strength
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
              {/* Password Requirements Checklist */}
              <ul className="mt-3 space-y-1" aria-label="Password requirements">
                {PASSWORD_RULES.map((rule) => {
                  const met = rule.test(password);
                  return (
                    <li
                      key={rule.id}
                      className={`flex items-center gap-2 text-xs font-mono transition-colors duration-200 ${met ? 'text-primary-container' : 'text-on-surface-variant'}`}
                    >
                      <span className="material-symbols-outlined text-sm">
                        {met ? 'check_circle' : 'radio_button_unchecked'}
                      </span>
                      <span>{rule.label}</span>
                    </li>
                  );
                })}
              </ul>
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
              {confirmPassword && (
                <p className={`mt-2 text-xs font-mono ${password === confirmPassword ? 'text-primary-container' : 'text-error'}`}>
                  {password === confirmPassword ? 'Passwords match' : 'Passwords do not match'}
                </p>
              )}
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
                I acknowledge the <a className="text-primary-container hover:underline hover:text-primary-fixed transition-colors" href="/terms" target="_blank" rel="noopener noreferrer">Terms of Engagement</a> and <a className="text-primary-container hover:underline hover:text-primary-fixed transition-colors" href="/privacy" target="_blank" rel="noopener noreferrer">Data Privacy Protocols</a>.
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

            {/* OAuth Divider */}
            <div className="flex items-center gap-3 w-full mt-2">
              <div className="flex-1 h-px bg-white/10" />
              <span className="font-label-caps text-label-caps text-on-surface-variant/50 uppercase tracking-widest text-[10px]">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Google OAuth — creates a new profile on first sign-in,
                or signs the returning user in without touching their data */}
            <GoogleOAuthButton label="Sign up with Google" />

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
