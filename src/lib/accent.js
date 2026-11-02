// Couleur d'accent de l'interface : thèmes prêts à l'emploi ou couleur libre.
// Le dégradé (boutons, logo) va de la couleur principale à une couleur secondaire.

export const ACCENTS = [
  { id: 'violet', name: 'Violet', main: '#7c5cff', second: '#3ec5f0' },
  { id: 'bleu', name: 'Bleu', main: '#3b82f6', second: '#22d3ee' },
  { id: 'cyan', name: 'Cyan', main: '#06b6d4', second: '#34d399' },
  { id: 'emeraude', name: 'Émeraude', main: '#10b981', second: '#a3e635' },
  { id: 'or', name: 'Or', main: '#eab308', second: '#f97316' },
  { id: 'orange', name: 'Orange', main: '#f97316', second: '#facc15' },
  { id: 'rouge', name: 'Rouge', main: '#ef4444', second: '#f97316' },
  { id: 'rose', name: 'Rose', main: '#ec4899', second: '#8b5cf6' },
];
export const DEFAULT_ACCENT = ACCENTS[0];

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// Couleur secondaire d'une couleur libre : même saturation, teinte décalée de 40°
export function deriveSecond(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + 40 + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255);
}

// Luminance relative (WCAG) : texte foncé sur un accent très clair, blanc sinon
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function resolveAccent(setting) {
  if (setting?.main) return { main: setting.main, second: setting.second || deriveSecond(setting.main) };
  return DEFAULT_ACCENT;
}

export function applyAccent(setting) {
  const { main, second } = resolveAccent(setting);
  const root = document.documentElement.style;
  root.setProperty('--accent', main);
  root.setProperty('--accent-2', second);
  root.setProperty('--accent-rgb', hexToRgb(main).join(', '));
  // Contraste du texte sur le dégradé : on vérifie les deux extrémités
  root.setProperty('--on-accent', Math.max(luminance(main), luminance(second)) > 0.45 ? '#0b0c12' : '#ffffff');
}
