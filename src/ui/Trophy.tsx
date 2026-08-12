/**
 * The cup on the end-of-game screens. Shared by the online end screen and the
 * pass-and-play one so a win looks the same however the game was played.
 */
export default function Trophy({ width = 140, height = 150 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 230 250" aria-hidden="true">
      <defs>
        <linearGradient id="ui-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe98a" />
          <stop offset=".45" stopColor="#ffc22e" />
          <stop offset="1" stopColor="#e08c05" />
        </linearGradient>
      </defs>
      <path
        d="M60 30h110v52c0 34-24 60-55 60S60 116 60 82z"
        fill="url(#ui-gold)"
        stroke="#c47a05"
        strokeWidth="4"
      />
      <path
        d="M60 44H36c-6 0-10 5-9 11 4 26 20 40 40 43"
        fill="none"
        stroke="url(#ui-gold)"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <path
        d="M170 44h24c6 0 10 5 9 11-4 26-20 40-40 43"
        fill="none"
        stroke="url(#ui-gold)"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <rect x="104" y="140" width="22" height="34" fill="url(#ui-gold)" />
      <rect x="76" y="174" width="78" height="16" rx="6" fill="url(#ui-gold)" />
      <rect x="62" y="190" width="106" height="22" rx="8" fill="#e8a010" />
      <path d="M115 56l10 21 23 3-17 16 4 23-20-11-20 11 4-23-17-16 23-3z" fill="#fff3c4" />
    </svg>
  );
}
