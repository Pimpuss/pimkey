// Extension navigateur (Chrome, Edge) : Pimkey écoute sur un tube nommé propre à l'utilisateur, que rejoint l'hôte
// natif (native-host.cjs) lancé par le navigateur. Protocole : shared/bridge.mjs.
//
// - Rien ne passe sans appairage : chaque navigateur est approuvé une fois dans Pimkey (code à comparer des deux
//   côtés) ; sa clé est rangée dans le coffre chiffré. Coffre verrouillé : on ne peut que demander si Pimkey est là
//   et l'afficher, aucune extension ne peut s'authentifier.
// - Pimkey ne propose que les identifiants dont le site a le même domaine principal que la page (adresse donnée par
//   le navigateur, pas par la page), et le vérifie encore au moment de donner un mot de passe.
// - Un mot de passe enregistré depuis le navigateur l'est ici, par le coffre, jamais par la page.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { execFile } = require('node:child_process');
const P = require('../shared/bridge.mjs');
const { pipeName, frame, frameReader } = require('./native-host.cjs');
const { siteOf } = require('./vault.cjs');
const { isPrivateHost } = require('./favicon.cjs');
const { baseDomain, siteName } = require('../shared/sitename.mjs');

// ID de l'extension (fixé par la clé publique de extension/manifest.json, le même dans Chrome et Edge)
const EXTENSION_IDS = ['ngnafaoidpbokhboecpdjjgcopioaill'];
const AUTH_TIMEOUT = 10e3;
const PAIR_TIMEOUT = 3 * 60e3;
// Réponse chiffrée, en base64, sous la limite de 1 Mo des messages natifs
const MAX_REPLY = 600 * 1024;

const unbracket = (h) => h.replace(/^\[|\]$/g, '');

// Page web d'après son adresse (celle que donne le navigateur) : { origin, host, base, secure, local } ou null
function pageOf(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname) return null;
  const host = unbracket(u.hostname.toLowerCase()).replace(/^www\./, '');
  return { origin: u.origin, host, base: baseDomain(host), secure: u.protocol === 'https:', local: isPrivateHost(host) };
}

// L'identifiant est-il pour cette page ? Même domaine principal (appli Android : site de sa marque).
// exact : même nom d'hôte ; insecure : page en http alors que l'identifiant est pour https (hors réseau local),
// à confirmer par l'utilisateur. null si ce n'est pas le même site.
function matchPage(entry, page) {
  const site = siteOf(entry.fields.url);
  if (!site) return null;
  const key = unbracket(site.key);
  if (baseDomain(key) !== page.base) return null;
  const http = /^http:/i.test(entry.fields.url.trim());
  return { exact: key === page.host, insecure: !page.secure && !http && !page.local };
}

const str = (v, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : '');

class BridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---------- Serveur ----------

class Bridge {
  // hooks : approvePair({ name, code }) → Promise<boolean> (fenêtre de Pimkey), cancelPair(), paired(name), show(),
  // copy(value) → secondes avant effacement, changed() (élément ajouté ou modifié)
  constructor({ vault, hooks, pipe = pipeName() }) {
    this.vault = vault;
    this.hooks = hooks;
    this.pipe = pipe;
    this.server = null;
    this.conns = new Set();
    this.pairing = null; // une seule demande d'appairage à la fois
  }

  get listening() {
    return !!this.server?.listening;
  }

  start() {
    if (this.server) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.accept(socket));
      server.once('error', (e) => {
        this.server = null;
        reject(e.code === 'EADDRINUSE'
          ? new Error('Le canal de l’extension est déjà utilisé (une autre copie de Pimkey est ouverte ?).')
          : e);
      });
      server.listen(this.pipe, () => resolve());
      this.server = server;
    });
  }

  stop() {
    for (const c of this.conns) c.close();
    this.server?.close();
    this.server = null;
  }

  // Verrouillage : toutes les connexions sont coupées (y compris un appairage en cours)
  dropSessions() {
    for (const c of this.conns) c.close();
  }

  // Navigateur révoqué : ses connexions ouvertes sont coupées
  dropDevice(id) {
    for (const c of this.conns) if (c.deviceId === id) c.close();
  }

  accept(socket) {
    const conn = new Conn(this, socket);
    this.conns.add(conn);
    socket.on('close', () => {
      this.conns.delete(conn);
      conn.closed();
    });
  }

  // ---------- Requêtes d'une extension authentifiée ----------

  page(url) {
    const page = pageOf(url);
    if (!page) throw new BridgeError('page', 'Cette page n’est pas un site web.');
    return page;
  }

  // Identifiant demandé, seulement s'il est pour ce site
  entryFor(id, url, allowInsecure = false) {
    const page = this.page(url);
    const e = this.vault.webLogins().find((x) => x.id === id);
    const m = e && matchPage(e, page);
    if (!m) throw new BridgeError('mismatch', 'Cet identifiant n’est pas pour ce site.');
    if (m.insecure && !allowInsecure) throw new BridgeError('insecure', 'Page non chiffrée (http) : confirmation nécessaire.');
    return e;
  }

  async request(req) {
    if (!this.vault.unlocked) throw new BridgeError('locked', 'Pimkey est verrouillé.');
    switch (req.op) {
      case 'list': return this.list(req);
      case 'fill': {
        const e = this.entryFor(req.id, req.url, !!req.allowInsecure);
        return { username: e.fields.username || '', password: e.fields.password || '', totp: e.fields.totp ? this.vault.totpCode(e.id).code : null };
      }
      case 'totp': {
        const e = this.entryFor(req.id, req.url, true);
        if (!e.fields.totp) throw new BridgeError('totp', 'Pas de code 2FA pour cet identifiant.');
        return this.vault.totpCode(e.id);
      }
      case 'copy': {
        const e = this.entryFor(req.id, req.url, true);
        const value = req.field === 'totp' ? (e.fields.totp ? this.vault.totpCode(e.id).code : '')
          : ['username', 'password'].includes(req.field) ? e.fields[req.field] : '';
        if (!value) throw new BridgeError('empty', 'Ce champ est vide.');
        return { seconds: this.hooks.copy(value) };
      }
      case 'check': return this.check(req);
      case 'save': return this.save(req);
      case 'show': this.hooks.show(); return {};
      default: throw new BridgeError('op', 'Demande inconnue.');
    }
  }

  // Identifiants du site, sans aucun secret ; ceux de la même adresse exacte d'abord, puis les favoris
  list({ url }) {
    const page = this.page(url);
    const items = [];
    for (const e of this.vault.webLogins()) {
      const m = matchPage(e, page);
      if (!m) continue;
      items.push({
        id: e.id, title: e.title, username: e.fields.username || '', totp: !!e.fields.totp, hasPassword: !!e.fields.password,
        icon: e.icon || this.vault.siteIconOf(e) || null, exact: m.exact, insecure: m.insecure, favorite: !!e.favorite,
      });
    }
    items.sort((a, b) => (b.exact - a.exact) || (b.favorite - a.favorite) || a.title.localeCompare(b.title, 'fr'));
    // Icônes retirées si la réponse dépasse la limite des messages du navigateur
    let size = JSON.stringify(items).length;
    for (let i = items.length - 1; i >= 0 && size > MAX_REPLY; i--) {
      size -= items[i].icon?.length || 0;
      items[i].icon = null;
    }
    return { site: page.base, name: siteName(page.origin) || page.host, secure: page.secure, entries: items };
  }

  // Identifiant saisi dans une page : déjà connu, mot de passe changé (entryId), ou nouveau
  check({ url, username, password }) {
    const page = this.page(url);
    const user = str(username, 500).trim();
    const pw = str(password);
    if (!pw) throw new BridgeError('empty', 'Mot de passe vide.');
    const same = this.vault.webLogins().filter((e) => matchPage(e, page));
    if (same.some((e) => e.fields.password === pw && (!user || (e.fields.username || '').toLowerCase() === user.toLowerCase()))) return { status: 'known' };
    const mine = user && same.find((e) => (e.fields.username || '').toLowerCase() === user.toLowerCase());
    if (mine) return { status: 'changed', entryId: mine.id, title: mine.title };
    return { status: 'new', title: siteName(page.origin) || page.host };
  }

  // Enregistre un identifiant saisi dans une page : nouveau, ou nouveau mot de passe d'un identifiant de ce site
  save({ url, username, password, entryId: id }) {
    const page = this.page(url);
    const pw = str(password);
    if (!pw) throw new BridgeError('empty', 'Mot de passe vide.');
    if (id) {
      const e = this.entryFor(id, url, true);
      this.vault.saveEntry({ id: e.id, title: e.title, favorite: e.favorite, fields: { ...e.fields, password: pw } });
      this.hooks.changed();
      return { entryId: e.id, updated: true };
    }
    const title = siteName(page.origin) || page.host;
    const newId = this.vault.saveEntry({ type: 'login', title, fields: { username: str(username, 500).trim(), password: pw, url: `${page.origin}/` } });
    this.hooks.changed();
    return { entryId: newId, updated: false };
  }
}

// ---------- Une connexion (un hôte natif, donc un navigateur) ----------

class Conn {
  constructor(bridge, socket) {
    this.bridge = bridge;
    this.socket = socket;
    this.state = 'new'; // new → auth2 → ready ; new → pair-key → pair-confirm
    this.deviceId = null;
    this.queue = Promise.resolve();
    this.timer = null;
    socket.on('data', frameReader((msg) => {
      this.queue = this.queue.then(() => this.receive(msg)).catch(() => this.close());
    }, () => this.close()));
    socket.on('error', () => {});
  }

  send(obj) {
    if (!this.socket.destroyed) this.socket.write(frame(obj));
  }

  close() {
    clearTimeout(this.timer);
    this.state = 'closed';
    this.socket.destroy();
  }

  closed() {
    clearTimeout(this.timer);
    if (this.bridge.pairing === this) {
      this.bridge.pairing = null;
      this.bridge.hooks.cancelPair();
    }
  }

  deadline(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.close(), ms);
  }

  get vault() {
    return this.bridge.vault;
  }

  async receive(msg) {
    if (this.state === 'closed') return;
    if (this.state === 'ready') return this.onRequest(msg);
    const t = msg?.t;
    // Sans authentification : savoir si Pimkey est là (et verrouillé), l'afficher
    if (t === 'ping') return this.send({ t: 'pong', v: P.VERSION, locked: !this.vault.unlocked });
    if (t === 'show') { this.bridge.hooks.show(); return this.send({ t: 'shown' }); }
    if (this.state === 'new' && t === 'auth') return this.onAuth(msg);
    if (this.state === 'auth2' && t === 'auth2') return this.onAuth2(msg);
    if (this.state === 'new' && t === 'pair') return this.onPair(msg);
    if (this.state === 'pair-key' && t === 'pair-key') return this.onPairKey(msg);
    if (this.state === 'pair-confirm' && t === 'pair-ok') return this.onPairOk(msg);
    this.close();
  }

  // ---------- Authentification ----------

  async onAuth({ id, nc }) {
    if (!this.vault.unlocked) return this.send({ t: 'locked' });
    const key = typeof id === 'string' && this.vault.deviceKey(id);
    if (!key) return this.send({ t: 'unknown' });
    if (P.fromB64(nc).length !== 32) return this.close();
    this.deadline(AUTH_TIMEOUT);
    const ns = P.randomB64(32);
    this.auth = { id, nc, ns, keys: await P.importPairKey(key) };
    this.state = 'auth2';
    this.send({ t: 'auth', ns, mac: await P.sign(this.auth.keys, 'server', id, nc, ns) });
  }

  async onAuth2({ mac }) {
    const { id, nc, ns, keys } = this.auth;
    // Coffre verrouillé ou navigateur révoqué entre-temps
    if (!this.vault.unlocked || !this.vault.deviceKey(id) || !(await P.verify(keys, mac, 'client', id, nc, ns))) return this.close();
    clearTimeout(this.timer);
    this.channel = await P.Channel.open(keys, nc, ns, 'server');
    this.auth = null;
    this.deviceId = id;
    this.state = 'ready';
    this.vault.touchDevice(id);
    this.send(await this.channel.seal({ t: 'ready', v: P.VERSION }));
  }

  async onRequest(msg) {
    const req = await this.channel.open(msg); // message rejoué ou altéré : exception, connexion coupée
    if (!this.vault.unlocked || !this.vault.deviceKey(this.deviceId)) return this.close();
    // rid : numéro de la requête, que la réponse reprend (id désigne l'élément du coffre)
    let reply;
    try {
      reply = { ...(await this.bridge.request(req)), rid: req.rid, ok: true };
    } catch (e) {
      reply = { rid: req.rid, ok: false, code: e.code || 'error', error: e.message };
    }
    this.send(await this.channel.seal(reply));
  }

  // ---------- Appairage ----------

  async onPair({ name, commit, replaces }) {
    if (!this.vault.unlocked) return this.send({ t: 'locked' });
    if (this.bridge.pairing) return this.send({ t: 'busy' });
    if (P.fromB64(commit).length !== 32) return this.close();
    this.bridge.pairing = this;
    this.deadline(PAIR_TIMEOUT);
    const own = await P.pairingKeyPair();
    // replaces : appairage précédent de cette extension (« Appairer à nouveau »), retiré une fois le nouveau approuvé
    this.pair = { name: str(name, 60).trim() || 'Navigateur', commit, own, approved: null, extOk: false, replaces: str(replaces, 64) };
    this.state = 'pair-key';
    this.send({ t: 'pair', pub: own.pub });
  }

  async onPairKey({ pub }) {
    const p = this.pair;
    if ((await P.sha256B64(pub)) !== p.commit) return this.close();
    const secret = await P.pairingSecret(p.own.privateKey, pub, pub, p.own.pub);
    Object.assign(p, { extPub: pub, key: secret.key, keys: await P.importPairKey(secret.key) });
    this.state = 'pair-confirm';
    // Approbation dans Pimkey (fenêtre affichée avec le code) ; l'extension confirme de son côté (pair-ok)
    this.bridge.hooks.approvePair({ name: p.name, code: secret.code }).then((ok) => {
      if (this.state !== 'pair-confirm') return;
      p.approved = !!ok;
      return this.finishPair();
    }).catch(() => this.close());
  }

  async onPairOk({ mac }) {
    const p = this.pair;
    if (!(await P.verify(p.keys, mac, 'pair-ext', p.extPub, p.own.pub))) return this.close();
    p.extOk = true;
    return this.finishPair();
  }

  async finishPair() {
    const p = this.pair;
    if (p.approved === false) {
      this.send({ t: 'pair-refused' });
      return this.endPair();
    }
    if (!p.approved || !p.extOk) return;
    if (!this.vault.unlocked) return this.close();
    const id = this.vault.addDevice({ name: p.name, key: p.key });
    if (p.replaces && this.vault.deviceKey(p.replaces)) {
      this.vault.removeDevice(p.replaces);
      this.bridge.dropDevice(p.replaces);
    }
    this.send({ t: 'paired', id, mac: await P.sign(p.keys, 'pair-app', id, p.extPub, p.own.pub) });
    this.endPair();
    this.bridge.hooks.paired?.(p.name);
  }

  endPair() {
    clearTimeout(this.timer);
    this.pair = null;
    this.bridge.pairing = null;
    this.state = 'new';
  }
}

// ---------- Enregistrement de l'hôte natif (Chrome et Edge, compte Windows en cours) ----------

const REG_KEYS = {
  chrome: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${P.HOST_NAME}`,
  edge: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${P.HOST_NAME}`,
};

const reg = (args) => new Promise((resolve) => {
  execFile('reg', args, { windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
});

const manifestFile = (dir) => path.join(dir, `${P.HOST_NAME}.json`);

// Écrit l'hôte (pimkey-host.cmd : Pimkey.exe en mode Node sur native-host.cjs) et son manifeste dans dir, puis
// déclare le manifeste à Chrome et Edge. exe : Pimkey.exe (electron.exe en développement) ; script : native-host.cjs
// hors de l'archive asar. Refait à chaque démarrage : l'emplacement de Pimkey peut changer avec une mise à jour.
async function register({ dir, exe, script }) {
  fs.mkdirSync(dir, { recursive: true });
  const cmd = path.join(dir, 'pimkey-host.cmd');
  const q = (p) => `"${p.replace(/%/g, '%%')}"`;
  // Chemins non ASCII (nom d'utilisateur accentué) : le fichier est lu en UTF-8. Rien ne doit s'afficher :
  // la sortie de ce script est le canal du navigateur.
  const utf8 = /[^\x20-\x7e]/.test(exe + script);
  fs.writeFileSync(cmd, ['@echo off', ...(utf8 ? ['chcp 65001 >nul'] : []), 'set ELECTRON_RUN_AS_NODE=1', `${q(exe)} ${q(script)} %*`, ''].join('\r\n'));
  fs.writeFileSync(manifestFile(dir), JSON.stringify({
    name: P.HOST_NAME,
    description: 'Pimkey : remplissage des identifiants',
    path: cmd,
    type: 'stdio',
    allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
  }, null, 2));
  for (const key of Object.values(REG_KEYS)) {
    if ((await reg(['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestFile(dir), '/f'])) == null) {
      throw new Error('Impossible d’inscrire l’extension dans le registre de Windows.');
    }
  }
}

async function unregister(dir) {
  for (const key of Object.values(REG_KEYS)) await reg(['delete', key, '/f']);
  for (const f of [manifestFile(dir), path.join(dir, 'pimkey-host.cmd')]) fs.rmSync(f, { force: true });
}

// { chrome, edge } : le navigateur trouve-t-il l'hôte de ce Pimkey ?
async function registration(dir) {
  const out = {};
  for (const [name, key] of Object.entries(REG_KEYS)) {
    const value = await reg(['query', key, '/ve']);
    out[name] = !!value && value.toLowerCase().includes(manifestFile(dir).toLowerCase()) && fs.existsSync(manifestFile(dir));
  }
  return out;
}

module.exports = { Bridge, pageOf, matchPage, register, unregister, registration, EXTENSION_IDS, REG_KEYS };
