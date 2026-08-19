'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';

export default function LobbyPage() {
  const router = useRouter();
  const [largeCount, setLargeCount] = useState(2);
  const [copied, setCopied] = useState(false);
  const challengeLink = 'cntdn.gg/c/x9f2k';

  const copyLink = async () => {
    await navigator.clipboard.writeText(challengeLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleQuickMatch = () => {
    router.push('/game');
  };

  return (
    <div className="bg-background text-on-background font-body-md min-h-screen flex flex-col selection:bg-primary-container selection:text-on-primary-container">
      <Navbar />

      {/* Main Content Grid */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-container-margin py-stack-lg grid grid-cols-12 gap-stack-lg items-start">
        
        {/* Left Column: Profile & Stats */}
        <section className="col-span-12 md:col-span-4 flex flex-col gap-stack-lg">
          <div className="glass-panel rounded-xl p-stack-lg flex flex-col items-center text-center gap-stack-md relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-primary-container/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <img
              alt="User123 Avatar"
              className="w-32 h-32 rounded-full border-2 border-primary-container object-cover mb-2"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDv8oDesXLp1UIJV2DIeJWgDv1n4zvKk7w44ohmHuPw6X8flTD44Ruhn_gBkN91yZvtfk4y0Rnd3IC-hS8ObYF1-f2a8asAE2ygLh3pvBtct3RvpWtuJqrTRiuMsfkpgZT_YEOoiHM-b-pQiaOjHa3ZS83enjOl-_CQxHCq1NaUsgQS1qXBpEdNIPDGxXd4sY4J8Vgr4ruklhwJE6mhkPvw7mgos5X6g2Jnn5KSjyY6m9630jXuhXGUHg"
            />
            <div>
              <h1 className="font-headline-lg text-headline-lg text-primary">User123</h1>
              <span className="font-label-caps text-label-caps text-on-surface-variant mt-1 inline-block px-3 py-1 bg-surface-container rounded-full">Grandmaster</span>
            </div>
            <div className="w-full grid grid-cols-3 gap-base mt-4 pt-4 border-t border-outline-variant/15">
              <div className="flex flex-col items-center">
                <span className="font-label-caps text-label-caps text-on-surface-variant">Wins</span>
                <span className="font-mono-metric text-mono-metric text-primary-fixed-dim mt-1">24</span>
              </div>
              <div className="flex flex-col items-center border-l border-r border-outline-variant/15">
                <span className="font-label-caps text-label-caps text-on-surface-variant">Losses</span>
                <span className="font-mono-metric text-mono-metric text-on-background mt-1">10</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="font-label-caps text-label-caps text-on-surface-variant">Avg Time</span>
                <span className="font-mono-metric text-mono-metric text-primary-fixed-dim mt-1">16.2s</span>
              </div>
            </div>
          </div>
        </section>

        {/* Right Column: Config & Actions */}
        <section className="col-span-12 md:col-span-8 flex flex-col gap-stack-lg">
          {/* Game Mode Config */}
          <div className="glass-panel rounded-xl p-stack-lg">
            <div className="flex items-center gap-base mb-stack-md">
              <span className="material-symbols-outlined text-primary-fixed-dim">tune</span>
              <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-background">Game Configuration</h2>
            </div>
            <div className="bg-surface-container-low rounded-lg p-stack-md border border-outline-variant/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-stack-md">
              <div>
                <h3 className="font-body-md text-body-md text-on-background mb-1">Large Numbers</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant">Select how many large numbers (25, 50, 75, 100) are in the pool.</p>
              </div>
              <div className="flex items-center bg-background rounded-full border border-outline-variant/30 p-1">
                <button
                  onClick={() => setLargeCount((c) => Math.max(0, c - 1))}
                  className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-variant/30 transition-colors"
                >
                  <span className="material-symbols-outlined">remove</span>
                </button>
                <span className="font-mono-metric text-mono-metric text-primary-fixed-dim w-12 text-center">{largeCount}</span>
                <button
                  onClick={() => setLargeCount((c) => Math.min(4, c + 1))}
                  className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-variant/30 transition-colors"
                >
                  <span className="material-symbols-outlined">add</span>
                </button>
              </div>
            </div>
          </div>

          {/* CTAs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-stack-lg">
            {/* Create Challenge */}
            <div className="glass-panel rounded-xl p-stack-lg flex flex-col gap-stack-md hover:-translate-y-1 transition-transform duration-300">
              <div className="w-12 h-12 rounded-full bg-secondary-container/20 flex items-center justify-center text-secondary mb-2">
                <span className="material-symbols-outlined">share</span>
              </div>
              <h3 className="font-headline-lg-mobile text-headline-lg-mobile text-primary-fixed-dim">Create Challenge Link</h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant flex-1">Generate a unique link to challenge your friends directly.</p>
              <div className="flex items-center mt-4">
                <div className="bg-background border border-outline-variant/30 rounded-l-lg py-2 px-3 font-mono-metric text-mono-metric text-on-surface-variant flex-1 truncate text-sm">
                  {challengeLink}
                </div>
                <button
                  onClick={copyLink}
                  className="bg-[#0A192F] border border-[#2962FF] border-l-0 text-[#00E5FF] px-4 py-2 rounded-r-lg font-label-caps text-label-caps hover:bg-[#2962FF]/10 transition-colors h-[38px] flex items-center justify-center"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Quick Match */}
            <button
              onClick={handleQuickMatch}
              className="glass-panel rounded-xl p-stack-lg flex flex-col items-center justify-center text-center gap-stack-md group hover:border-[#00E5FF] transition-colors duration-300 relative overflow-hidden text-left"
            >
              <div className="absolute inset-0 bg-gradient-to-t from-[#2962FF]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <div className="w-16 h-16 rounded-full bg-[#00E5FF]/10 flex items-center justify-center text-[#00E5FF] mb-2 group-hover:scale-110 transition-transform duration-300 shadow-[0_0_15px_rgba(0,229,255,0.3)]">
                <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>flash_on</span>
              </div>
              <h3 className="font-headline-lg-mobile text-headline-lg-mobile text-on-background group-hover:text-[#00E5FF] transition-colors">Quick Match</h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant">Find an opponent instantly based on your rating.</p>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
