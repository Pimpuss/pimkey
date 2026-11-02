// Logo Pimkey (même dessin que build/logo.svg, utilisé pour l'icône Windows) : écu blanc sur fond sombre,
// trou de serrure à la couleur d'accent choisie
export default function Logo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <defs>
        <linearGradient id="pimkey-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#262c52" />
          <stop offset="1" stopColor="#0b0e1c" />
        </linearGradient>
        <linearGradient id="pimkey-shield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d9def5" />
        </linearGradient>
        <linearGradient id="pimkey-key" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#pimkey-tile)" />
      <rect x="6" y="6" width="500" height="500" rx="106" fill="none" stroke="#fff" strokeOpacity="0.08" strokeWidth="4" />
      <path
        d="M256 84 C298 106 344 116 384 118 Q398 119 398 133 L398 238 C398 330 340 394 256 432 C172 394 114 330 114 238 L114 133 Q114 119 128 118 C168 116 214 106 256 84 Z"
        fill="url(#pimkey-shield)"
      />
      <circle cx="256" cy="220" r="40" fill="url(#pimkey-key)" />
      <path d="M238 244 H274 L285 318 Q287 334 271 334 H241 Q225 334 227 318 Z" fill="url(#pimkey-key)" />
    </svg>
  );
}
