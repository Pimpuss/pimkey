// Coffre chiffré : tout reste sur ce PC, dans le dossier userData.
//
// Deux clés :
// - la clé des données (32 octets aléatoires) chiffre les éléments et les pièces jointes (AES-256-GCM) ;
// - la clé maître est dérivée du mot de passe maître par scrypt et ne sert qu'à chiffrer la clé des données.
// Changer de mot de passe maître ne rechiffre donc que la clé des données. Ni le mot de passe maître ni
// aucune clé en clair ne sont écrits sur le disque : ils ne vivent qu'en mémoire tant que le coffre est ouvert.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const TYPES = require('../shared/types.json');
const { strength } = require('../shared/strength.mjs');
const { totp, parseTotp } = require('./totp.cjs');
const { expiryTime } = require('../shared/expiry.mjs');
const { siteName, baseDomain, looksLikeHost, androidSite } = require('../shared/sitename.mjs');
const { mergeEntries, mergeIcons, signature, canon } = require('./sync.cjs');

const scrypt = promisify(crypto.scrypt);
const FORMAT = 'pimkey-vault';
const BACKUP_FORMAT = 'pimkey-backup';
const SYNC_FILE = 'vault.pimkey'; // nom du coffre dans le dossier synchronisé
// scrypt N = 2^17 : ~0,3 s par essai sur un PC récent, ce qui rend l'attaque par force brute coûteuse
const KDF = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1 };
const MIN_MASTER = 8;
const WRONG = 'Mot de passe maître incorrect.';

async function deriveKey(password, kdf) {
  return scrypt(String(password).normalize('NFC'), Buffer.from(kdf.salt, 'base64'), 32, {
    N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024,
  });
}

// Chiffrement authentifié : le « aad » lie chaque bloc à son rôle (une pièce jointe ne peut pas être
// substituée à une autre, la clé ne peut pas être confondue avec les données)
function seal(key, plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(plain), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function open(key, box, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]);
}

// Pièces jointes : fichier binaire iv (12) | tag (16) | données chiffrées
function sealBin(key, plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}

function openBin(key, buf, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

async function unwrapKey(header, password) {
  const kek = await deriveKey(password, header.kdf);
  try {
    return open(kek, header.key, 'pimkey-key');
  } catch {
    throw new Error(WRONG);
  } finally {
    kek.fill(0);
  }
}

async function wrapKey(dek, password) {
  const kdf = { ...KDF, salt: crypto.randomBytes(16).toString('base64') };
  const kek = await deriveKey(password, kdf);
  const key = seal(kek, dek, 'pimkey-key');
  kek.fill(0);
  return { kdf, key };
}

// Écriture atomique : un plantage pendant l'enregistrement ne laisse jamais un coffre à moitié écrit.
// fsync avant le renommage : sans lui, une coupure de courant peut laisser le nouveau nom sur un fichier vide.
function writeAtomic(file, content) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function checkMaster(password) {
  if (typeof password !== 'string' || password.length < MIN_MASTER) {
    throw new Error(`Le mot de passe maître doit contenir au moins ${MIN_MASTER} caractères.`);
  }
}

const str = (v, max = 10000) => (typeof v === 'string' ? v.slice(0, max) : '');
const ICON_RETRY = 7 * 86400e3; // un site sans icône est réessayé au bout d'une semaine
const ICON_FETCHER = 4; // à augmenter quand la récupération s'améliore : les sites sans icône sont alors réessayés
const TRASH_DAYS = 30; // un élément reste ce nombre de jours dans la corbeille avant d'être supprimé pour de bon
const HISTORY_MAX = 10; // anciennes valeurs gardées par champ (mot de passe)
const OLD_DAYS = 365; // l'audit signale un mot de passe inchangé depuis plus longtemps

// Étiquettes : sans espaces superflus, sans doublon (casse ignorée), 20 au plus
function cleanTags(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const tag = str(t, 40).replace(/\s+/g, ' ').trim();
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 20);
}

// Champs personnalisés [{ id, label, value, secret }] ; la valeur d'un champ masqué absente de la saisie
// (l'interface ne la connaît pas) est reprise de l'élément existant
function cleanCustom(list, prev = []) {
  if (!Array.isArray(list)) return prev;
  const out = [];
  for (const c of list.slice(0, 30)) {
    const old = c?.id && prev.find((p) => p.id === c.id);
    const label = str(c?.label, 100).trim();
    const value = c?.value === undefined ? old?.value || '' : str(c.value);
    if (!label && !value) continue;
    out.push({ id: old ? old.id : crypto.randomUUID(), label: label || 'Champ', value, secret: !!c.secret });
  }
  return out;
}

// Doublons à l'import : même site, identifiant et mot de passe (ou même note)
function dupKey(e) {
  const f = e.fields || {};
  if (e.type === 'login') return `login|${siteOf(f.url)?.key || ''}|${f.username || ''}|${f.password || ''}`;
  if (e.type === 'note') return `note|${e.title}|${f.content || ''}`;
  return `${e.type}|${e.title}`;
}

// Site d'un lien : { key: nom d'hôte sans « www. », root: adresse de la page d'accueil }, ou null.
// Une appli Android (android://…@com.instagram.android) compte pour le site de sa marque (instagram.com) :
// même icône que le site, et doublon du même compte enregistré sur le site.
function siteOf(raw) {
  if (!raw) return null;
  const app = androidSite(raw);
  if (app) return { key: app, root: `https://${app}/` };
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname) return null;
    return { key: u.hostname.replace(/^www\./, ''), root: `${u.protocol}//${u.host}/` };
  } catch {
    return null;
  }
}

// Ce que voit l'interface : les champs secrets (mots de passe, numéro de carte…) n'y figurent jamais,
// seulement s'ils sont remplis et, pour une carte, ses 4 derniers chiffres. Idem pour les champs personnalisés
// masqués et l'historique (seulement les dates).
// icon : image choisie pour l'élément, sinon icône du site (data URL), sinon null.
// audit : constats sur le mot de passe d'un identifiant (voir Vault.auditFlags), sinon null.
function publicEntry(e, siteIcon, audit) {
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
  return {
    id: e.id, type: e.type, title: e.title, favorite: !!e.favorite, createdAt: e.createdAt, updatedAt: e.updatedAt,
    deletedAt: e.deletedAt || null, fields, secrets, hints, attachments: e.attachments || [],
    icon: e.icon || siteIcon || null, customIcon: !!e.icon,
    tags: e.tags || [],
    custom: (e.custom || []).map((c) => (c.secret
      ? { id: c.id, label: c.label, secret: true, has: !!c.value }
      : { id: c.id, label: c.label, secret: false, has: !!c.value, value: c.value })),
    history: Object.fromEntries(Object.entries(e.history || {}).map(([k, list]) => [k, list.map((h) => h.changedAt)])),
    audit: audit || null,
  };
}

class Vault {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'vault.pimkey');
    this.attDir = path.join(dir, 'attachments');
    fs.mkdirSync(this.attDir, { recursive: true });
    this.dek = null;
    this.header = null;
    this.data = null;
  }

  exists() {
    return fs.existsSync(this.file);
  }

  get unlocked() {
    return !!this.dek;
  }

  readFile() {
    const v = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (v.format !== FORMAT) throw new Error("Ce fichier n'est pas un coffre Pimkey.");
    return v;
  }

  async create(password) {
    if (this.exists()) throw new Error('Un coffre existe déjà.');
    checkMaster(password);
    this.dek = crypto.randomBytes(32);
    this.header = { format: FORMAT, version: 1, ...(await wrapKey(this.dek, password)), keyAt: Date.now() };
    this.data = { entries: [], icons: {} };
    this.save();
  }

  async unlock(password) {
    const v = this.readFile();
    this.load(v, await unwrapKey(v, password));
  }

  load(v, dek) {
    this.data = JSON.parse(open(dek, v.data, 'pimkey-data').toString('utf8'));
    this.data.icons ||= {}; // coffres créés avant les icônes de sites
    this.header = { format: v.format, version: v.version, kdf: v.kdf, key: v.key, keyAt: v.keyAt || 0, ...(v.hello && { hello: v.hello }) };
    this.dek = dek;
    this.purgeTrash();
  }

  // ---------- Windows Hello ----------
  // header.hello = { challenge, key } : la clé des données chiffrée par SHA-256 de la signature Windows Hello du défi
  // (clé RSA du TPM, utilisable seulement après le geste Hello). Le mot de passe maître reste valable.

  helloChallenge() {
    return this.exists() ? this.readFile().hello?.challenge || null : null;
  }

  enableHello(challenge, signature) {
    this.ensureUnlocked();
    const k = crypto.createHash('sha256').update(signature).digest();
    this.header.hello = { challenge, key: seal(k, this.dek, 'pimkey-hello') };
    k.fill(0);
    this.save();
  }

  disableHello() {
    this.ensureUnlocked();
    delete this.header.hello;
    this.save();
  }

  unlockWithHello(signature) {
    const v = this.readFile();
    this.load(v, this.helloKey(v, signature));
  }

  // Coffre ouvert : la signature Hello redonne-t-elle bien sa clé ? (confirmation à la place du mot de passe maître)
  verifyHello(signature) {
    this.ensureUnlocked();
    const dek = this.helloKey(this.readFile(), signature);
    const ok = dek.length === this.dek.length && crypto.timingSafeEqual(dek, this.dek);
    dek.fill(0);
    return ok;
  }

  helloKey(v, signature) {
    if (!v.hello) throw new Error('Windows Hello n’est pas activé pour ce coffre.');
    const k = crypto.createHash('sha256').update(signature).digest();
    try {
      return open(k, v.hello.key, 'pimkey-hello');
    } catch {
      throw new Error('Windows Hello n’a pas permis d’ouvrir le coffre : utilisez le mot de passe maître.');
    } finally {
      k.fill(0);
    }
  }

  lock() {
    this.dek?.fill(0);
    this.dek = null;
    this.header = null;
    this.data = null;
  }

  // Redemandé avant d'afficher un secret : on compare la clé obtenue à celle du coffre ouvert
  async verify(password) {
    this.ensureUnlocked();
    try {
      const dek = await unwrapKey(this.header, password);
      const ok = crypto.timingSafeEqual(dek, this.dek);
      dek.fill(0);
      return ok;
    } catch {
      return false;
    }
  }

  async changePassword(current, next) {
    if (!(await this.verify(current))) throw new Error(WRONG);
    checkMaster(next);
    // keyAt : le mot de passe le plus récent l'emporte sur les autres appareils synchronisés
    Object.assign(this.header, await wrapKey(this.dek, next), { keyAt: Date.now() });
    this.save();
  }

  ensureUnlocked() {
    if (!this.dek) throw new Error('Le coffre est verrouillé.');
  }

  // onChange : appelé après chaque modification (synchronisation à prévoir), pas après une fusion
  save() {
    this.write();
    this.onChange?.();
  }

  write() {
    this.ensureUnlocked();
    const data = seal(this.dek, Buffer.from(JSON.stringify(this.data), 'utf8'), 'pimkey-data');
    writeAtomic(this.file, JSON.stringify({ ...this.header, data }, null, 2));
  }

  // ---------- Éléments ----------

  list() {
    this.ensureUnlocked();
    const audit = this.auditFlags();
    return this.data.entries.map((e) => publicEntry(e, this.siteIconOf(e), audit.get(e.id)));
  }

  find(id) {
    this.ensureUnlocked();
    const e = this.data.entries.find((x) => x.id === id);
    if (!e) throw new Error('Élément introuvable.');
    return e;
  }

  // input : { id?, type, title, favorite, fields, tags?, custom? } ; les champs secrets absents de input.fields sont
  // conservés tels quels (l'interface ne les connaît pas), une chaîne vide les efface. Sans tags ou custom, ceux de
  // l'élément existant sont gardés. Un mot de passe remplacé part dans l'historique.
  saveEntry(input, save = true) {
    this.ensureUnlocked();
    const existing = input.id ? this.find(input.id) : null;
    const type = existing ? existing.type : input.type;
    if (!TYPES[type]) throw new Error("Type d'élément inconnu.");
    const title = str(input.title, 200).trim();
    if (!title) throw new Error('Donnez un nom à cet élément.');
    const fields = {};
    for (const f of TYPES[type].fields) {
      const given = input.fields?.[f.key];
      if (f.secret && given === undefined) {
        if (existing?.fields[f.key]) fields[f.key] = existing.fields[f.key];
      } else if (given) fields[f.key] = str(given);
    }
    if (fields.totp) parseTotp(fields.totp);
    const tags = input.tags === undefined ? existing?.tags || [] : cleanTags(input.tags);
    const custom = cleanCustom(input.custom, existing?.custom || []);
    const now = Date.now();
    if (existing) {
      for (const f of TYPES[type].fields) {
        const before = existing.fields[f.key];
        if (!f.history || before === fields[f.key]) continue;
        if (before) existing.history = { ...existing.history, [f.key]: [{ value: before, changedAt: now }, ...(existing.history?.[f.key] || [])].slice(0, HISTORY_MAX) };
        existing.changedAt = { ...existing.changedAt, [f.key]: now };
        delete existing.pwned; // résultat de la vérification des fuites périmé
      }
      Object.assign(existing, { title, fields, tags, custom, favorite: !!input.favorite, updatedAt: now });
    } else {
      this.data.entries.push({
        id: crypto.randomUUID(), type, title, fields, tags, custom, favorite: !!input.favorite, createdAt: now, updatedAt: now, attachments: [],
      });
    }
    if (save) this.save();
    return existing ? existing.id : this.data.entries.at(-1).id;
  }

  // Identifiants dont le nom n'est que l'adresse du site (exports de Chrome et Edge : « accounts.epicgames.com ») :
  // renommés d'après le site (« Epic Games »). Un nom choisi à la main n'est jamais touché : seuls ceux qui
  // ressemblent à une adresse du même site que le lien sont concernés. dryRun : compte sans rien changer.
  tidyTitles(dryRun = false) {
    this.ensureUnlocked();
    const changes = [];
    for (const e of this.data.entries) {
      if (e.type !== 'login' || !looksLikeHost(e.title)) continue;
      const url = e.fields.url || '';
      const titleHost = e.title.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      const sameSite = !url || /^android:/i.test(url) || baseDomain(titleHost) === baseDomain(siteOf(url)?.key);
      const name = sameSite && (siteName(url) || siteName(titleHost));
      if (name && name !== e.title) changes.push({ e, from: e.title, to: name });
    }
    if (!dryRun && changes.length) {
      const now = Date.now();
      for (const c of changes) Object.assign(c.e, { title: c.to, updatedAt: now });
      this.save();
    }
    return { count: changes.length, examples: changes.slice(0, 3).map(({ from, to }) => ({ from, to })) };
  }

  // Copie d'un élément : champs, champs personnalisés, étiquettes, logo et pièces jointes (rechiffrées sous de
  // nouveaux identifiants) ; ni l'historique ni les favoris
  duplicateEntry(id) {
    const e = this.find(id);
    const now = Date.now();
    const copy = {
      id: crypto.randomUUID(), type: e.type, title: `${e.title} (copie)`.slice(0, 200), fields: { ...e.fields }, tags: [...(e.tags || [])],
      custom: (e.custom || []).map((c) => ({ ...c, id: crypto.randomUUID() })), favorite: false, createdAt: now, updatedAt: now, attachments: [],
    };
    if (e.icon) copy.icon = e.icon;
    for (const a of e.attachments || []) {
      const { buf } = this.readAttachment(id, a.id);
      const attId = crypto.randomUUID();
      writeAtomic(this.attFile(attId), sealBin(this.dek, buf, attId));
      copy.attachments.push({ ...a, id: attId, addedAt: now });
    }
    this.data.entries.push(copy);
    this.save();
    return copy.id;
  }

  // Import d'un autre gestionnaire. dryRun : compte sans rien enregistrer.
  importEntries(inputs, { skipDuplicates = true, dryRun = false } = {}) {
    this.ensureUnlocked();
    const known = new Set(this.data.entries.filter((e) => !e.deletedAt).map(dupKey));
    let added = 0;
    let duplicates = 0;
    let invalid = 0;
    for (const input of inputs) {
      const key = dupKey(input);
      if (known.has(key)) {
        duplicates++;
        if (skipDuplicates) continue;
      }
      known.add(key);
      if (dryRun) { added++; continue; }
      try {
        this.saveEntry(input, false);
        added++;
      } catch {
        invalid++;
      }
    }
    if (!dryRun && added) this.save();
    return { added, duplicates, invalid };
  }

  // ---------- Corbeille ----------
  // Un élément supprimé garde tout (champs, pièces jointes) jusqu'à sa suppression définitive

  // Plusieurs éléments à la fois (sélection dans la liste) : tous vérifiés avant de rien changer, un seul enregistrement
  trashEntries(ids) {
    const list = ids.map((id) => this.find(id));
    const now = Date.now();
    for (const e of list) Object.assign(e, { deletedAt: now, metaAt: now });
    this.save();
  }

  trashEntry(id) {
    this.trashEntries([id]);
  }

  restoreEntries(ids) {
    const list = ids.map((id) => this.find(id));
    const now = Date.now();
    for (const e of list) {
      delete e.deletedAt;
      e.updatedAt = now;
      e.metaAt = now;
    }
    this.save();
  }

  restoreEntry(id) {
    this.restoreEntries([id]);
  }

  // Supprime pour de bon, pièces jointes comprises
  deleteEntries(ids, save = true) {
    const gone = new Set(ids);
    for (const e of this.data.entries) {
      if (gone.has(e.id)) for (const a of e.attachments || []) fs.rmSync(this.attFile(a.id), { force: true });
    }
    this.data.entries = this.data.entries.filter((x) => !gone.has(x.id));
    if (save) this.save();
  }

  // Suppression définitive demandée depuis l'interface : identifiants vérifiés
  removeEntries(ids) {
    this.deleteEntries(ids.map((id) => this.find(id).id));
  }

  deleteEntry(id) {
    this.removeEntries([id]);
  }

  emptyTrash() {
    this.ensureUnlocked();
    this.deleteEntries(this.data.entries.filter((e) => e.deletedAt).map((e) => e.id));
  }

  // À l'ouverture : ce qui est dans la corbeille depuis plus de TRASH_DAYS jours disparaît
  purgeTrash(now = Date.now()) {
    const old = this.data.entries.filter((e) => e.deletedAt && now - e.deletedAt > TRASH_DAYS * 86400e3).map((e) => e.id);
    if (old.length) this.deleteEntries(old);
  }

  setFavorite(id, favorite) {
    Object.assign(this.find(id), { favorite: !!favorite, metaAt: Date.now() });
    this.save();
  }

  // key : un champ du type (« password »…) ou un champ personnalisé (« custom:<id> »)
  getField(id, key) {
    const e = this.find(id);
    if (typeof key === 'string' && key.startsWith('custom:')) {
      const c = (e.custom || []).find((x) => x.id === key.slice(7));
      if (!c) throw new Error('Champ inconnu.');
      return c.value || '';
    }
    if (!TYPES[e.type].fields.some((f) => f.key === key)) throw new Error('Champ inconnu.');
    return e.fields[key] || '';
  }

  // Anciennes valeurs d'un champ, de la plus récente à la plus ancienne : [{ value, changedAt }]
  getHistory(id, key) {
    return this.find(id).history?.[key] || [];
  }

  totpCode(id) {
    const key = this.getField(id, 'totp');
    if (!key) throw new Error('Aucune clé 2FA pour cet élément.');
    return totp(key);
  }

  // ---------- Audit des mots de passe ----------

  // Identifiants (hors corbeille) qui ont un mot de passe
  logins() {
    this.ensureUnlocked();
    return this.data.entries.filter((e) => e.type === 'login' && !e.deletedAt && e.fields.password);
  }

  // id → { weak, reused (n° du groupe d'éléments qui partagent ce mot de passe, 0 sinon), old, since,
  // pwned (nombre d'apparitions dans des fuites, null si jamais vérifié) }
  auditFlags(now = Date.now()) {
    const logins = this.logins();
    const uses = new Map();
    for (const e of logins) uses.set(e.fields.password, (uses.get(e.fields.password) || 0) + 1);
    const groups = new Map();
    for (const [pw, n] of uses) if (n > 1) groups.set(pw, groups.size + 1);
    return new Map(logins.map((e) => {
      const since = e.changedAt?.password || e.createdAt;
      return [e.id, {
        weak: strength(e.fields.password).score <= 1,
        reused: groups.get(e.fields.password) || 0,
        old: now - since > OLD_DAYS * 86400e3,
        since,
        pwned: e.pwned ? e.pwned.n : null,
        checkedAt: e.pwned?.at || null,
      }];
    }));
  }

  // Échéances à signaler par une notification : une fois par palier (3 mois, 1 mois, 1 semaine, expiré), retenu
  // dans l'élément ; une nouvelle date d'expiration repart de zéro. → [{ id, title, days }]
  expiryNotices(now = Date.now()) {
    this.ensureUnlocked();
    const due = [];
    for (const e of this.data.entries) {
      const t = !e.deletedAt && expiryTime(e);
      if (!t) continue;
      const days = Math.ceil((t - now) / 86400e3);
      const stage = days < 0 ? 4 : days <= 7 ? 3 : days <= 30 ? 2 : days <= 90 ? 1 : 0;
      const seen = e.expiryNotice?.t === t ? e.expiryNotice.stage : 0;
      if (stage > seen) {
        due.push({ id: e.id, title: e.title, days });
        e.expiryNotice = { t, stage };
      }
    }
    if (due.length) this.save();
    return due;
  }

  // Résultats de Have I Been Pwned : id → nombre d'apparitions (0 = jamais vu dans une fuite)
  setPwned(results) {
    const at = Date.now();
    for (const [id, n] of results) {
      const e = this.data.entries.find((x) => x.id === id);
      if (e) e.pwned = { n, at };
    }
    this.save();
  }

  // ---------- Icônes ----------
  // Rangées dans le coffre chiffré : la liste des sites ne se lit pas sur le disque.

  siteIconOf(e) {
    const site = e.type === 'login' && siteOf(e.fields.url);
    return (site && this.data.icons[site.key]?.data) || null;
  }

  // Sites des identifiants dont l'icône n'a jamais été cherchée (ou introuvable depuis plus d'une semaine)
  sitesWithoutIcon() {
    this.ensureUnlocked();
    const sites = new Map();
    for (const e of this.data.entries) {
      const site = e.type === 'login' && !e.deletedAt && siteOf(e.fields.url);
      const known = site && this.data.icons[site.key];
      if (site && (!known || (!known.data && (Date.now() - known.at > ICON_RETRY || known.v !== ICON_FETCHER)))) sites.set(site.key, site);
    }
    return [...sites.values()];
  }

  setSiteIcon(key, data, save = true) {
    this.ensureUnlocked();
    this.data.icons[key] = { data: data || null, at: Date.now(), v: ICON_FETCHER };
    if (save) this.save();
  }

  clearSiteIcons() {
    this.ensureUnlocked();
    this.data.icons = {};
    this.save();
  }

  setEntryIcon(id, data) {
    const e = this.find(id);
    if (data) e.icon = data;
    else delete e.icon;
    e.updatedAt = Date.now();
    this.save();
  }

  // ---------- Extension navigateur ----------
  // Navigateurs appairés : { id, name, key (clé d'appairage en base64), createdAt, usedAt }. Rangés dans le coffre
  // chiffré : coffre verrouillé, aucune extension ne peut s'authentifier ni rien obtenir.

  devices() {
    this.ensureUnlocked();
    return (this.data.devices || []).map(({ key: _, ...d }) => d);
  }

  deviceKey(id) {
    this.ensureUnlocked();
    return (this.data.devices || []).find((d) => d.id === id)?.key || null;
  }

  addDevice({ name, key }) {
    this.ensureUnlocked();
    const id = crypto.randomUUID();
    this.data.devices = [...(this.data.devices || []), { id, name: str(name, 60).trim() || 'Navigateur', key, createdAt: Date.now(), usedAt: null }];
    this.save();
    return id;
  }

  removeDevice(id) {
    this.ensureUnlocked();
    this.data.devices = (this.data.devices || []).filter((d) => d.id !== id);
    this.save();
  }

  // Dernière utilisation, enregistrée au plus une fois par heure (pas une écriture du coffre par connexion)
  touchDevice(id, now = Date.now()) {
    const d = (this.data?.devices || []).find((x) => x.id === id);
    if (!d) return;
    const stale = !d.usedAt || now - d.usedAt > 3600e3;
    d.usedAt = now;
    if (stale) this.save();
  }

  // Identifiants (hors corbeille) qui ont un lien : ceux que l'extension peut proposer
  webLogins() {
    this.ensureUnlocked();
    return this.data.entries.filter((e) => e.type === 'login' && !e.deletedAt && e.fields.url);
  }

  // ---------- Pièces jointes (scans de documents, PDF…) ----------

  attFile(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Pièce jointe invalide.');
    return path.join(this.attDir, id + '.bin');
  }

  addAttachment(entryId, { name, mime, buf }) {
    const e = this.find(entryId);
    const id = crypto.randomUUID();
    writeAtomic(this.attFile(id), sealBin(this.dek, buf, id));
    (e.attachments ||= []).push({ id, name: str(name, 255), mime: str(mime, 100), size: buf.length, addedAt: Date.now() });
    e.updatedAt = Date.now();
    this.save();
  }

  readAttachment(entryId, attId) {
    const a = (this.find(entryId).attachments || []).find((x) => x.id === attId);
    if (!a) throw new Error('Pièce jointe introuvable.');
    return { ...a, buf: openBin(this.dek, fs.readFileSync(this.attFile(a.id)), a.id) };
  }

  removeAttachment(entryId, attId) {
    const e = this.find(entryId);
    e.attachments = (e.attachments || []).filter((a) => a.id !== attId);
    e.updatedAt = Date.now();
    fs.rmSync(this.attFile(attId), { force: true });
    this.save();
  }

  // ---------- Synchronisation ----------
  // Le dossier synchronisé (OneDrive…) contient vault.pimkey, chiffré par la même clé des données que ce coffre, et
  // attachments/. Ni Windows Hello (lié au TPM de cet ordinateur), ni les navigateurs appairés, ni la base de fusion
  // n'y figurent. Le coffre local reste la référence : Pimkey marche sans le dossier, et fusionne dès qu'il le retrouve.

  readRemote(dir) {
    const file = path.join(dir, SYNC_FILE);
    if (!fs.existsSync(file)) return null;
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (v.format !== FORMAT) throw new Error("Le dossier contient un fichier vault.pimkey qui n'est pas un coffre Pimkey.");
    return v;
  }

  // Données d'un coffre du dossier, ou null s'il n'est pas chiffré par la même clé (créé sur un autre appareil)
  openRemote(v) {
    try {
      const d = JSON.parse(open(this.dek, v.data, 'pimkey-data').toString('utf8'));
      return { entries: (d.entries || []).filter((e) => typeof e?.id === 'string' && TYPES[e.type]), icons: d.icons || {} };
    } catch {
      return null;
    }
  }

  // Fusionne ce coffre et celui du dossier, puis écrit le résultat des deux côtés (le dossier seulement s'il change).
  // Erreur SYNC_PASSWORD : le dossier contient un coffre créé ailleurs, à rejoindre avec son mot de passe (joinSync).
  // icons : false quand les icônes des sites sont désactivées (celles du dossier restent pour les autres appareils).
  // → { changed (éléments modifiés ici), conflicts, passwordChanged (mot de passe maître changé sur un autre appareil) }
  syncWith(dir, { icons = true } = {}) {
    this.ensureUnlocked();
    dir = path.resolve(dir);
    const own = path.resolve(this.dir).toLowerCase();
    if (dir.toLowerCase() === own || dir.toLowerCase().startsWith(own + path.sep)) {
      throw new Error('Choisissez un dossier en dehors du dossier des données de Pimkey.');
    }
    const remAtt = path.join(dir, 'attachments');
    fs.mkdirSync(remAtt, { recursive: true });
    const remote = this.readRemote(dir);
    const sources = [];
    if (remote) {
      const d = this.openRemote(remote);
      if (!d) throw new Error('SYNC_PASSWORD');
      sources.push(d);
    }
    // Copies laissées par le service quand deux appareils écrivent en même temps (« vault-PC.pimkey »,
    // « vault (1).pimkey », « vault.sync-conflict-….pimkey ») : fusionnées puis effacées
    const extras = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/^vault.+\.pimkey$/i.test(f) || f.toLowerCase() === SYNC_FILE) continue;
      try {
        const d = this.openRemote(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
        if (d) { sources.push(d); extras.push(f); }
      } catch {}
    }

    const key = dir.toLowerCase();
    const base = this.data.sync?.dir === key ? this.data.sync.base : {};
    const before = canon({ entries: this.data.entries, icons: this.data.icons, sync: this.data.sync, header: this.header });
    const refs = (list) => new Set(list.flatMap((e) => (e.attachments || []).map((a) => a.id)));
    const localRefs = refs(this.data.entries);
    const remoteRefs = refs(sources.flatMap((d) => d.entries));
    let entries = this.data.entries;
    let iconMap = icons ? this.data.icons : {};
    let conflicts = 0;
    for (const d of sources) {
      const m = mergeEntries(entries, d.entries, base);
      entries = m.entries;
      conflicts += m.conflicts;
      if (icons) iconMap = mergeIcons(iconMap, d.icons);
    }

    // Mot de passe maître : le plus récemment choisi (même clé des données, seule son enveloppe change)
    let passwordChanged = false;
    if (remote && (remote.keyAt || 0) > (this.header.keyAt || 0)) {
      Object.assign(this.header, { kdf: remote.kdf, key: remote.key, keyAt: remote.keyAt });
      passwordChanged = true;
    }

    // Pièces jointes : chiffrées par la même clé, copiées telles quelles là où elles manquent ; d'abord les fichiers,
    // puis le coffre qui les référence (un autre appareil ne doit jamais lire une référence sans son fichier)
    const kept = refs(entries);
    for (const id of kept) {
      const lf = this.attFile(id);
      const rf = path.join(remAtt, `${id}.bin`);
      const hasL = fs.existsSync(lf);
      const hasR = fs.existsSync(rf);
      if (!hasL && hasR) writeAtomic(lf, fs.readFileSync(rf));
      else if (hasL && !hasR) writeAtomic(rf, fs.readFileSync(lf));
    }

    const out = { entries, icons: icons ? iconMap : sources[0]?.icons || {} };
    const header = { format: FORMAT, version: this.header.version, kdf: this.header.kdf, key: this.header.key, keyAt: this.header.keyAt || 0 };
    const unchanged = remote && !extras.length && canon(sources[0]) === canon(out)
      && canon({ format: remote.format, version: remote.version, kdf: remote.kdf, key: remote.key, keyAt: remote.keyAt || 0 }) === canon(header);
    if (!unchanged) {
      const data = seal(this.dek, Buffer.from(JSON.stringify(out), 'utf8'), 'pimkey-data');
      writeAtomic(path.join(dir, SYNC_FILE), JSON.stringify({ ...header, data }, null, 2));
    }
    for (const f of extras) fs.rmSync(path.join(dir, f), { force: true });
    // Fichiers des pièces jointes supprimées ailleurs (ou ici) : effacés des deux côtés
    for (const id of localRefs) if (!kept.has(id)) fs.rmSync(this.attFile(id), { force: true });
    for (const id of remoteRefs) if (!kept.has(id)) fs.rmSync(path.join(remAtt, `${id}.bin`), { force: true });

    const changed = canon(this.data.entries) !== canon(entries) || canon(this.data.icons) !== canon(iconMap);
    Object.assign(this.data, { entries, icons: iconMap, sync: { dir: key, base: Object.fromEntries(entries.map((e) => [e.id, signature(e)])) } });
    if (canon({ entries: this.data.entries, icons: this.data.icons, sync: this.data.sync, header: this.header }) !== before) this.write();
    return { changed, conflicts, passwordChanged };
  }

  // Rejoindre le coffre d'un dossier créé sur un autre appareil : ses éléments et ceux de ce coffre sont réunis, et ce
  // coffre adopte sa clé des données et son mot de passe maître. Windows Hello, lié à l'ancienne clé, est à réactiver.
  async joinSync(dir, password, opts) {
    this.ensureUnlocked();
    const remote = this.readRemote(dir);
    if (!remote) return this.syncWith(dir, opts);
    const dek = await unwrapKey(remote, password);
    if (crypto.timingSafeEqual(dek, this.dek)) {
      dek.fill(0);
      return this.syncWith(dir, opts);
    }
    // Pièces jointes de ce coffre rechiffrées par la nouvelle clé : écrites à côté, puis remplacées une fois
    // le coffre enregistré avec cette clé
    const atts = this.data.entries.flatMap((e) => e.attachments || []).filter((a) => fs.existsSync(this.attFile(a.id)));
    for (const a of atts) writeAtomic(this.attFile(a.id) + '.new', sealBin(dek, openBin(this.dek, fs.readFileSync(this.attFile(a.id)), a.id), a.id));
    this.dek.fill(0);
    this.dek = dek;
    this.header = { format: FORMAT, version: remote.version, kdf: remote.kdf, key: remote.key, keyAt: remote.keyAt || 0 };
    delete this.data.sync;
    this.write();
    for (const a of atts) fs.renameSync(this.attFile(a.id) + '.new', this.attFile(a.id));
    return { ...this.syncWith(dir, opts), changed: true, joined: true };
  }

  // ---------- Sauvegarde ----------

  // La sauvegarde reste chiffrée : elle s'ouvre avec le mot de passe maître en vigueur au moment de l'export
  exportBackup() {
    this.ensureUnlocked();
    const attachments = {};
    for (const e of this.data.entries) {
      for (const a of e.attachments || []) attachments[a.id] = fs.readFileSync(this.attFile(a.id)).toString('base64');
    }
    return JSON.stringify({ format: BACKUP_FORMAT, version: 1, createdAt: Date.now(), vault: this.readFile(), attachments });
  }

  writeBackup(file) {
    writeAtomic(file, this.exportBackup());
  }

  static async readBackup(text, password) {
    let b;
    try { b = JSON.parse(text); } catch { b = null; }
    if (b?.format !== BACKUP_FORMAT || b.vault?.format !== FORMAT) throw new Error("Ce fichier n'est pas une sauvegarde Pimkey.");
    const dek = await unwrapKey(b.vault, password);
    const data = JSON.parse(open(dek, b.vault.data, 'pimkey-data').toString('utf8'));
    for (const e of data.entries) for (const a of e.attachments || []) openBin(dek, Buffer.from(b.attachments[a.id] || '', 'base64'), a.id);
    dek.fill(0);
    return { backup: b, count: data.entries.length };
  }

  // Remplace le coffre actuel par la sauvegarde ; l'ancien coffre est mis de côté dans « avant-restauration-… »
  async restoreBackup(text, password) {
    const { backup } = await Vault.readBackup(text, password);
    this.lock();
    if (this.exists()) {
      const aside = path.join(this.dir, `avant-restauration-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      fs.mkdirSync(aside, { recursive: true });
      fs.renameSync(this.file, path.join(aside, 'vault.pimkey'));
      fs.renameSync(this.attDir, path.join(aside, 'attachments'));
      fs.mkdirSync(this.attDir, { recursive: true });
    }
    for (const [id, b64] of Object.entries(backup.attachments)) writeAtomic(this.attFile(id), Buffer.from(b64, 'base64'));
    writeAtomic(this.file, JSON.stringify(backup.vault, null, 2));
  }
}

module.exports = { Vault, TYPES, MIN_MASTER, TRASH_DAYS, OLD_DAYS, siteOf };
