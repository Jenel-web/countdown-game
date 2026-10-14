'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface GoogleOAuthButtonProps {
  /** Label shown on the button. Defaults to "Continue with Google" */
  label?: string;
}

/**
 * GoogleOAuthButton
 *
 * Initiates the Google OAuth PKCE flow via Supabase.
 * The user is redirected to Google's consent page; after they authenticate
 * (or cancel) Google redirects back to /auth/callback which exchanges the
 * code for a session server-side.
 *
 * Design matches the existing dark-navy / cyan / green aesthetic.
 */
export default function GoogleOAuthButton({
  label = 'Continue with Google',
}: GoogleOAuthButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);

    const supabase = createClient();

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        /**
         * redirectTo must match exactly what is registered in both:
         *   - Supabase Dashboard → Authentication → URL Configuration → Redirect URLs
         *   - Google Cloud Console → OAuth 2.0 Client → Authorised redirect URIs
         *
         * During local development this resolves to http://localhost:3000/auth/callback.
         * In production replace window.location.origin with your deployed domain.
         */
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          // Ask Google to always show the account picker so a user can choose
          // a different account without having to sign out of Google first.
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (oauthError) {
      console.error('[GoogleOAuthButton] OAuth initiation error:', oauthError.message);
      setError('Could not start Google sign-in. Please try again.');
      setLoading(false);
    }
    // On success, Supabase triggers a full-page redirect to Google — nothing
    // more to do client-side. We intentionally leave loading=true so the
    // button stays disabled during the redirect.
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <button
        type="button"
        id="google-oauth-btn"
        onClick={handleGoogleSignIn}
        disabled={loading}
        aria-label={loading ? 'Redirecting to Google…' : label}
        className={[
          // Base layout
          'w-full flex items-center justify-center gap-3 py-4 px-4 rounded-lg',
          // Border + subtle glass background matching the card aesthetic
          'border border-outline-variant bg-surface-container/60 backdrop-blur-sm',
          // Typography
          'font-label-caps text-label-caps uppercase text-on-surface tracking-[0.08em]',
          // Hover / focus states using the cyan accent used elsewhere
          'hover:border-primary-container/60 hover:bg-surface-container hover:shadow-[0_0_16px_rgba(0,229,255,0.12)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          // Disabled state
          'disabled:opacity-50 disabled:cursor-not-allowed',
          // Smooth transitions
          'transition-all duration-300 active:scale-[0.98]',
        ].join(' ')}
      >
        {/* Google "G" SVG logo — inline so there's no external dependency */}
        {loading ? (
          /* Spinner */
          <svg
            className="w-5 h-5 animate-spin text-primary-container"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
        ) : (
          <svg
            className="w-5 h-5 flex-shrink-0"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
        )}

        <span>{loading ? 'Redirecting to Google…' : label}</span>
      </button>

      {/* Inline error — only shown if the OAuth initiation itself fails
          (network error, misconfigured provider, etc.) */}
      {error && (
        <p
          role="alert"
          className="text-error text-xs font-mono px-1 animate-[fadeIn_0.3s_ease-out]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
