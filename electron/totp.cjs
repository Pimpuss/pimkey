// Codes 2FA (TOTP, RFC 6238) calculés localement à partir de la clé secrète enregistrée dans le coffre.
// La clé peut être donnée telle quelle (base32, « JBSW Y3DP… ») ou sous forme de lien otpauth://totp/…
const crypto = require('node:crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const INVALID = 'Clé 2FA invalide : collez la clé secrète (lettres A à Z et chiffres 2 à 7) ou le lien otpauth://.';

function base32(text) {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  const out = [];
  let bits = 0;
  let acc = 0;
  for (const ch of clean) {
    acc = (acc << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

// { key, digits, period, algorithm } ; lève une erreur lisible si la clé n'est pas utilisable
function parseTotp(raw) {
  const text = String(raw || '').trim();
  let secret = text;
  let digits = 6;
  let period = 30;
  let algorithm = 'sha1';
  if (/^otpauth:/i.test(text)) {
    let u;
    try { u = new URL(text); } catch { throw new Error(INVALID); }
    if (u.host.toLowerCase() !== 'totp') throw new Error('Seuls les codes basés sur le temps (TOTP) sont pris en charge.');
    secret = u.searchParams.get('secret') || '';
    digits = Number(u.searchParams.get('digits')) || 6;
    period = Number(u.searchParams.get('period')) || 30;
    algorithm = (u.searchParams.get('algorithm') || 'SHA1').toLowerCase();
  }
  const key = base32(secret);
  if (!key || key.length < 5 || digits < 6 || digits > 8 || period < 10 || period > 300 || !['sha1', 'sha256', 'sha512'].includes(algorithm)) {
    throw new Error(INVALID);
  }
  return { key, digits, period, algorithm };
}

// Code en cours et secondes avant le suivant
function totp(raw, now = Date.now()) {
  const p = parseTotp(raw);
  const seconds = Math.floor(now / 1000);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / p.period)));
  const h = crypto.createHmac(p.algorithm, p.key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** p.digits;
  return { code: String(n).padStart(p.digits, '0'), period: p.period, remaining: p.period - (seconds % p.period) };
}

module.exports = { totp, parseTotp };
