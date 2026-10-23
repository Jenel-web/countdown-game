# Deployment checklist (staging first)

Two services, deployed separately. Do them in this order, because each one needs
the other's address.

| Service | Folder | Host | Needs |
|---|---|---|---|
| Game server | `countdown-server/` | Render, Railway or Fly | its own env vars (below) |
| Web app | repository root | Vercel | the game server's public address |
| Database | Supabase | Supabase | the SQL in `docs/sql/` already applied |

`.env.example` (web) and `countdown-server/.env.example` list every variable
with placeholders. Never commit a real `.env`.

## 0. Database (once)

Apply, in order, in the Supabase SQL editor: `2026-10-21-lockdown-a.sql`, then
(after the new web app is live) `2026-10-21-lockdown-c1.sql` and
`2026-10-21-lockdown-c2.sql`. Check `verify-lockdown-a.sql` shows
`all_applied: true`. Each step has a `-ROLLBACK.sql`.

## 1. Game server

- Root directory: `countdown-server`
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/health` (returns `{"status":"ok"}`)
- Environment:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | your project address, https |
| `SUPABASE_SERVICE_ROLE_KEY` | the **service role** key. This server only. |
| `ALLOWED_ORIGIN` | your website address, e.g. `https://your-site.vercel.app`, no trailing path. **Required**: the server refuses to start without it. |
| `TRUST_PROXY` | `true` (Render, Railway and Fly all sit behind one proxy). If unset, every player shares one connection-rate limit. |

The server prints `[config]` warnings at start-up for anything suspicious. Read them.

## 2. Web app (Vercel)

- Environment (Production and Preview):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your project address, https |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **anon / publishable** key. Never the service role key. |
| `NEXT_PUBLIC_SOCKET_URL` | the game server's public **https** address |

- `NEXT_PUBLIC_` values are fixed when the site is **built**. Change one, then redeploy.
- The build fails, on purpose, when one of these is missing or wrong, or when a
  service role key is in a public variable (`config/checkWebEnv.js`).
- Optional: `CSP_ENFORCE=true` turns the report-only content policy into an enforced one (see step 4).

## 3. Supabase dashboard

- Authentication > URL Configuration: set the Site URL to the website address and
  add `https://<your-site>/auth/callback` to the redirect URLs (Google sign-in).
- Authentication > Attack Protection: turn CAPTCHA back on **only after** the app
  sends a CAPTCHA token. Until then, password sign-up and login fail.

## 4. Smoke test on staging

1. `GET <game server>/health` returns `{"status":"ok"}`.
2. Register a new account, log in, log out. Sign in with Google, pick a username.
3. Two accounts (one in a private window): create a challenge link, open it with
   the second account, play a round, finish or forfeit a match.
4. Check wins, losses and MMR changed, and History lists the match.
5. Open DevTools > Console on the lobby, a match and History. Look for messages
   starting `[Report Only] Refused to ...`. No messages means the strict content
   policy is safe to enforce: set `CSP_ENFORCE=true` and redeploy. Any message
   names the address that would be blocked.
6. Run `countdown-server/scripts/db-attack-sim.ts` against the project: every attack must be BLOCKED.

## Not done yet (see the production-readiness review)

Raw-handshake and room-per-socket limits on the game server, a rule against
MMR farming by forfeit, a CAPTCHA widget, password reset, account deletion,
graceful shutdown and a retry for `finish_match`, error monitoring and CI, and a
move to Next.js 15 (the remaining Next 14 advisories are only fixed there).
Treat staging as private until these are addressed.
