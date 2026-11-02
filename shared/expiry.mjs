// Fin de validité des documents et cartes, partagée par l'interface (alertes de la liste) et le processus
// principal (notifications Windows).

const DAY = 86400e3;

// Date d'un document (AAAA-MM-JJ) ou expiration d'une carte (MM/AA, fin du mois), en millisecondes ; null sinon
export function expiryTime(e) {
  if (e.fields.expiresAt) return new Date(`${e.fields.expiresAt}T23:59:59`).getTime();
  const m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(e.fields.expiry || '');
  if (!m) return null;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return new Date(year, Number(m[1]), 0, 23, 59, 59).getTime();
}

// 'expired', 'soon' (moins de 3 mois) ou null
export function expiryState(e, now = Date.now()) {
  const t = expiryTime(e);
  if (!t) return null;
  if (t < now) return 'expired';
  return t - now < 90 * DAY ? 'soon' : null;
}

// Jours restants (négatif une fois expiré)
export const daysLeft = (e, now = Date.now()) => Math.ceil((expiryTime(e) - now) / DAY);
