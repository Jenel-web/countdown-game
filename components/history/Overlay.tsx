'use client';

import { useEffect, type ReactNode } from 'react';

interface OverlayProps {
  onClose: () => void;
  label: string;
  /** "sm" is the steps window that opens on top of the match window. */
  size?: 'md' | 'sm';
  /** Turn off when another window sits on top, so Esc only closes the top one. */
  escEnabled?: boolean;
  children: ReactNode;
}

/** Backdrop + dialog shell. Full screen on phones, centered card on larger screens. */
export default function Overlay({ onClose, label, size = 'md', escEnabled = true, children }: OverlayProps) {
  useEffect(() => {
    if (!escEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, escEnabled]);

  // Lock page scroll while a window is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center backdrop-blur-sm sm:p-6 ${
        size === 'sm' ? 'z-[70] bg-[#04070a]/85' : 'z-[60] bg-[#080c0e]/80'
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`flex h-full w-full flex-col overflow-hidden bg-surface-container-low shadow-[0_20px_60px_rgba(0,0,0,0.55)] sm:h-auto sm:max-h-full sm:rounded-2xl sm:border sm:border-outline-variant ${
          size === 'sm' ? 'sm:max-w-[680px]' : 'sm:max-w-[820px]'
        }`}
      >
        {children}
      </div>
    </div>
  );
}
