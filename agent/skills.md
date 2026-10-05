# Skills & Technical Guidelines — Countdown 1v1

## 1. Core Architecture & Tech Stack
- **Frontend UI:** Next.js (App Router), React, Tailwind CSS.
- **Database & Auth:** Supabase (`@supabase/supabase-js`).
- **Real-Time Backend:** Standalone Node.js + Socket.io server running separately from Next.js (hosted on Render/Railway).
- **Design Context:** Design assets, typography, and colors are provided via Google Stitch MCP (`@_davideast/stitch-mcp`).

## 2. React State & UI Performance Rules
- **Snapshot State:** Always manage tile selections, active mathematical operators (+, -, ×, ÷), calculation history, and local timer logic using React `useState` or `useReducer`.
- **Prevent Re-renders:** Do NOT place global interval timers or Socket listener bindings directly inside heavily re-rendering components. Keep WebSockets in a custom hook (`useSocket`).
- **UI Fidelity:** Strictly respect the design system extracted from Stitch (dark slate backgrounds `#0F172A`, cyan/glowing accents, pill-shaped operator buttons).

## 3. Game Engine Mechanics
- **Target Number:** Integer between $100$ and $999$.
- **Number Pool:** 6 tiles total, drawn based on chosen mode (0 to 4 Large numbers from `[25, 50, 75, 100]` and the remaining drawn from Small numbers `[1..10]`).
- **Solvability Engine:** Implement a recursive backtracking algorithm (`checkSolvability`) to determine if an exact target match exists.
- **Closest Wins Logic:** If the recursive solver determines `isSolvable === false`, calculate player scores based on absolute difference: `Math.abs(target - playerResult)`.

## 4. Backend & WebSockets
- NEVER attempt to run persistent WebSockets inside Next.js API routes or serverless edge functions.
- Keep the Socket server isolated to listen for room events: `JOIN_ROOM`, `GAME_START`, `SUBMIT_ANSWER`, and `GAME_OVER`.