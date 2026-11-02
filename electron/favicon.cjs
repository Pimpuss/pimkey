// Icône d'un site, lue directement sur le site lui-même : aucun service tiers (Google, DuckDuckGo…) ne voit
// la liste des comptes. Ordre d'essai : icônes déclarées dans la page (<link rel="icon">, apple-touch-icon),
// de la plus adaptée à la moins adaptée, puis /favicon.ico.
const MAX_HTML = 1024 * 1024;
const MAX_ICON = 512 * 1024;
const TIMEOUT = 8000;

// Lecture plafonnée : une réponse trop grosse est abandonnée sans tout télécharger
async function readCapped(res, max) {
  if (Number(res.headers.get('content-length')) > max) return null;
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function get(fetchFn, url, max, accept) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal, redirect: 'follow', headers: { Accept: accept } });
    if (!res.ok || !res.body) return null;
    const buf = await readCapped(res, max);
    return buf && { buf, url: res.url || url, type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Type réel d'après les premiers octets : une page d'erreur HTML servie avec un code 200 est écartée
function sniff(buf) {
  const head = buf.subarray(0, 12);
  if (head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0) return 'image/x-icon';
  const text = buf.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(text)) return 'image/svg+xml';
  return null;
}

// Un .ico regroupe souvent plusieurs tailles (jusqu'à plusieurs centaines de Ko, ex. La Poste) : on ne garde que
// l'image la plus proche de 128 px, en PNG si elle l'est déjà, sinon dans un .ico d'une seule image
function trimIco(buf) {
  if (buf.length < 22 || buf.readUInt16LE(2) !== 1) return null;
  let best = null;
  for (let i = 0; i < buf.readUInt16LE(4) && 6 + i * 16 + 16 <= buf.length; i++) {
    const o = 6 + i * 16;
    const size = buf[o] || 256;
    const len = buf.readUInt32LE(o + 8);
    const off = buf.readUInt32LE(o + 12);
    if (!len || off + len > buf.length) continue;
    const png = sniff(buf.subarray(off, off + 12)) === 'image/png';
    // Une image BMP de 256 px pèse 256 Ko : on lui préfère une plus petite
    const score = -Math.abs(size - 128) - (!png && size > 128 ? 1000 : 0);
    if (!best || score > best.score) best = { o, len, off, png, score };
  }
  if (!best) return null;
  const data = buf.subarray(best.off, best.off + best.len);
  if (best.png) return { buf: Buffer.from(data), mime: 'image/png' };
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  buf.copy(head, 6, best.o, best.o + 12);
  head.writeUInt32LE(22, 18);
  return { buf: Buffer.concat([head, data]), mime: 'image/x-icon' };
}

// Plus le rang est élevé, plus l'icône est adaptée : SVG (net à toute taille), puis taille proche de 128 px
function rank({ size, svg }) {
  if (svg) return 1100;
  return size >= 32 ? 1000 - Math.abs(size - 128) : size;
}

function iconLinks(html, base) {
  const out = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attr = (name) => {
      const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
      return m ? (m[1] ?? m[2] ?? m[3]) : '';
    };
    const rel = attr('rel').toLowerCase().split(/\s+/);
    const apple = rel.some((r) => r.startsWith('apple-touch-icon'));
    if (!rel.includes('icon') && !apple) continue;
    let url;
    try {
      url = new URL(attr('href').replace(/&amp;/g, '&'), base).href;
    } catch {
      continue;
    }
    if (!/^https?:/.test(url)) continue;
    const sizes = attr('sizes').toLowerCase();
    const declared = sizes === 'any' ? 256 : Math.max(0, ...sizes.split(/\s+/).map((s) => parseInt(s, 10) || 0));
    const svg = /\.svg(\?|#|$)/i.test(url) || /svg/i.test(attr('type'));
    out.push({ url, size: declared || (apple ? 180 : 32), svg });
  }
  return out.sort((a, b) => rank(b) - rank(a));
}

// Appareil du réseau local (Proxmox, routeur, NAS…) : souvent en HTTPS avec un certificat auto-signé
function isPrivateHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || !h.includes('.') && !h.includes(':')) return true;
  if (/\.(local|lan|home|internal|intranet|localdomain|home\.arpa)$/.test(h)) return true;
  const ip = h.split('.').map(Number);
  if (ip.length === 4 && ip.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) && /^[\d.]+$/.test(h)) {
    const [a, b] = ip;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return h === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h);
}

// url : la page d'un site (« https://exemple.fr/ ») ou directement une image. Renvoie { buf, mime } ou null.
async function fetchSiteIcon(url, fetchFn) {
  const page = await get(fetchFn, url, MAX_HTML, 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8');
  const direct = page && !/html/.test(page.type) && sniff(page.buf);
  if (direct) return shrink({ buf: page.buf, mime: direct });
  const candidates = page && /html/.test(page.type) ? iconLinks(page.buf.toString('utf8'), page.url) : [];
  // Après une redirection (exemple.fr → www.exemple.fr), on essaie les deux /favicon.ico
  for (const base of new Set([page?.url, url].filter(Boolean))) {
    candidates.push({ url: new URL('/favicon.ico', base).href });
  }
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.url) || seen.size >= 6) continue;
    seen.add(c.url);
    const res = await get(fetchFn, c.url, MAX_ICON, 'image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8');
    const mime = res && res.buf.length > 0 && sniff(res.buf);
    if (mime) return shrink({ buf: res.buf, mime });
  }
  return null;
}

const shrink = (icon) => (icon.mime === 'image/x-icon' && icon.buf.length > 24 * 1024 && trimIco(icon.buf)) || icon;

module.exports = { fetchSiteIcon, iconLinks, sniff, isPrivateHost, trimIco };
