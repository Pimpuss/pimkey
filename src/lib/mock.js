// API factice pour l'aperçu dans un navigateur (npx vite) : coffre en mémoire, mot de passe maître « demo1234 ».
// Ajouter ?setup à l'adresse pour voir l'écran de création du coffre.
import TYPES from '../../shared/types.json';
import { strength } from '../../shared/strength.mjs';

const MASTER = 'demo1234';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const day = 86400e3;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);
const svgIcon = (body) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`)}`;
// Icônes de sites simplifiées pour l'aperçu
const SITE_ICONS = {
  'mail.google.com': svgIcon('<path d="M4 9v15h5V13l7 5 7-5v11h5V9l-3-2-9 6.5L7 7z" fill="#ea4335"/>'),
  'github.com': svgIcon('<circle cx="16" cy="16" r="14" fill="#181717"/><path d="M11 23c0-3 1-4 2-4.5-3-.5-5-2-5-6 0-1 .4-2 1-3-.2-.6-.4-2 .2-3 0 0 1.4 0 3 1.3a10 10 0 0 1 5.6 0C19.4 6.5 20.8 6.5 20.8 6.5c.6 1 .4 2.4.2 3 .6 1 1 2 1 3 0 4-2 5.5-5 6 1 .5 2 1.5 2 4.5" fill="#fff"/>'),
  'netflix.com': svgIcon('<path d="M9 3h5l4 13V3h5v26h-5L14 16v13H9z" fill="#e50914"/>'),
};

let master = MASTER;
let unlocked = false;
let exists = !location.search.includes('setup');
let settings = { autoLockMinutes: 5, clipboardSeconds: 30, lockOnMinimize: false, closeToTray: true, lockOnSystemLock: true, hideFromCapture: true, masterGraceMinutes: 1, siteIcons: true, expiryNotify: true, sortBy: 'name', backupKeep: 10, backupDir: null, browserExtension: true, syncAuto: true, accent: null };
let sync = { dir: null, at: null, error: null, needPassword: false };
let backups = { count: 3, last: Date.now() - 5 * 3600e3 };
const backupStatus = () => ({ dir: settings.backupDir || 'C:\\Users\\vous\\AppData\\Roaming\\Pimkey\\copies', custom: !!settings.backupDir, error: null, ...backups });
let entries = [
  { type: 'login', title: 'Gmail', favorite: true, tags: ['Perso'], fields: { username: 'camille.dupont@gmail.com', password: 'Tr0ub4dor&3', url: 'https://mail.google.com', totp: 'JBSWY3DPEHPK3PXP' } },
  {
    type: 'login', title: 'GitHub', tags: ['Travail'], fields: { username: 'pimpuss', password: 'gh-9f8e7d6c5b4a', url: 'github.com', notes: 'Clés de récupération dans la note « Codes 2FA ».' },
    history: { password: [{ value: 'github2024!', changedAt: Date.now() - 40 * day }, { value: 'pimpuss123', changedAt: Date.now() - 400 * day }] },
  },
  {
    type: 'login', title: 'Freebox', tags: ['Maison'], createdAt: Date.now() - 500 * day, fields: { username: 'admin', password: 'freebox-2026', url: 'http://mafreebox.freebox.fr' },
    custom: [{ id: 'c1', label: 'Adresse IP', value: '192.168.1.254', secret: false }, { id: 'c2', label: 'Code Wi-Fi invité', value: 'bienvenue2026', secret: true }],
  },
  { type: 'login', title: 'accounts.epicgames.com', fields: { username: 'camille', password: 'Fortnite-2026!', url: 'https://accounts.epicgames.com/login' } },
  { type: 'login', title: 'Impots.gouv', tags: ['Perso', 'Administratif'], fields: { username: '1234567890123', password: 'Tr0ub4dor&3', url: 'https://www.impots.gouv.fr' } },
  { type: 'identity', title: 'Carte d’identité', favorite: true, fields: { docType: "Carte d'identité", lastName: 'DUPONT', firstName: 'Camille', number: 'X4RTBPFW4', birthDate: '1990-04-12', issuedAt: '2021-06-02', expiresAt: iso(60), authority: 'Préfecture du Nord', country: 'France' } },
  { type: 'identity', title: 'Passeport', fields: { docType: 'Passeport', lastName: 'DUPONT', firstName: 'Camille', number: '21AB12345', expiresAt: iso(1400), country: 'France' } },
  { type: 'identity', title: 'Permis de conduire', fields: { docType: 'Permis de conduire', lastName: 'DUPONT', firstName: 'Camille', number: '19AA12345', issuedAt: '2009-09-15' } },
  { type: 'card', title: 'Visa Boursorama', fields: { holder: 'CAMILLE DUPONT', number: '4970 1012 3456 7890', expiry: '08/28', cvv: '123', pin: '4321', bank: 'Boursorama' } },
  { type: 'note', title: 'Codes Wi-Fi', fields: { content: 'Maison : FreeWifi_5G / correct-horse-battery\nInvités : bienvenue2026' } },
  { type: 'login', title: 'Ancien compte Fnac', deletedAt: Date.now() - 4 * day, fields: { username: 'camille.d', password: 'fnac-1234', url: 'fnac.com' } },
].map((e, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, favorite: false, createdAt: Date.now() - (i + 3) * day, updatedAt: Date.now() - i * day, attachments: [], tags: [], custom: [], ...e }));

const listeners = { locked: new Set(), entries: new Set(), show: new Set(), update: new Set(), pair: new Set(), sync: new Set() };

// Extension navigateur : un navigateur déjà appairé pour l'aperçu
let devices = [{ id: 'd1', name: 'Chrome', createdAt: Date.now() - 12 * 86400e3, usedAt: Date.now() - 3600e3 }];
const bridgeStatus = () => ({
  enabled: !!settings.browserExtension, listening: !!settings.browserExtension, error: null,
  browsers: { chrome: !!settings.browserExtension, edge: !!settings.browserExtension },
  devices, extensionDir: 'C:\\Users\\vous\\AppData\\Local\\Programs\\pimkey\\resources\\extension', extensionId: 'ngnafaoidpbokhboecpdjjgcopioaill',
});

function publicEntry(e) {
  const fields = {};
  const secrets = {};
  const hints = {};
  for (const f of TYPES[e.type].fields) {
    const v = e.fields[f.key];
    if (f.secret) {
      secrets[f.key] = !!v;
      if (v && f.hint === 'last4') hints[f.key] = v.replace(/\s/g, '').slice(-4);
    } else if (v) fields[f.key] = v;
  }
  const pw = e.type === 'login' && !e.deletedAt && e.fields.password;
  const same = pw ? entries.filter((x) => x.type === 'login' && !x.deletedAt && x.fields.password === pw) : [];
  const since = e.changedAt?.password || e.createdAt;
  const audit = pw ? {
    weak: strength(pw).score <= 1, reused: same.length > 1 ? entries.indexOf(same[0]) + 1 : 0, old: Date.now() - since > 365 * day, since,
    pwned: e.pwned ?? null, checkedAt: e.pwned != null ? Date.now() : null,
  } : null;
  const custom = (e.custom || []).map((c) => (c.secret ? { id: c.id, label: c.label, secret: true, has: !!c.value } : { ...c, has: !!c.value }));
  const history = Object.fromEntries(Object.entries(e.history || {}).map(([k, l]) => [k, l.map((h) => h.changedAt)]));
  const site = e.type === 'login' && e.fields.url && e.fields.url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return { ...e, deletedAt: e.deletedAt || null, fields, secrets, hints, custom, history, audit, icon: e.icon || (settings.siteIcons !== false && SITE_ICONS[site]) || null, customIcon: !!e.icon };
}

const list = () => entries.map(publicEntry);
const find = (id) => {
  const e = entries.find((x) => x.id === id);
  if (!e) throw new Error('Élément introuvable.');
  return e;
};
const field = (id, key) => (key.startsWith('custom:') ? find(id).custom.find((c) => c.id === key.slice(7))?.value : find(id).fields[key]) || '';
let masterOkAt = 0;
let helloOkAt = 0;
let helloOn = false;
const confirmMaster = async (pw) => {
  if (!pw) {
    const hello = Date.now() - helloOkAt < 30e3;
    helloOkAt = 0;
    if (hello) return;
    if (settings.masterGraceMinutes > 0 && Date.now() - masterOkAt < settings.masterGraceMinutes * 60e3) return;
    throw new Error('MASTER_REQUIRED');
  }
  await check(pw);
  masterOkAt = Date.now();
};
const check = async (password) => {
  await wait(350); // scrypt
  if (password !== master) throw new Error('Mot de passe maître incorrect.');
};

export function installMock() {
  window.pimkey = {
    vault: {
      status: async () => ({ exists, unlocked }),
      create: async (pw) => { if (pw.length < 8) throw new Error('Le mot de passe maître doit contenir au moins 8 caractères.'); await wait(350); master = pw; exists = true; unlocked = true; entries = []; return list(); },
      unlock: async (pw) => { await check(pw); unlocked = true; return list(); },
      unlockHello: async () => { await wait(700); unlocked = true; return list(); },
      lock: async () => { unlocked = false; masterOkAt = helloOkAt = 0; },
      changePassword: async (cur, next) => { await check(cur); master = next; },
    },
    entries: {
      list: async () => list(),
      save: async (input) => {
        const existing = input.id && find(input.id);
        const type = existing ? existing.type : input.type;
        if (!input.title?.trim()) throw new Error('Donnez un nom à cet élément.');
        const fields = {};
        for (const f of TYPES[type].fields) {
          const given = input.fields?.[f.key];
          if (f.secret && given === undefined) { if (existing?.fields[f.key]) fields[f.key] = existing.fields[f.key]; } else if (given) fields[f.key] = given;
        }
        const tags = input.tags ?? existing?.tags ?? [];
        const custom = (input.custom ?? existing?.custom ?? []).filter((c) => c.label || c.value).map((c) => {
          const old = existing?.custom.find((x) => x.id === c.id);
          return { id: old?.id || crypto.randomUUID(), label: c.label || 'Champ', secret: !!c.secret, value: c.value === undefined ? old?.value || '' : c.value };
        });
        if (existing && existing.fields.password && existing.fields.password !== fields.password) {
          existing.history = { password: [{ value: existing.fields.password, changedAt: Date.now() }, ...(existing.history?.password || [])] };
          existing.changedAt = { password: Date.now() };
          delete existing.pwned;
        }
        if (existing) Object.assign(existing, { title: input.title.trim(), favorite: !!input.favorite, fields, tags, custom, updatedAt: Date.now() });
        else entries.push({ id: crypto.randomUUID(), type, title: input.title.trim(), favorite: !!input.favorite, fields, tags, custom, createdAt: Date.now(), updatedAt: Date.now(), attachments: [] });
        return { id: existing ? existing.id : entries.at(-1).id, list: list() };
      },
      trash: async (id) => { find(id).deletedAt = Date.now(); return list(); },
      restore: async (id) => { delete find(id).deletedAt; return list(); },
      remove: async (id) => { entries = entries.filter((e) => e.id !== id); return list(); },
      emptyTrash: async () => { entries = entries.filter((e) => !e.deletedAt); return list(); },
      trashMany: async (ids) => { for (const id of ids) find(id).deletedAt = Date.now(); return list(); },
      restoreMany: async (ids) => { for (const id of ids) delete find(id).deletedAt; return list(); },
      duplicate: async (id) => {
        const e = find(id);
        const copy = { ...structuredClone(e), id: crypto.randomUUID(), title: `${e.title} (copie)`, favorite: false, createdAt: Date.now(), updatedAt: Date.now() };
        delete copy.history;
        entries.push(copy);
        return { id: copy.id, list: list() };
      },
      tidyTitles: async (dryRun) => {
        const hits = entries.filter((e) => e.type === 'login' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(e.title));
        if (dryRun) return { count: hits.length, examples: hits.slice(0, 3).map((e) => ({ from: e.title, to: 'Epic Games' })) };
        for (const e of hits) e.title = 'Epic Games';
        return { count: hits.length, list: list() };
      },
      removeMany: async (ids) => { entries = entries.filter((e) => !ids.includes(e.id)); return list(); },
      favorite: async (id, fav) => { find(id).favorite = fav; return list(); },
    },
    icon: {
      pick: async (id) => { find(id).icon = svgIcon('<rect width="32" height="32" rx="7" fill="#2563eb"/><path d="M9 22V10h6a4 4 0 0 1 0 8h-3v4z" fill="#fff"/>'); return list(); },
      fromUrl: async (id, url) => {
        if (!/\./.test(url)) throw new Error('Aucune image trouvée à cette adresse.');
        find(id).icon = svgIcon('<rect width="32" height="32" rx="7" fill="#e57000"/><path d="M8 10h4l4 6 4-6h4l-6 6 6 6h-4l-4-6-4 6H8l6-6z" fill="#fff"/>');
        return list();
      },
      paste: async () => { throw new Error("Le presse-papiers ne contient pas d'image."); },
      reset: async (id) => { delete find(id).icon; return list(); },
      refresh: async () => ({ found: false, list: list() }),
      lookup: async ({ url, name }) => {
        await wait(600);
        if (!url && !name) return null;
        return { data: svgIcon('<rect width="32" height="32" rx="7" fill="#111"/><path d="M8 7h16v4H13v3h9v4h-9v3h11v4H8z" fill="#fff"/>'), source: url ? url.replace(/^https?:\/\//, '').split('/')[0] : 'epicgames.com' };
      },
      set: async (id, data) => { find(id).icon = data; return list(); },
    },
    secret: { reveal: async (id, key, pw) => { await confirmMaster(pw); return field(id, key); } },
    totp: { code: async () => ({ code: String(Math.floor(Date.now() / 30000) * 7919 % 1e6).padStart(6, '0'), period: 30, remaining: 30 - Math.floor(Date.now() / 1000) % 30 }) },
    hello: {
      status: async () => ({ supported: true, enabled: helloOn }),
      enable: async (pw) => { await check(pw); await wait(600); helloOn = true; return true; },
      disable: async () => { helloOn = false; return true; },
      confirm: async () => { await wait(700); masterOkAt = helloOkAt = Date.now(); return true; },
    },
    history: { reveal: async (id, key, pw) => { await confirmMaster(pw); return find(id).history?.[key] || []; } },
    audit: {
      breaches: async () => {
        await wait(800);
        for (const e of entries) if (e.type === 'login' && e.fields.password) e.pwned = e.fields.password === 'Tr0ub4dor&3' ? 1432 : 0;
        return { checked: 4, breached: 2, list: list() };
      },
    },
    importer: {
      pick: async () => ({ file: 'Chrome Passwords.csv', format: 'Chrome / Edge', count: 42, duplicates: 3, notes: 0, totp: 0, tags: 0 }),
      confirm: async (skip) => {
        entries.push({ id: crypto.randomUUID(), type: 'login', title: 'amazon.fr', favorite: false, fields: { username: 'camille@gmail.com', password: 'Amz-2026!x', url: 'https://www.amazon.fr' }, tags: [], custom: [], createdAt: Date.now(), updatedAt: Date.now(), attachments: [] });
        return { added: skip ? 39 : 42, duplicates: 3, invalid: 0, list: list() };
      },
      cancel: async () => {},
    },
    clip: {
      copyTotp: async () => settings.clipboardSeconds,
      copyHistory: async () => settings.clipboardSeconds,
      copy: async (id, key) => {
        const v = field(id, key);
        if (!v) throw new Error('Ce champ est vide.');
        await navigator.clipboard?.writeText(v).catch(() => {});
        return settings.clipboardSeconds;
      },
    },
    link: { open: async (id) => window.open(/^https?:/.test(find(id).fields.url) ? find(id).fields.url : `https://${find(id).fields.url}`, '_blank') },
    attachment: {
      add: async (id) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><rect width="400" height="260" rx="16" fill="#3b4a7a"/><text x="24" y="50" fill="#fff" font-size="22" font-family="sans-serif">Scan (aperçu)</text></svg>`;
        find(id).attachments.push({ id: crypto.randomUUID(), name: 'scan-recto.png', mime: 'image/svg+xml', size: 182000, addedAt: Date.now(), url: `data:image/svg+xml;base64,${btoa(svg)}` });
        return list();
      },
      drop: async (id, files) => {
        for (const f of files) find(id).attachments.push({ id: crypto.randomUUID(), name: f.name, mime: 'application/octet-stream', size: f.data.length, addedAt: Date.now() });
        return list();
      },
      preview: async (id, attId) => find(id).attachments.find((a) => a.id === attId)?.url || null,
      save: async () => true,
      remove: async (id, attId) => { const e = find(id); e.attachments = e.attachments.filter((a) => a.id !== attId); return list(); },
    },
    backup: {
      export: async () => true,
      pick: async () => 'Pimkey-sauvegarde-2026-11-01.pimkey-backup',
      restore: async (pw) => { await check(pw); unlocked = false; },
      status: async () => backupStatus(),
      now: async () => { backups = { count: Math.min(backups.count + 1, settings.backupKeep), last: Date.now() }; return backupStatus(); },
      setDir: async (choose) => { settings = { ...settings, backupDir: choose ? 'D:\\OneDrive\\Pimkey' : null }; return { settings, status: backupStatus() }; },
      openDir: async () => {},
    },
    update: { status: async () => ({ state: 'dev' }), check: async () => {}, install: async () => {} },
    settings: { get: async () => settings, set: async ({ backupDir: _, syncDir: __, ...patch }) => (settings = { ...settings, ...patch }) },
    sync: {
      status: async () => sync,
      setDir: async () => (sync = { dir: 'C:\\Users\\vous\\OneDrive\\Pimkey', at: Date.now(), error: null, needPassword: false }),
      join: async (pw) => { if (!pw) throw new Error('MASTER_REQUIRED'); await check(pw); sync = { ...sync, at: Date.now(), needPassword: false }; return { status: sync, list: list() }; },
      now: async () => { await wait(400); return (sync = { ...sync, at: Date.now() }); },
      disable: async () => (sync = { dir: null, at: null, error: null, needPassword: false }),
      openDir: async () => {},
    },
    bridge: {
      status: async () => bridgeStatus(),
      enable: async (on) => { settings = { ...settings, browserExtension: !!on }; return bridgeStatus(); },
      revoke: async (id) => { devices = devices.filter((d) => d.id !== id); return bridgeStatus(); },
      answer: async () => {},
      openDir: async () => {},
    },
    app: { info: async () => ({ version: '0.1.0 (aperçu)', dataDir: '' }), openData: async () => {}, activity: () => {} },
    on(channel, cb) {
      listeners[channel].add(cb);
      return () => listeners[channel].delete(cb);
    },
  };
}
