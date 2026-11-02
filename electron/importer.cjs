// Import des exports CSV d'autres gestionnaires : Chrome / Edge, Firefox, Bitwarden, KeePassXC, KeePass 2.
// Chaque ligne devient une entrée prête pour Vault.saveEntry ({ type, title, favorite, fields, tags, custom }).
const { parseTotp } = require('./totp.cjs');
const { siteName, looksLikeHost } = require('../shared/sitename.mjs');

// CSV (RFC 4180) : guillemets, guillemets doublés, retours à la ligne dans les champs
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

// Clé 2FA illisible : on l'abandonne plutôt que l'élément entier
const okTotp = (v) => {
  if (!v) return '';
  try { parseTotp(v); return v; } catch { return ''; }
};

// Nom de l'élément : celui de l'export, sauf s'il n'est qu'une adresse (Chrome, Edge : « accounts.epicgames.com »),
// remplacée par le nom du site (« Epic Games »)
function titleOf(title, url) {
  const t = (title || '').trim();
  if (t && !looksLikeHost(t)) return t;
  return siteName(url) || siteName(t) || t;
}

function login({ title, username, password, url, notes, totp, tags, favorite, custom }) {
  return {
    type: 'login',
    title: titleOf(title, url) || (username || 'Sans nom').trim(),
    favorite: !!favorite,
    fields: { username: username || '', password: password || '', url: url || '', notes: notes || '', totp: okTotp(totp) },
    tags: tags || [],
    custom: custom || [],
  };
}

// Champs personnalisés de Bitwarden : « nom: valeur » par ligne
const bitwardenFields = (text) => (text || '').split(/\r?\n/).map((line) => {
  const i = line.indexOf(': ');
  return i > 0 ? { label: line.slice(0, i), value: line.slice(i + 2), secret: false } : null;
}).filter(Boolean);

// Groupe KeePass (« Racine/Internet/Banques ») : son dernier niveau devient une étiquette
const groupTag = (g) => {
  const last = (g || '').split('/').map((x) => x.trim()).filter(Boolean).at(-1);
  return last && !/^(root|racine)$/i.test(last) ? [last] : [];
};

const FORMATS = [
  {
    id: 'bitwarden', label: 'Bitwarden',
    test: (h) => h.includes('login_password') || h.includes('login_username'),
    map: (r) => (r.type === 'note'
      ? { type: 'note', title: r.name || 'Note', favorite: r.favorite === '1', fields: { content: r.notes || '' }, tags: r.folder ? [r.folder] : [], custom: bitwardenFields(r.fields) }
      : r.type && r.type !== 'login' ? null
        : login({
          title: r.name, username: r.login_username, password: r.login_password, url: (r.login_uri || '').split(',')[0],
          notes: r.notes, totp: r.login_totp, tags: r.folder ? [r.folder] : [], favorite: r.favorite === '1', custom: bitwardenFields(r.fields),
        })),
  },
  {
    id: 'keepassxc', label: 'KeePassXC',
    test: (h) => h.includes('group') && h.includes('title') && h.includes('password'),
    map: (r) => login({ title: r.title, username: r.username, password: r.password, url: r.url, notes: r.notes, totp: r.totp, tags: groupTag(r.group) }),
  },
  {
    id: 'keepass', label: 'KeePass',
    test: (h) => h.includes('account') && h.includes('login name'),
    map: (r) => login({ title: r.account, username: r['login name'], password: r.password, url: r['web site'], notes: r.comments }),
  },
  {
    id: 'firefox', label: 'Firefox',
    test: (h) => h.includes('httprealm') || (h.includes('url') && h.includes('guid')),
    map: (r) => login({ username: r.username, password: r.password, url: r.url }),
  },
  {
    id: 'chrome', label: 'Chrome / Edge',
    test: (h) => h.includes('name') && h.includes('url') && h.includes('username') && h.includes('password'),
    map: (r) => login({ title: r.name, username: r.username, password: r.password, url: r.url, notes: r.note }),
  },
  {
    // Autre gestionnaire : colonnes reconnues par leur nom
    id: 'generic', label: 'CSV',
    test: (h) => h.includes('password') || h.includes('mot de passe'),
    map: (r) => login({
      title: r.title || r.name || r.nom || r.titre,
      username: r.username || r.login || r.user || r.email || r.identifiant,
      password: r.password || r['mot de passe'],
      url: r.url || r.website || r['web site'] || r.site,
      notes: r.notes || r.note || r.comments,
      totp: r.totp || r.otp,
    }),
  },
];

// → { format, entries } ; lève une erreur si le fichier n'est pas reconnu
function readCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('Ce fichier ne contient aucun élément.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const format = FORMATS.find((f) => f.test(header));
  if (!format) throw new Error("Format non reconnu : exportez vos mots de passe en CSV depuis Chrome, Edge, Firefox, Bitwarden ou KeePass.");
  const entries = [];
  for (const cells of rows.slice(1)) {
    const r = Object.fromEntries(header.map((h, i) => [h, (cells[i] || '').trim()]));
    const e = format.map(r);
    if (e && (e.type !== 'login' || e.fields.password || e.fields.username || e.fields.url)) entries.push(e);
  }
  return { format: { id: format.id, label: format.label }, entries };
}

module.exports = { readCsv, parseCsv };
