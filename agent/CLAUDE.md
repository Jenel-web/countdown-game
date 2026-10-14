# CLAUDE.md: Countdown Math Arena

This is the main briefing for any AI assistant working on this repo. Read it before you change anything.
It sits next to `agents.md` (how to work) and `skills.md` (game and stack rules). If this file and one of
those disagree, this file wins, because it describes the code as it is today.

---

## 1. What this project is

A real-time, ranked 1v1 version of the *Countdown* numbers round. Both players get the same 6 tiles and a
target from 100 to 999. They have 30 seconds to get as close as they can using `+ − × ÷`. The first player
to 5.00 points wins the match.

There are two services that deploy separately:

| Service | Path | Stack | Hosted on |
| --- | --- | --- | --- |
| Web app | `/` (repo root) | Next.js 14 App Router, React 18, TypeScript, Tailwind, Framer Motion, `@supabase/ssr` | Vercel |
| Game server | `/countdown-server` | Node, Express, Socket.io 4, `@supabase/supabase-js` (service role) | Render, Railway or Fly.io |

Supabase provides Auth and Postgres with RLS. The game server is the **only** place that writes match
results.

---

## 2. Map of the code

### Web app
- `app/`: routes. These include `login`, `register`, `choose-username` (the first time someone signs in with Google), `auth/callback`,
  `lobby`, `game` (solo practice), `training`, `match/[matchId]` (live multiplayer), `history`, `terms`,
  `privacy` and `test-screens`.
- `components/`: shared UI such as modals, Navbar, ReconnectBanner and WaitingLobby. History UI lives in `components/history/`.
- `context/GameSocketContext.tsx`: owns the single typed Socket.io connection and the reconnect state.
- `hooks/useGameSocket.ts` and `hooks/useRoundTimer.ts`: socket and timer logic. Keep this logic out of page components.
- `lib/gameEngine.ts`: game logic for the client (practice and training boards).
- `lib/socket/types.ts`: a **copy** of the server's socket contract (see the sync rule below).
- `lib/auth/`: username validation (`username.ts`), claiming a username (`claimUsername.ts`) and password rules.
- `lib/history.ts`: data shaping for the History tab.
- `lib/supabase/client.ts` and `server.ts`: Supabase clients for the browser and the server. Both use the anon key only.
- `middleware.ts`: guards these routes: `/lobby`, `/game`, `/training`, `/history`. It also sends
  logged-in users who have no username to `/choose-username`.

### Game server (`countdown-server/src`)
- `index.ts`: starts Express and Socket.io and serves the `/health` endpoint.
- `game/gameEngine.ts`: tile and target generation, the recursive solver, step validation and scoring. **This is the source of truth.**
- `rooms/RoomManager.ts`: match state held in memory, plus timers.
- `socket/authMiddleware.ts`: checks the Supabase JWT and puts the user id on `socket.data`.
- `socket/handlers/`: `roomHandlers`, `roundHandlers`, `rematchHandlers`.
- `supabase/adminClient.ts`: the service-role client. `supabase/matchEnd.ts` stamps `matches.ended_at`.
- `types/events.ts`: the typed `ClientToServerEvents` / `ServerToClientEvents` / `SocketData` contract.

### Docs
- `docs/SYSTEM_STATUS_AND_TESTING_GUIDE.md`: what works today, plus the manual QA steps.
- `docs/HISTORY_TAB_PLAN.md`, plus the mockups in `docs/*.html`: the History feature that is in progress.
- `countdown-server/SCOPE.md`: the MVP scope lock, listing what is in and what is out.

---

## 3. Commands

```bash
# Web app (repo root)
npm run dev            # http://localhost:3000
npm run build
npm run lint
npm test               # root vitest: lib/, app/ tests (countdown-server/** is excluded)

# Game server
cd countdown-server
npm run dev            # http://localhost:4000, check GET /health
npm test               # integration tests: real sockets, mocked Supabase
npm run build          # tsc
```

- `npm run test:db` runs `countdown-server/test/db`. It needs a **local Supabase** to be running. Only run it if
  the user confirms that one is up.
- When you change code, run the test suite for the service you touched before you say the work is done.
  If you touched both services, run both.

---

## 4. Core rules you must keep

### Gameplay and security
1. **The server has the final say.** The client sends the *steps* it took, never a final result or a score.
   The server replays every step against the original tiles. Subtraction must stay positive and division must be exact.
2. **Never trust identity sent by the client.** The player's id always comes from `socket.data`, which the JWT
   middleware sets. It never comes from an event payload or a query string.
3. **Scores are integers** (points × 100). Never compare or store scores as floats.
4. **Match completion goes through the `finish_match` RPC.** That function is atomic and safe to call twice. Do not update
   `wins`, `losses`, `mmr` or the winner/score columns with your own `UPDATE`s.
5. **Remove the room from memory before any `await`** when a match ends. This stops a disconnect that happens
   at the same time from causing a second forfeit. Keep this order whenever you edit the end-of-match code.
6. After a match ends, `markMatchEnded` only logs failures and never throws. It must never break a result that has already been saved.

### Keep the socket contract in sync
- `countdown-server/src/types/events.ts` and `lib/socket/types.ts` must stay **identical** in shape.
  If you change one, change the other in the same task.
- Every `emit` and `on` call must be typed through these interfaces. Do not use `as any` and do not use untyped event names.

### Game engine
- `countdown-server/src/game/gameEngine.ts` is the source of truth. `lib/gameEngine.ts` is the client
  version, and the two files are **not** identical. If you change a scoring or validation rule, check both files and
  ask the user whether the client copy should change too.
- The scoring table is in `README.md` under "Round Scoring". It is a product decision. Do not "improve" it.

### Frontend
- Keep socket listeners and intervals in the context and hooks, not inside components that re-render a lot.
- Follow the "Countdown Kinetic" design: the dark slate `#0F172A` background, cyan accents, glass cards and
  pill-shaped operator buttons. Use the existing Tailwind tokens (`tailwind.config.ts`) and don't invent new colours.
- Usernames: 3 to 20 characters from `[a-z0-9_]`, checked case-insensitively against `RESERVED_USERNAMES`. Use
  `validateUsername` and `claimUsername`, and don't write new checks of your own.

---

## 5. Things you must NOT do

**Secrets and environment**
- ❌ Never read out, print, copy or commit `.env`, `.env.local` or `countdown-server/.env`.
- ❌ Never put `SUPABASE_SERVICE_ROLE_KEY` in the Next.js app or in any `NEXT_PUBLIC_*` variable. It belongs
  only in the game server.
- ❌ Never write a real key into any file, test or doc. Use placeholders like `"<your-anon-key>"`.

**Architecture**
- ❌ Never run WebSockets inside Next.js API routes, route handlers or serverless or edge functions.
- ❌ Do not import from `countdown-server/` into the Next.js app, or the other way round. They are separate
  build units, and a cross-import breaks the Vercel build. That is why `lib/socket/types.ts` is a copy.
- ❌ Do not add libraries the stack doesn't need (Redux, Zustand, Prisma, tRPC, UI kits such as MUI or
  shadcn, ORMs) unless the user asks for them by name.
- ❌ Do not move match state into the database or game results into the client. The server holds live state in
  memory, and Postgres holds facts that must last.

**Scope**
- ❌ Do not build out-of-scope features: chat, spectator mode, tournaments, 4-player free-for-all, avatars
  or sound packs (see `countdown-server/SCOPE.md`) unless the user asks for them.
- ❌ Do not do large refactors across many files without being asked. Work on one feature or one file at a time.

**Database**
- ❌ Do not loosen RLS, grants or `SECURITY DEFINER` functions to make a feature "just work".
- ❌ Do not run destructive SQL (DROP, TRUNCATE, or DELETE without WHERE) or reset the Supabase database.
- ❌ Do not change the `finish_match` signature or behaviour without updating `test/db/finish_match.db.test.ts`.

**Git and tests**
- ❌ Do not commit, push, force-push, rebase or delete branches unless the user asks. Work happens on
  feature branches (for example `match/...`). Never commit straight to `main`.
- ❌ Do not commit `tsconfig.tsbuildinfo`, `.next/`, `dist/` or `node_modules/`.
- ❌ Do not delete, skip or weaken a failing test (`.skip`, looser assertions) to make the suite pass.
  Fix the cause or report the failure.
- ❌ Do not mark work as done if you didn't run its tests. If you couldn't run them, say so.

**Behaviour**
- ❌ If a fix fails twice in a row, stop. Explain the root cause and ask the user before you try a third time.
- ❌ Do not guess design values. Ask, or take them from Stitch or the existing Tailwind tokens.

---

## 6. Before you finish a task, check:
- [ ] Is the socket contract still in sync across both files?
- [ ] Does the server still have the final say (no result, score or identity trusted from the client)?
- [ ] Have the tests for each service you touched been run, and do they pass?
- [ ] Are there no secrets, no new libraries, and nothing out of scope?
- [ ] Have you told the user which docs (`README.md`, `docs/`, `SCOPE.md`) need updating, if any?
