# Countdown Math Arena

A real-time, competitive multiplayer mathematics combat game built with **Next.js**, **Socket.io**, **Supabase**, **PostgreSQL**, and **Docker**. Designed for seamless low-latency matchmaking, rapid arithmetic duels, and an immersive dark/minimalist developer aesthetic.

---

## 🚀 Key Features

* **Real-Time Multiplayer Duels**: Powered by a dedicated custom WebSocket server (Socket.io) handling synchronized match states, room lobbies, and real-time score updates.


* **Robust Game Engine**: Built with a dedicated server-side architecture to validate round progression, score calculation, and win-state triggers securely.


* **Secure Authentication & Database**: Integrates Supabase with PostgreSQL for user profile management, session handling, and persistent data integrity.


* **Modern Minimalist UI**: Styled using Tailwind CSS with a professional dark/minimal theme, custom status badges, and responsive layouts.



---

## 🛠️ Tech Stack

* **Frontend**: Next.js, React, Tailwind CSS, TypeScript
* **Backend**: Node.js, Express, Socket.io (Custom WebSocket Game Server)
* **Database & Auth**: Supabase, PostgreSQL
* **Infrastructure & Testing**: Docker, Vitest

---

## 📁 Project Structure

```text
countdown-math-arena/
├── app/                  # Next.js app router pages (Lobby, Match, Training)
├── components/           # Reusable UI components (Modals, Navbar, Badges)
├── context/              # React Context providers for WebSocket state
├── countdown-server/     # Standalone Node.js + Socket.io game engine
├── supabase/             # Database schemas and configuration
└── public/               # Static assets

```

---

## ⚙️ Getting Started Locally

### Prerequisites

* Node.js (v18+)
* npm, yarn, or pnpm
* A Supabase account and project instance

### 1. Clone & Install Dependencies

Clone the repository and install dependencies for both the frontend and the standalone game server:

```bash
# Install frontend dependencies
npm install

# Install server dependencies
cd countdown-server
npm install
cd ..

```

### 2. Configure Environment Variables

Create local environment files based on the provided examples:

* **Frontend (`.env.local`)**:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000

```


* **Server (`countdown-server/.env`)**:
```env
PORT=4000
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

```



### 3. Run the Application

Start the WebSocket game server first:

```bash
cd countdown-server
npm run dev

```

In a separate terminal window, start the Next.js development client:

```bash
npm run dev

```

Open [http://localhost:3000](http://localhost:3000) in your browser to play.

---

## 🧪 Running Tests

The backend includes integration and database test suites powered by Vitest:

```bash
cd countdown-server
npm test

```

---

## 🚢 Deployment

To deploy this project to production:

1. Deploy the Next.js frontend to a platform like Vercel or Netlify.
2. Deploy the `countdown-server` directory as a persistent Node.js web service on Render, Railway, or via Docker containers.
3. Update your production environment variables (`NEXT_PUBLIC_SOCKET_URL`) to point to your live backend domain.
