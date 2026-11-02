// Générateur de mots de passe et de phrases de passe (aléatoire cryptographique) et estimation de la robustesse.
import { WORDS } from './words-fr.js';

// Sans caractères ambigus (l, I, O, 0, 1) pour qu'un mot de passe se recopie sans erreur
const SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digits: '23456789',
  symbols: '!@#$%&*+-=?_',
};

// Entier uniforme dans [0, n) : on rejette les tirages qui biaiseraient le modulo
function randomInt(n) {
  const max = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= max);
  return buf[0] % n;
}

export function generatePassword({ length = 20, upper = true, digits = true, symbols = true } = {}) {
  const sets = [SETS.lower, upper && SETS.upper, digits && SETS.digits, symbols && SETS.symbols].filter(Boolean);
  const all = sets.join('');
  const pick = (chars) => chars[randomInt(chars.length)];
  // Au moins un caractère de chaque famille choisie, puis mélange
  const out = sets.map(pick);
  while (out.length < length) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

// Phrase de passe : mots français tirés au hasard (plus facile à taper et à retenir qu'une suite de caractères)
export function generatePassphrase({ words = 6, separator = '-', capitalize = true, digit = true } = {}) {
  const out = Array.from({ length: words }, () => WORDS[randomInt(WORDS.length)])
    .map((w) => (capitalize ? w.charAt(0).toUpperCase() + w.slice(1) : w));
  if (digit) out[randomInt(out.length)] += String(randomInt(10));
  return out.join(separator);
}

// Entropie réelle d'une phrase de passe (la jauge, qui compte les caractères, la surestime)
export const passphraseBits = ({ words, digit }) => Math.floor(words * Math.log2(WORDS.length) + (digit ? Math.log2(10 * words) : 0));

export { strength } from '../../shared/strength.mjs';
