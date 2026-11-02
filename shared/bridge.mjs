// Protocole entre l'extension navigateur et Pimkey : appairage, authentification mutuelle et canal chiffré.
// Partagé par le processus principal (Node) et l'extension (copie dans extension/lib, npm run extension) :
// WebCrypto seulement, aucune dépendance.
//
// Appairage (une fois, ECDH P-256 et code à comparer, comme l'appairage Bluetooth) :
//   extension → { t: 'pair', name, commit: SHA-256(clé publique de l'extension), replaces? (appairage précédent) }
//   Pimkey    → { t: 'pair', pub }                        clé publique de Pimkey
//   extension → { t: 'pair-key', pub }                    Pimkey vérifie l'engagement
//   les deux côtés affichent le même code à 6 chiffres, tiré du secret ECDH ; l'utilisateur confirme des deux côtés
//   extension → { t: 'pair-ok', mac }                     preuve que l'extension a la clé et que l'utilisateur a confirmé
//   Pimkey    → { t: 'paired', id, mac }                  après l'approbation dans Pimkey ; sinon { t: 'pair-refused' }
// L'engagement empêche un intermédiaire de choisir ses clés après coup pour que les deux codes coïncident.
//
// Connexion (à chaque fois) : défi-réponse HMAC dans les deux sens avec la clé d'appairage, puis messages chiffrés
// en AES-256-GCM avec des clés de session propres à chaque sens et un compteur (ni rejeu, ni réordonnancement) :
//   extension → { t: 'auth', id, nc }
//   Pimkey    → { t: 'auth', ns, mac: HMAC('server', id, nc, ns) }   ou { t: 'locked' } / { t: 'unknown' }
//   extension → { t: 'auth2', mac: HMAC('client', id, nc, ns) }
//   puis      { t: 'msg', n, d } dans les deux sens : requête { rid, op, ...paramètres }, réponse { rid, ok, ... }
//   (rid : numéro de la requête ; id, dans les paramètres, désigne un élément du coffre)
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const HOST_NAME = 'fr.yalma.pimkey';
export const VERSION = 1;
// Le navigateur refuse les messages de plus de 1 Mo venant de l'hôte natif
export const MAX_MESSAGE = 1024 * 1024;
export const CODE_DIGITS = 6;

export function toB64(bytes) {
  const a = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(text) {
  if (typeof text !== 'string') throw new Error('Message invalide.');
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export const randomB64 = (n = 32) => toB64(globalThis.crypto.getRandomValues(new Uint8Array(n)));

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

// Parties d'un HMAC sans ambiguïté possible (« a|bc » ≠ « ab|c »)
const macInput = (parts) => enc.encode(JSON.stringify(['pimkey-bridge', VERSION, ...parts]));

export const sha256B64 = async (b64) => toB64(await subtle.digest('SHA-256', fromB64(b64)));

// ---------- Appairage ----------

const P256 = { name: 'ECDH', namedCurve: 'P-256' };

// Clé éphémère d'appairage : { privateKey, pub (point brut en base64) }
export async function pairingKeyPair() {
  const kp = await subtle.generateKey(P256, false, ['deriveBits']);
  return { privateKey: kp.privateKey, pub: toB64(await subtle.exportKey('raw', kp.publicKey)) };
}

// Secret d'appairage, identique des deux côtés : { key (32 octets en base64), code (6 chiffres) }.
// extPub et appPub : clés publiques de l'extension et de Pimkey, toujours dans cet ordre.
export async function pairingSecret(privateKey, peerPub, extPub, appPub) {
  const raw = fromB64(peerPub);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('Clé d’appairage invalide.');
  const peer = await subtle.importKey('raw', raw, P256, false, []);
  const z = await subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const salt = await subtle.digest('SHA-256', concat(fromB64(extPub), fromB64(appPub)));
  const base = await subtle.importKey('raw', z, 'HKDF', false, ['deriveBits']);
  const bits = (info, n) => subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, n);
  const key = toB64(await bits('pimkey-pair-key', 256));
  const n = new DataView(await bits('pimkey-pair-code', 32)).getUint32(0) % 10 ** CODE_DIGITS;
  return { key, code: String(n).padStart(CODE_DIGITS, '0') };
}

// « 123456 » → « 123 456 »
export const formatCode = (code) => `${code.slice(0, 3)} ${code.slice(3)}`;

// ---------- Clé d'appairage ----------

// Clés tirées de la clé d'appairage : HMAC (authentification) et HKDF (clés de session). Non extractibles : dans
// l'extension, elles sont rangées telles quelles dans IndexedDB et le JavaScript ne peut plus en lire la valeur.
export async function importPairKey(keyB64) {
  const raw = fromB64(keyB64);
  if (raw.length !== 32) throw new Error('Clé d’appairage invalide.');
  const [mac, kdf] = await Promise.all([
    subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
    subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']),
  ]);
  raw.fill(0);
  return { mac, kdf };
}

export const sign = async (keys, ...parts) => toB64(await subtle.sign('HMAC', keys.mac, macInput(parts)));

// Comparaison en temps constant (faite par WebCrypto)
export async function verify(keys, mac, ...parts) {
  try {
    return await subtle.verify('HMAC', keys.mac, fromB64(mac), macInput(parts));
  } catch {
    return false;
  }
}

// ---------- Canal chiffré ----------

async function sessionKey(keys, nc, ns, dir) {
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(fromB64(nc), fromB64(ns)), info: enc.encode(`pimkey-session-${dir}`) },
    keys.kdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

const AAD = enc.encode(`pimkey-bridge-${VERSION}`);

function iv(n) {
  const b = new Uint8Array(12);
  new DataView(b.buffer).setBigUint64(4, BigInt(n));
  return b;
}

// Messages chiffrés dans un sens et dans l'autre, numérotés : un message rejoué, perdu ou déplacé est refusé.
// Les envois et les lectures sont mis en file : l'ordre des messages est celui des appels.
export class Channel {
  static async open(keys, nc, ns, role) {
    const [c2s, s2c] = await Promise.all([sessionKey(keys, nc, ns, 'c2s'), sessionKey(keys, nc, ns, 's2c')]);
    return role === 'server' ? new Channel(s2c, c2s) : new Channel(c2s, s2c);
  }

  constructor(sendKey, recvKey) {
    this.sendKey = sendKey;
    this.recvKey = recvKey;
    this.out = 0;
    this.in = 0;
    this.sending = Promise.resolve();
    this.reading = Promise.resolve();
  }

  seal(obj) {
    const run = this.sending.then(async () => {
      const n = this.out++;
      const d = await subtle.encrypt({ name: 'AES-GCM', iv: iv(n), additionalData: AAD }, this.sendKey, enc.encode(JSON.stringify(obj)));
      return { t: 'msg', n, d: toB64(d) };
    });
    this.sending = run.catch(() => {});
    return run;
  }

  open(frame) {
    const run = this.reading.then(async () => {
      if (frame?.t !== 'msg' || frame.n !== this.in) throw new Error('Message hors séquence.');
      let plain;
      try {
        plain = await subtle.decrypt({ name: 'AES-GCM', iv: iv(frame.n), additionalData: AAD }, this.recvKey, fromB64(frame.d));
      } catch {
        throw new Error('Message altéré.');
      }
      this.in++;
      return JSON.parse(dec.decode(plain));
    });
    this.reading = run.catch(() => {});
    return run;
  }
}
