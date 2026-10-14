# CLAUDE.md — Countdown Math Arena

This file is the main project briefing for AI coding assistants working in this repository. Read it before making changes.

It works alongside `agents.md` (workflow and collaboration conventions) and `skills.md` (game-specific and technology-specific guidance). Check that these files exist at the expected paths before relying on them.

This file documents the intended architecture, known implementation details, and non-negotiable invariants. Verify relevant claims against the current code before making changes.

If this file conflicts with the implementation or another document, do not silently assume which is correct. Distinguish intended behavior from observed behavior and ask the user when resolving the conflict could affect architecture, security, gameplay rules, or scope.

Security and data-integrity invariants must not be weakened without explicit user approval.

---

## 1. What This Project Is

Countdown Math Arena is a real-time, ranked 1v1 implementation of the _Countdown_ numbers round.

Both players receive the same six number tiles and a target from 100 to 999. They have 30 seconds to get as close as possible using addition, subtraction, multiplication, and division. The first player to reach 5.00 points wins the match.

There are two separately deployed services:

| Service         | Path                  | Stack                                                                                     | Hosting                    |
| --------------- | --------------------- | ----------------------------------------------------------------------------------------- | -------------------------- |
| Web application | Repository root (`/`) | Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Framer Motion, `@supabase/ssr` | Vercel                     |
| Game server     | `/countdown-server`   | Node.js, Express, Socket.io 4, `@supabase/supabase-js` service-role client                | Render, Railway, or Fly.io |

Supabase provides authentication and Postgres with Row Level Security (RLS).

The game server is the authoritative writer of multiplayer match results. Do not introduce alternative result-writing paths.

Verify deployment targets, package versions, routes, and architectural details against the current repository when working in these areas.

---

## 2. Repository Map

### Web application

- `app/`: Next.js routes, including `login`, `register`, `choose-username`, `auth/callback`, `lobby`, `game` (solo practice), `training`, `match/[matchId]` (live multiplayer), `history`, `terms`, `privacy`, and `test-screens`. Verify the current route structure before adding or changing routes.
- `components/`: Shared UI, including modals, Navbar, ReconnectBanner, and WaitingLobby. History UI lives in `components/history/`.
- `context/GameSocketContext.tsx`: Owns the shared typed Socket.io connection and reconnect state.
- `hooks/useGameSocket.ts` and `hooks/useRoundTimer.ts`: Socket and timer logic. Keep reusable socket and timer behavior in the appropriate context or hooks rather than duplicating it in frequently re-rendering page components.
- `lib/gameEngine.ts`: Client-side game logic for practice and training boards.
- `lib/socket/types.ts`: Copy of the server socket contract. Keep it synchronized with the server contract.
- `lib/auth/`: Username validation (`username.ts`), username claiming (`claimUsername.ts`), and password rules.
- `lib/history.ts`: Data shaping for the History tab.
- `lib/supabase/client.ts` and `lib/supabase/server.ts`: Browser and server Supabase clients. The web application must use the anon/publishable key, not the service-role key.
- `middleware.ts`: Guards protected routes, currently including `/lobby`, `/game`, `/training`, and `/history`. It also redirects authenticated users without a username to `/choose-username`.

### Game server

Located under `countdown-server/src/`.

- `index.ts`: Starts Express and Socket.io and serves the `/health` endpoint.
- `game/gameEngine.ts`: Tile and target generation, recursive solver, step validation, and scoring. This is the authoritative multiplayer game engine.
- `rooms/RoomManager.ts`: In-memory match state and timers.
- `socket/authMiddleware.ts`: Validates the Supabase JWT and places the authenticated user ID on `socket.data`.
- `socket/handlers/`: Room, round, and rematch handlers.
- `supabase/adminClient.ts`: Service-role Supabase client.
- `types/events.ts`: Typed `ClientToServerEvents`, `ServerToClientEvents`, and `SocketData` contracts.

### Documentation

- `README.md`: Public project overview, setup, architecture, and product rules.
- `docs/SYSTEM_STATUS_AND_TESTING_GUIDE.md`: Known implementation status and manual QA instructions.
- `docs/HISTORY_TAB_PLAN.md` and relevant `docs/*.html` mockups: History feature planning and design references.
- `countdown-server/SCOPE.md`: MVP scope boundaries and excluded features.
- `agents.md`: Workflow and collaboration conventions, if present.
- `skills.md`: Detailed game and stack guidance, if present.

Before relying on a document as current, inspect it if the task depends on its contents.

---

## 3. Development Commands

### Web application — repository root

```bash
npm run dev
npm run build
npx tsc --noEmit
npm test
```

- Development server: `http://localhost:3000`
- Linting: the repository has no ESLint configuration. `npm run lint` (`next lint`) stops at an interactive setup prompt and cannot run unattended, so do not run it. Use `npx tsc --noEmit` and `npm run build` for type and build checks until the user sets up ESLint.
- Root Vitest suite: `lib/` and `app/` tests. Confirm current test configuration and exclusions before assuming which files are covered.

### Game server

```bash
cd countdown-server
npm run dev
npm test
npm run build
```

- Development server: `http://localhost:4000`
- Health endpoint: `GET /health`
- Server tests: integration tests using real Socket.io clients and mocked Supabase, subject to the current test configuration.
- Build: TypeScript compilation.

### Database tests

`npm run test:db` (from the repository root or `countdown-server/`) runs the database tests under `countdown-server/test/db` using `countdown-server/vitest.db.config.ts`. Without the `LOCAL_SUPABASE_*` variables every test is skipped. The repository has no migrations, so the local database must be built by hand from the live schema and `docs/sql/` first.

These tests require a local Supabase environment. Do not start, reset, or modify a database just to run them without first confirming the intended environment with the user.

### Testing requirements

- After changing the web application, run the relevant web tests and checks.
- After changing the game server, run the relevant server tests and build.
- If both services are affected, test both.
- For database changes, run appropriate database tests when the required local environment is available.
- If a check cannot run, report why and identify what remains unverified.
- Do not claim tests pass unless their results confirm that they pass.

Use targeted tests during development when appropriate, followed by the relevant broader suite before declaring the task complete.

---

## 4. Non-Negotiable Gameplay and Security Invariants

### 4.1 Server-authoritative gameplay

1. The server has the final say for multiplayer validation and scoring.
2. The client submits the operation steps it performed, not a trusted final result or score.
3. The server replays each submitted operation against the original tiles and validates the complete sequence.
4. Subtraction must remain positive, and division must be exact, according to the current game rules.
5. Never trust a client-supplied score, winner, match result, or player identity.
6. Do not move authoritative multiplayer validation into the frontend.

A client-side validation check can improve user experience, but it must not replace server validation.

### 4.2 Identity and authentication

- A multiplayer player's identity must come from the authenticated socket context, specifically `socket.data` populated by the JWT middleware.
- Never accept player identity from an event payload or query string as authoritative identity.
- Validate authentication before allowing protected socket actions.
- Preserve existing session, callback, and redirect behavior when modifying authentication.
- Do not trust client-provided username or profile fields without applying the existing validation and authorization rules.
- When adding an authentication provider, inspect the complete existing auth and profile-creation flow first.

### 4.3 Scores and match completion

- Scores are integers representing points multiplied by 100. Do not introduce floating-point score comparisons or persistence.
- Multiplayer match completion must go through the `finish_match` RPC (the 5-argument version).
- `finish_match` is the only writer of `matches.status`, `winner_id`, the total-points columns and `ended_at`, and of `wins`, `losses`, `matches_played` and `mmr` (+25 winner, -15 loser, floor 0) on `profiles`. The server must not update those columns itself, and the MMR values live only inside the function.
- `finish_match` must stay executable only by `service_role`. It is `SECURITY DEFINER`, so never grant `EXECUTE` to `anon`, `authenticated`, or `public`, and keep `set search_path = public` on it. The old 3-argument overload was dropped on purpose: do not recreate it.
- The RPC is responsible for atomic, idempotent match-result processing according to its current implementation.
- Do not independently update `wins`, `losses`, `mmr`, winner columns, or score columns as an alternative match-completion path.
- Inspect the RPC and its database tests before changing its signature, behavior, or calling convention.
- Do not assume that a successful authentication account automatically has a game profile.

### 4.4 Match termination and concurrency

- When a match ends, remove or mark the room as terminal before yielding to asynchronous work, following the existing room-manager and match-end design.
- Preserve the ordering that prevents simultaneous disconnects or other concurrent events from finalizing the same match twice.
- Check for duplicate submissions, duplicate disconnect events, stale timers, and repeated finalization attempts when modifying match lifecycle code.
- A failed `finish_match` call is logged and must not stop the `match_over` or `opponent_left` notification to players. Preserve that behavior unless an explicit, reviewed design change requires otherwise.
- Do not assume a timeout, disconnect, or database error has only one possible execution order. Inspect the relevant state transitions and tests.

---

## 5. Socket Contract and Service Boundaries

### Socket types

These files must remain synchronized in structure:

- `countdown-server/src/types/events.ts`
- `lib/socket/types.ts`

If the socket contract changes, update both copies in the same task.

- Keep event names and payloads typed through the existing socket interfaces.
- Do not introduce `as any` to bypass socket type errors.
- Do not use untyped event names when typed contracts are available.
- Inspect both client and server call sites when changing an event's name, payload, response, or error behavior.
- If the types are intentionally different, explain the reason and document the boundary instead of silently allowing drift.

### Separate build units

The web application and game server are independently built and deployed services.

- Do not import server implementation files from `countdown-server/` into the Next.js application or import Next.js application code into the game server.
- Shared contracts currently use a copied type definition because the services are separate build units. Preserve that boundary unless the user explicitly approves a deliberate architecture change.
- Do not host persistent multiplayer WebSocket state in Next.js API routes, serverless functions, or edge functions.
- Do not introduce a cross-service dependency that breaks independent builds or deployments.

---

## 6. Game Engine Rules

- `countdown-server/src/game/gameEngine.ts` is authoritative for multiplayer validation and scoring.
- `lib/gameEngine.ts` supports client-side solo practice and training.
- The two files are not identical and must not be assumed to be interchangeable.

When modifying game rules:

1. Identify which game modes the change affects.
2. Inspect both engine implementations.
3. Keep shared product rules consistent where applicable.
4. Preserve intentional differences between client-side practice and server-authoritative multiplayer.
5. Update relevant tests for every affected behavior.
6. Explain any intentional divergence in the completion summary.

Ask the user when the desired gameplay behavior is ambiguous, rather than inventing a product decision.

The scoring table in `README.md` under "Round Scoring" represents a product decision. Do not change it simply because an alternative seems mathematically or architecturally preferable.

When changing scoring, timers, answer validation, target generation, or solver behavior, consider edge cases such as:

- Exact target hits.
- Multiple solutions with different operation sequences.
- Invalid or reused tiles.
- Non-exact division and non-positive subtraction.
- Ties and near-target outcomes.
- Timer expiration and simultaneous submissions.
- Client/server differences in validation.
- Best-solution generation and display in practice mode.

Only apply cases relevant to the task, and derive expected behavior from the current rules and tests.

---

## 7. Frontend Conventions

### Design system

Follow the existing "Countdown Kinetic" design:

- Dark slate background: `#0F172A`.
- Cyan accents.
- Glass-style cards.
- Pill-shaped operator buttons.

Use existing Tailwind tokens from `tailwind.config.ts` and existing component patterns. Do not invent new colors or introduce a new design system without approval.

### Component and state organization

- Keep reusable socket behavior and timer logic in the established context and hooks.
- Avoid duplicating event listeners or intervals across frequently re-rendering components.
- Clean up event listeners and timers according to the existing lifecycle patterns.
- Preserve loading, error, empty, and reconnect states when changing relevant UI.
- Keep responsive behavior and keyboard accessibility in mind when modifying forms, modals, and interactive game controls.

### Usernames

- Usernames must be 3–20 characters: letters (either case), numbers, and underscore (`[A-Za-z0-9_]`), subject to the current validation rules.
- The player's capitalization is kept for display (`Jenel_29` stays `Jenel_29`).
- Username uniqueness is case-insensitive (unique index on `lower(username)`).
- Usernames cannot be changed once set. Do not build a rename feature without user approval. A database trigger is intended to enforce this; confirm it exists before relying on it.
- Reserved usernames are checked through `RESERVED_USERNAMES`. This check currently runs only in the web app, so the database does not reject reserved names on its own.
- Accounts created with a username get a synthetic `@players.countdown.app` email. Accounts with a real email (for example Google sign-in) must pick a username on `/choose-username` before reaching protected pages.
- Display names come from `displayName()` in `lib/auth/username.ts` (username first, email prefix as a fallback). Do not show a player's email to other players.
- Use the existing `validateUsername` and `claimUsername` utilities rather than duplicating validation or claiming logic.
- Inspect their current behavior before changing username-related features.

---

## 8. Things You Must Not Do

### Secrets and environment

- Never print, expose, copy into chat, or commit the contents of `.env`, `.env.local`, or `countdown-server/.env`.
- Never place `SUPABASE_SERVICE_ROLE_KEY` in the Next.js application or any `NEXT_PUBLIC_*` variable.
- Keep service-role credentials exclusively on the trusted server side.
- Never hardcode real credentials into source code, tests, documentation, or examples.
- Use placeholders such as `<your-anon-key>` in documentation.
- Do not modify deployment secrets or production environment settings without explicit user approval.
- Do not disable security checks to make a local integration work.

### Architecture and dependencies

- Do not introduce new state-management libraries, ORMs, RPC frameworks, UI kits, or other dependencies without a clear need and user approval.
- Examples of dependencies not to add by default include Redux, Zustand, Prisma, tRPC, MUI, and shadcn/ui.
- Prefer existing utilities and dependencies when they meet the requirement.
- Do not move authoritative multiplayer state into the client or persist live room state in Postgres merely for convenience.
- Do not move durable match results into the client.
- Do not undertake unrelated large refactors while implementing a focused feature.

### Scope

Do not implement the following out-of-scope features unless explicitly requested:

- Chat.
- Spectator mode.
- Tournaments.
- Four-player free-for-all.
- Avatars.
- Sound packs.

Refer to `countdown-server/SCOPE.md` and verify its current contents before making scope decisions.

Keep changes focused on the requested task. Modify all files necessary to implement the feature correctly, including types, tests, and documentation. Avoid unrelated refactors or broad rewrites.

Before a cross-cutting change, outline the affected areas and implementation plan.

### Database security and migrations

- Never loosen RLS, grants, or `SECURITY DEFINER` functions to make a feature work without a proper security review and explicit user approval.
- Never run destructive SQL such as `DROP`, `TRUNCATE`, or an unrestricted `DELETE`.
- Never reset a Supabase database or modify production data without explicit user approval.
- Inspect existing schema, RLS policies, grants, and RPC implementations before proposing database changes. The repository has no migration files, so the live Supabase project is the source of truth for the schema. You cannot see it: ask the user for table definitions, policies, and function bodies instead of guessing.
- Give schema changes as additive, forward-only SQL that is safe to re-run (`if not exists`, `create or replace`). Never rewrite SQL the user may already have applied.
- Save every SQL change you give the user in the repository (for example under `docs/`) so the schema history is not lost, and say which statements the user still has to run by hand.
- Test database changes in a local or disposable environment when available.
- Explain potential data-integrity implications and rollback considerations for schema or RPC changes.
- Do not assume a migration is safe to run against production merely because it succeeds locally.
- Do not change the `finish_match` signature or behavior without updating its relevant tests, including `countdown-server/test/db/finish_match.db.test.ts` if that path still exists.

### Git and version control

- Do not commit, push, force-push, rebase, or delete branches unless the user explicitly asks.
- Work on feature branches where appropriate; do not commit directly to `main`.
- Never overwrite or discard the user's uncommitted changes.
- Inspect `git status` before making changes that could affect existing work.
- Do not commit `tsconfig.tsbuildinfo`, `.next/`, `dist/`, or `node_modules/`.
- Do not add secrets or local environment files to version control.

### Tests

- Never delete, skip, or weaken a failing test simply to make the suite pass.
- Do not add `.skip`, remove meaningful assertions, or replace specific assertions with overly permissive checks without a justified reason and explicit user approval.
- Investigate whether a failure indicates a code defect, an outdated test, or an environmental problem.
- Update test expectations when product behavior intentionally changes, but preserve assertions for the actual invariants that matter.
- Do not mark work complete if required tests were not run. Report unexecuted checks clearly.

### Troubleshooting

If the same proposed fix fails twice consecutively:

1. Stop repeating the same approach.
2. Summarize the observed failure and the likely root cause.
3. Explain what evidence supports that diagnosis and what remains uncertain.
4. Ask the user before trying a third approach.

Do not invent design values. Use existing tokens and established product decisions, or ask the user when the required decision cannot be inferred safely.

---

## 9. Database Migration and Production Safety

For any task involving schema changes, database policies, RPC functions, or production data:

1. Inspect the current implementation first. There are no migration files in the repository, so ask the user for the live schema, policies, and function definitions that the change touches.
2. Identify which environments the change affects.
3. Determine whether the change is backward-compatible with currently deployed web and game-server versions.
4. Prefer additive changes that allow a safe deployment sequence.
5. Test the SQL and affected queries or RPCs in a local or disposable environment when available. Do not run SQL against the live Supabase project yourself. Hand the statements to the user to run, and record them in the repository.
6. Consider concurrent operations, retries, duplicate calls, and partial failure.
7. Explain any manual deployment or migration step that requires user action.

Never apply a migration to production, reset a database, or delete persistent data without explicit user approval.

If a migration cannot be tested, state that limitation rather than presenting it as verified.

---

## 10. Working With AI Coding Tools

Use the following workflow for substantial tasks.

### Step 1: Inspect

- Read this file and any relevant project-specific instructions.
- Inspect the existing implementation, call sites, types, tests, and documentation.
- Check `git status` and preserve uncommitted work.
- Identify the source of truth for the behavior being changed.

### Step 2: Plan

For a small, localized change, proceed with a concise plan.

For a cross-cutting change, explain:

- Which components or services are affected.
- Which contracts, database structures, or APIs may change.
- Which tests need to be added or updated.
- Which risks or unresolved product decisions require user input.

Ask before proceeding when the task requires an ambiguous product decision, a security trade-off, a destructive action, or an architecture change outside the user's request.

### Step 3: Implement

- Make the smallest complete change that correctly implements the requested behavior.
- Include all necessary types, tests, and documentation.
- Follow existing code style and patterns.
- Avoid unrelated refactors and unnecessary dependencies.
- Preserve established gameplay, security, and data-integrity invariants.

### Step 4: Verify

- Run the relevant tests and build checks.
- Inspect the final diff for accidental changes and unsafe shortcuts.
- Test important edge cases relevant to the feature.
- Verify client/server contract synchronization if socket types or events changed.
- Verify database and profile behavior if authentication or persistence changed.

### Step 5: Report

Summarize:

- What changed and why.
- Which files were modified.
- Which tests and checks were run and their results.
- What was not tested and why.
- Any assumptions, known limitations, or remaining risks.
- Whether `README.md`, `docs/`, `SCOPE.md`, or other documentation should be updated.

Do not claim behavior has been verified unless the relevant checks or observations support that claim.

---

## 11. Before Finishing a Task

Use this checklist, applying the items relevant to the change:

- [ ] The implementation matches the requested behavior and existing product rules.
- [ ] The socket contract remains synchronized across the client and server where applicable.
- [ ] The server remains authoritative for multiplayer identity, validation, scoring, and match completion.
- [ ] No secret, service-role credential, or unsafe environment setting was exposed.
- [ ] Database permissions, RLS, grants, and RPC invariants remain intact.
- [ ] Relevant tests and build checks were run, and their results are accurately reported.
- [ ] Important edge cases and failure paths were considered.
- [ ] The final diff contains no unrelated changes or accidental generated files.
- [ ] New dependencies, architecture changes, and scope expansions were avoided unless approved.
- [ ] Relevant documentation updates have been made, or the required follow-up has been identified.
- [ ] Any unresolved failures, assumptions, or limitations are explicitly reported.

The goal is not merely to produce code quickly. The goal is to make focused, understandable, testable changes that preserve the integrity of Countdown Math Arena.
