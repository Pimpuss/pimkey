// Liaison avec Pimkey par l'hôte natif : port natif avec file d'attente, session authentifiée et chiffrée.
import * as P from './bridge.mjs';
import { loadPairing, clearPairing } from './store.js';

// États où Pimkey ne peut pas répondre, et ce que l'utilisateur peut y faire
export const STATES = {
  nohost: {
    title: 'Pimkey n’est pas prêt pour l’extension',
    text: 'Dans Pimkey, ouvrez Paramètres › Navigateur et activez « Extension Chrome et Edge ».',
  },
  absent: { title: 'Pimkey n’est pas ouvert', text: 'Ouvrez Pimkey pour utiliser vos identifiants.', action: 'open' },
  locked: { title: 'Pimkey est verrouillé', text: 'Déverrouillez-le pour utiliser vos identifiants : rien ne sort d’un coffre verrouillé.', action: 'open' },
  unpaired: { title: 'Extension pas encore appairée', text: 'Approuvez une fois cette extension dans Pimkey.', action: 'pair' },
  impostor: {
    title: 'Ce n’est pas votre Pimkey',
    text: 'Le programme joint n’a pas prouvé qu’il était le Pimkey appairé : rien ne lui a été envoyé. Appairez à nouveau si vous avez réinstallé Pimkey.',
    action: 'pair',
  },
  timeout: { title: 'Pimkey ne répond pas', text: 'Réessayez dans un instant.' },
  error: { title: 'Liaison avec Pimkey impossible', text: 'Réessayez dans un instant.' },
};

export class LinkError extends Error {
  constructor(state, message) {
    super(message || STATES[state]?.title || state);
    this.state = state;
  }
}

// Erreur du navigateur à l'ouverture du port natif → état
function portState(message = '') {
  if (/not found|forbidden/i.test(message)) return 'nohost';
  if (/exited/i.test(message)) return 'absent';
  return 'error';
}

// Port natif : messages reçus mis en file (next), ou passés à onMessage une fois la session ouverte
export function openPort() {
  const port = chrome.runtime.connectNative(P.HOST_NAME);
  const box = { queue: [], waiters: [], error: null, onMessage: null, onClose: null };
  port.onMessage.addListener((m) => {
    if (box.onMessage) box.onMessage(m);
    else if (box.waiters.length) box.waiters.shift().resolve(m);
    else box.queue.push(m);
  });
  port.onDisconnect.addListener(() => {
    box.error = new LinkError(portState(chrome.runtime.lastError?.message));
    for (const w of box.waiters.splice(0)) w.reject(box.error);
    box.onClose?.();
  });
  box.post = (m) => port.postMessage(m);
  box.close = () => { try { port.disconnect(); } catch {} box.onClose?.(); };
  box.next = (ms = 10e3) => new Promise((resolve, reject) => {
    if (box.queue.length) return resolve(box.queue.shift());
    if (box.error) return reject(box.error);
    const w = {
      resolve: (m) => { clearTimeout(timer); resolve(m); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    };
    const timer = setTimeout(() => {
      box.waiters.splice(box.waiters.indexOf(w), 1);
      reject(new LinkError('timeout'));
    }, ms);
    box.waiters.push(w);
  });
  return box;
}

// Pimkey est-il là ? → 'present' | 'locked' ; erreur 'absent', 'nohost'…
async function ping(box) {
  box.post({ t: 'ping' });
  const m = await box.next();
  if (m.t === 'absent') throw new LinkError('absent');
  if (m.t !== 'pong') throw new LinkError('error');
  return m.locked ? 'locked' : 'present';
}

// Session authentifiée dans les deux sens (clé d'appairage), puis requêtes chiffrées
export class Session {
  static async open() {
    const box = openPort();
    try {
      if ((await ping(box)) === 'locked') throw new LinkError('locked');
      const pairing = await loadPairing();
      if (!pairing) throw new LinkError('unpaired');
      const nc = P.randomB64(32);
      box.post({ t: 'auth', id: pairing.id, nc });
      const a = await box.next();
      if (a.t === 'locked') throw new LinkError('locked');
      if (a.t === 'unknown') {
        // Révoqué dans Pimkey : la clé ne sert plus à rien
        await clearPairing();
        throw new LinkError('unpaired');
      }
      if (a.t !== 'auth' || !(await P.verify(pairing.keys, a.mac, 'server', pairing.id, nc, a.ns))) throw new LinkError('impostor');
      const channel = await P.Channel.open(pairing.keys, nc, a.ns, 'client');
      box.post({ t: 'auth2', mac: await P.sign(pairing.keys, 'client', pairing.id, nc, a.ns) });
      const ready = await channel.open(await box.next());
      if (ready.t !== 'ready') throw new LinkError('error');
      return new Session(box, channel);
    } catch (e) {
      box.close();
      throw e instanceof LinkError ? e : new LinkError('error', e.message);
    }
  }

  constructor(box, channel) {
    this.box = box;
    this.channel = channel;
    this.seq = 0;
    this.pending = new Map();
    this.closed = false;
    box.onMessage = (m) => channel.open(m).then((reply) => {
      const p = this.pending.get(reply.rid);
      this.pending.delete(reply.rid);
      p?.(reply);
    }).catch(() => this.close());
    box.onClose = () => {
      this.closed = true;
      for (const p of this.pending.values()) p({ ok: false, code: 'error', error: 'Liaison avec Pimkey interrompue.' });
      this.pending.clear();
    };
  }

  close() {
    if (!this.closed) this.box.close();
  }

  async request(op, params = {}, ms = 15e3) {
    if (this.closed) throw new LinkError('error');
    // rid : numéro de la requête (params.id, lui, désigne un élément du coffre)
    const rid = ++this.seq;
    const reply = new Promise((resolve) => {
      this.pending.set(rid, resolve);
      setTimeout(() => {
        if (this.pending.delete(rid)) resolve({ ok: false, code: 'timeout', error: STATES.timeout.title });
      }, ms);
    });
    this.box.post(await this.channel.seal({ ...params, op, rid }));
    const r = await reply;
    if (!r.ok) {
      const e = new LinkError(r.code === 'locked' || r.code === 'timeout' ? r.code : 'request', r.error);
      e.code = r.code;
      throw e;
    }
    return r;
  }
}

// Affiche Pimkey ; s'il n'est pas lancé, l'hôte l'ouvre. Sans authentification : ne révèle rien.
export async function showPimkey() {
  const box = openPort();
  try {
    try {
      await ping(box);
      box.post({ t: 'show' });
      await box.next();
    } catch (e) {
      if (e.state !== 'absent') throw e;
      box.post({ t: 'launch' });
      const m = await box.next(35e3);
      if (m.t !== 'present') throw new LinkError('absent');
    }
  } finally {
    box.close();
  }
}

export { ping };
