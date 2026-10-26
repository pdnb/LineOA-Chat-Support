import { useId } from 'react';

/** Hotline mark: a chat bubble with a flame on the brand-green tile. Keep in sync with app/icon.svg (favicon). */
export function Logo({ size = 32 }: { size?: number }) {
  const flame = useId();
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} role="img" aria-label="Hotline" style={{ flexShrink: 0, display: 'block' }}>
      <defs>
        <linearGradient id={flame} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb000" />
          <stop offset="1" stopColor="#ff4d1c" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path
        fill="#fff"
        d="M10 6.5h12a4.5 4.5 0 0 1 4.5 4.5v8a4.5 4.5 0 0 1-4.5 4.5h-8l-5.5 4.5v-4.7A4.5 4.5 0 0 1 5.5 19v-8A4.5 4.5 0 0 1 10 6.5z"
      />
      <path
        fill={`url(#${flame})`}
        d="M16.6 8.6c.9 2.4 4.1 3.9 4.1 7.9a4.7 4.7 0 0 1-9.4 0c0-2 1-3.4 2.1-4.4.2 1.3.8 2.2 1.7 2.6-.5-2.3.1-4.4 1.5-6.1z"
      />
      <path
        fill="#ffd84d"
        d="M16.1 14.6c.5 1.3 2.1 2 2.1 3.9a2.2 2.2 0 0 1-4.4 0c0-1 .5-1.7 1.1-2.2.1.6.4 1 .8 1.2-.2-1 0-2 .4-2.9z"
      />
    </svg>
  );
}
