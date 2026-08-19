import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Countdown Math Arena — 1v1 Tactical Duel',
  description: 'High-stakes 1v1 competitive number game. Race to hit the target with six tiles and four operators.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-[#0f1417] text-[#dfe3e7] antialiased">
        {children}
      </body>
    </html>
  )
}
