// Robustesse d'un mot de passe, partagée par l'interface (jauge) et le coffre (audit).
// Module ES : importé par Vite côté interface, chargé par require() côté Electron (Node 22).

const COMMON = /^(?:123|azerty|qwerty|password|motdepasse|admin|bonjour|soleil|loulou)/i;

// Score de 0 (vide) à 4, d'après l'entropie : longueur × familles de caractères utilisées
export function strength(pw) {
  if (!pw) return { score: 0, label: '' };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  let bits = pw.length * Math.log2(pool || 1);
  if (/^(.)\1+$/.test(pw) || COMMON.test(pw)) bits = Math.min(bits, 20);
  const score = bits < 45 ? 1 : bits < 65 ? 2 : bits < 85 ? 3 : 4;
  return { score, label: ['', 'Faible', 'Moyen', 'Bon', 'Excellent'][score] };
}
