/**
 * The Countdown Arena mark (public/logo.svg): a timer ring with a lightning bolt.
 * One place to size it, so every screen shows the same logo.
 *
 * Plain <img> on purpose: it is a small static SVG, and the app does not use
 * next/image (the optimizer is turned off in next.config.js).
 */
interface LogoProps {
  /** Width and height in px. Keep it a square. */
  size?: number;
  className?: string;
  /** Set when the logo stands alone; leave empty when the app name is written next to it. */
  alt?: string;
}

export default function Logo({ size = 32, className = '', alt = '' }: LogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.svg"
      width={size}
      height={size}
      alt={alt}
      className={`shrink-0 select-none ${className}`}
      draggable={false}
    />
  );
}
