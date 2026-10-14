import Link from 'next/link';
import type { ReactNode } from 'react';
import Navbar from '@/components/Navbar';
import { LEGAL_LAST_UPDATED } from '@/lib/legal';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

interface LegalPageLayoutProps {
  title: string;
  intro: string;
  sections: LegalSection[];
}

export default function LegalPageLayout({ title, intro, sections }: LegalPageLayoutProps) {
  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col font-body-md relative overflow-x-hidden selection:bg-primary-container/30 selection:text-primary-fixed">
      <Navbar />

      <main className="flex-grow px-gutter md:px-container-margin py-16 relative z-10">
        <article className="glass-card rounded-xl p-8 md:p-12 w-full max-w-3xl mx-auto shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-secondary-container via-primary-container to-secondary-container"></div>

          <Link
            href="/register"
            className="inline-flex items-center gap-1 text-primary-container hover:text-primary-fixed text-sm mb-6 transition-colors"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Back to registration
          </Link>

          <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold mb-2">{title}</h1>
          <p className="text-xs font-mono text-on-surface-variant mb-6">Last updated: {LEGAL_LAST_UPDATED}</p>

          <p className="text-on-surface-variant mb-8">{intro}</p>

          <nav aria-label="Table of contents" className="mb-10">
            <ol className="list-decimal list-inside space-y-1 text-sm">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-primary-container hover:text-primary-fixed transition-colors">
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="space-y-8">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} className="scroll-mt-24">
                <h2 className="font-headline-md text-xl text-on-surface font-semibold mb-3">
                  {i + 1}. {s.title}
                </h2>
                <div className="text-on-surface-variant space-y-3 text-sm leading-relaxed">{s.body}</div>
              </section>
            ))}
          </div>
        </article>
      </main>
    </div>
  );
}
