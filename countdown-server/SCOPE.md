# MVP Scope & Feature Lock: Number Countdown Game

## 1. Core Target & Objective
Build and deploy a secure, real-time, 1v1 multiplayer arithmetic game where two players compete to reach a target number using basic arithmetic operations within a 30-second time limit.

---

## 2. In-Scope MVP Features (Must Have for Release)

### A. Authentication & User Profile
- [ ] User Sign Up & Sign In via Supabase Auth (Email or Guest).
- [ ] Profile record automatically created in PostgreSQL upon registration.
- [ ] User profile displays total wins, total losses, and current Elo rating.

### B. Lobby & Room Management
- [ ] Create a 1v1 private or public game lobby with a generated Room Code.
- [ ] Join an existing lobby using a Room Code.
- [ ] In-memory state tracking (`RoomManager`) for player readiness and status.
- [ ] Basic reconnection handling (resuming match state using `userId` upon socket drop).

### C. Real-Time Core Gameplay Loop
- [ ] Server generates valid target numbers and random number tiles.
- [ ] 30-second synchronized countdown timer managed entirely by server RAM.
- [ ] Player solution submission and validation (`GameEngine.validateSubmission`).
- [ ] Immediate round evaluation: check closeness to target if exact match isn't found.

### D. Game Completion & Persistence
- [ ] Server acts as referee via `adminClient` to commit final match scores to Supabase.
- [ ] Automatic Elo rating updates for winner and loser post-match.
- [ ] Safe room cleanup in server RAM upon match completion (`removeRoom`).

---

## 3. Out-of-Scope Features (Cut for Initial Release)
*These features are explicitly postponed until POST-MVP release to guarantee shipping within schedule:*

- ❌ In-game text or voice chat.
- ❌ Custom cosmetic avatars or sound packs.
- ❌ Tournaments / 4-player free-for-all modes.
- ❌ Spectator mode.

---

## 4. Technical Learning & Implementation Checklist

To complete this MVP, the following technical items must be implemented and tested:

- [ ] **Unit Testing:** Write unit tests for `GameEngine.ts` logic using Vitest/Jest (validate submissions, scoring calculation).
- [ ] **Type Safety:** Ensure all Socket.io events strictly implement contract interfaces in `events.ts`.
- [ ] **Environment Verification:** Maintain clean `.env.example` and zero secrets in Git history.
- [ ] **Deployment:** Host Next.js frontend on Vercel and Express server on Render/Fly.io.