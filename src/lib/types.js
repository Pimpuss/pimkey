import { CreditCard, IdCard, KeyRound, StickyNote } from 'lucide-react';
import TYPES from '../../shared/types.json';
import { androidSite } from '../../shared/sitename.mjs';
import { expiryState } from '../../shared/expiry.mjs';

export { expiryState };

// Les types d'éléments et leurs champs sont décrits une seule fois, dans shared/types.json (lu aussi par le coffre)
export { TYPES };
export const TYPE_IDS = Object.keys(TYPES);
export const TYPE_ICONS = { login: KeyRound, identity: IdCard, card: CreditCard, note: StickyNote };

export function subtitle(e) {
  if (e.type === 'card') return e.hints.number ? `•••• ${e.hints.number}` : e.fields.holder || '';
  if (e.type === 'note') return (e.fields.content || '').split('\n')[0];
  return e.fields[TYPES[e.type].subtitle] || '';
}

export const EXPIRY_LABEL = { expired: 'Expiré', soon: 'Expire bientôt' };

export const formatDate = (d) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export const formatStamp = (ts) =>
  new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function domainOf(url) {
  const app = androidSite(url);
  if (app) return `${app} (appli Android)`;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
}

// Recherche : nom, champs visibles, étiquettes et champs personnalisés non masqués (jamais les secrets,
// que l'interface ne connaît pas)
export function matches(e, q) {
  if (!q) return true;
  const custom = (e.custom || []).flatMap((c) => [c.label, c.value || '']);
  const hay = [e.title, ...Object.values(e.fields), ...(e.tags || []), ...custom].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
