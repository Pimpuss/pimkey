// Service worker de l'extension Pimkey : seul à parler à Pimkey. L'adresse d'une page est toujours celle que donne
// le navigateur (sender.url, cadres de l'onglet), jamais une adresse fournie par la page elle-même ; Pimkey ne
// propose et ne donne que les identifiants de ce site, et seulement après un clic de l'utilisateur.
import { baseDomain } from './lib/sitename.mjs';
import { LinkError, Session, showPimkey } from './lib/link.js';

const IDLE_CLOSE = 60e3; // port natif fermé après une minute sans demande
const OFFER_TTL = 2 * 60e3; // proposition d'enregistrer un identifiant saisi
const USER_TTL = 5 * 60e3; // identifiant saisi seul (connexion en deux étapes : identifiant, puis mot de passe)
const LOGIN_TTL = 60e3; // connexion directe en plusieurs étapes : étape suivante attendue

// ---------- Session avec Pimkey ----------

let session = null;
let opening = null;
let idle = null;

async function getSession() {
  if (session && !session.closed) return session;
  opening ||= Session.open().finally(() => { opening = null; });
  session = await opening;
  return session;
}

function dropSession() {
  session?.close();
  session = null;
}

async function request(op, params) {
  const s = await getSession();
  clearTimeout(idle);
  idle = setTimeout(dropSession, IDLE_CLOSE);
  return s.request(op, params);
}

const errorOf = (e) => ({ state: e instanceof LinkError ? e.state : 'error', code: e.code || null, message: e.message });

// ---------- Adresses ----------

function pageUrl(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

const siteOfUrl = (url) => baseDomain(pageUrl(url)?.hostname.replace(/^\[|\]$/g, '').replace(/^www\./, '') || '');

// ---------- Remplissage ----------

// Identifiants du site d'une page (sans secrets) ; otp : seulement ceux qui ont un code 2FA
async function candidates(url, otp) {
  const r = await request('list', { url });
  return { state: 'ready', site: r.site, name: r.name, secure: r.secure, entries: otp ? r.entries.filter((e) => e.totp) : r.entries };
}

// Remplissage demandé depuis le popup : Pimkey vérifie l'identifiant pour l'adresse de l'onglet, puis il est remis aux
// seuls cadres du même site (et pas en http si l'onglet est en https)
async function fillTab(tabId, id, allowInsecure) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const top = frames.find((f) => f.frameId === 0);
  const topUrl = top && pageUrl(top.url);
  if (!topUrl) throw new LinkError('request', 'Cette page n’est pas un site web.');
  const creds = await request('fill', { id, url: topUrl.href, allowInsecure: !!allowInsecure });
  const site = siteOfUrl(topUrl.href);
  let filled = 0;
  for (const f of frames) {
    const u = pageUrl(f.url);
    if (!u || siteOfUrl(u.href) !== site || (topUrl.protocol === 'https:' && u.protocol !== 'https:')) continue;
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'do-fill', origin: u.origin, creds: { username: creds.username, password: creds.password, totp: creds.totp } }, { frameId: f.frameId });
      filled += r?.filled || 0;
    } catch {
      // cadre sans script de contenu (page du navigateur, cadre en cours de chargement)
    }
  }
  return { filled };
}

// ---------- Connexion directe en plusieurs étapes ----------
// Après un choix dans la liste (vrai clic), la page passe à l'étape suivante (mot de passe, puis code 2FA) : le choix
// est retenu une minute pour cet onglet et ce site, et ne sert qu'une fois par étape. Rien de secret n'est gardé : seul
// l'identifiant de l'élément, Pimkey redonne les valeurs à la demande.

const loginKey = (tabId) => `login:${tabId}`;
const STAGES = ['password', 'otp'];

async function startLogin(s, { id, stage, allowInsecure }) {
  const site = siteOfUrl(s.url);
  if (typeof id !== 'string' || !STAGES.includes(stage) || !site) return {};
  await chrome.storage.session.set({ [loginKey(s.tab.id)]: { id, stage, site, allowInsecure: !!allowInsecure, at: Date.now() } });
  return {};
}

async function resumeLogin(s, { otp }) {
  const key = loginKey(s.tab.id);
  const p = (await chrome.storage.session.get(key))[key];
  if (!p || Date.now() - p.at > LOGIN_TTL || p.site !== siteOfUrl(s.url) || p.stage !== (otp ? 'otp' : 'password')) return {};
  await chrome.storage.session.remove(key);
  if (otp) return { code: (await request('totp', { id: p.id, url: s.url })).code };
  const r = await request('fill', { id: p.id, url: s.url, allowInsecure: p.allowInsecure });
  if (r.totp) await chrome.storage.session.set({ [key]: { ...p, stage: 'otp', at: Date.now() } });
  return { creds: { username: r.username, password: r.password } };
}

// ---------- Enregistrement d'un identifiant saisi ----------
// Le mot de passe saisi reste dans chrome.storage.session (en mémoire, réservé à l'extension) le temps de la
// proposition ; la page ne reçoit que le nom du site et l'identifiant.

const offerKey = (tabId) => `offer:${tabId}`;
const userKey = (tabId) => `user:${tabId}`;

async function neverSites() {
  return (await chrome.storage.local.get('never')).never || [];
}

const publicOffer = (o) => o && { kind: o.kind, site: o.site, title: o.title || o.site, username: o.username };

async function getOffer(tabId) {
  const o = (await chrome.storage.session.get(offerKey(tabId)))[offerKey(tabId)];
  if (o && Date.now() - o.at < OFFER_TTL) return o;
  if (o) await chrome.storage.session.remove(offerKey(tabId));
  return null;
}

// Connu de Pimkey (même site, identifiant et mot de passe) : aucune proposition ; sinon nouveau, ou mot de passe changé
async function classify(o) {
  try {
    const r = await request('check', { url: o.url, username: o.username, password: o.password });
    return r.status === 'known' ? null : { ...o, kind: r.status, entryId: r.entryId || null, title: r.title || o.site };
  } catch {
    return { ...o, kind: 'unknown' }; // Pimkey verrouillé ou fermé : on vérifiera à l'enregistrement
  }
}

async function captured(sender, { username, password }) {
  const pw = typeof password === 'string' ? password.slice(0, 4096) : '';
  const site = siteOfUrl(sender.url);
  if (!pw || !site || (await neverSites()).includes(site)) return {};
  const tabId = sender.tab.id;
  let user = typeof username === 'string' ? username.slice(0, 500).trim() : '';
  if (!user) {
    const prev = (await chrome.storage.session.get(userKey(tabId)))[userKey(tabId)];
    if (prev && prev.site === site && Date.now() - prev.at < USER_TTL) user = prev.username;
  }
  const offer = await classify({ url: sender.url, site, username: user, password: pw, at: Date.now() });
  if (!offer) {
    await chrome.storage.session.remove(offerKey(tabId));
    return {};
  }
  await chrome.storage.session.set({ [offerKey(tabId)]: offer });
  // Connexion sans changement de page (appli web) : le bandeau s'affiche tout de suite
  chrome.tabs.sendMessage(tabId, { type: 'offer', offer: publicOffer(offer) }, { frameId: 0 }).catch(() => {});
  return {};
}

async function answerOffer(tabId, action) {
  const o = await getOffer(tabId);
  if (!o) return { gone: true };
  if (action === 'never') {
    await chrome.storage.local.set({ never: [...new Set([...(await neverSites()), o.site])] });
  } else if (action === 'save') {
    let target = o;
    if (o.kind === 'unknown') {
      target = await classify(o);
      if (!target) {
        await chrome.storage.session.remove(offerKey(tabId));
        return { known: true };
      }
      if (target.kind === 'unknown') throw new LinkError('locked');
    }
    const r = await request('save', { url: o.url, username: o.username, password: o.password, entryId: target.kind === 'changed' ? target.entryId : undefined });
    await chrome.storage.session.remove(offerKey(tabId));
    return { saved: true, updated: r.updated };
  }
  await chrome.storage.session.remove(offerKey(tabId));
  return {};
}

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove([offerKey(tabId), userKey(tabId), loginKey(tabId)]));

// ---------- Messages ----------

const openPair = () => chrome.tabs.create({ url: chrome.runtime.getURL('pair.html') });

// Depuis une page (script de contenu) : l'adresse est celle du cadre, donnée par le navigateur
const FROM_PAGE = {
  candidates: (m, s) => candidates(s.url, !!m.otp),
  fill: async (m, s) => {
    const r = await request('fill', { id: m.id, url: s.url, allowInsecure: !!m.allowInsecure });
    return { username: r.username, password: r.password, totp: r.totp };
  },
  otp: async (m, s) => ({ code: (await request('totp', { id: m.id, url: s.url })).code }),
  startLogin: (m, s) => startLogin(s, m),
  resumeLogin: (m, s) => resumeLogin(s, m),
  captured: (m, s) => captured(s, m),
  // Identifiant seul (première étape d'une connexion en deux temps), gardé pour la proposition d'enregistrement
  capturedUser: async (m, s) => {
    const username = typeof m.username === 'string' ? m.username.slice(0, 500).trim() : '';
    if (username) await chrome.storage.session.set({ [userKey(s.tab.id)]: { site: siteOfUrl(s.url), username, at: Date.now() } });
    return {};
  },
  offer: async (m, s) => (s.frameId === 0 ? { offer: publicOffer(await getOffer(s.tab.id)) } : {}),
  answerOffer: (m, s) => (s.frameId === 0 ? answerOffer(s.tab.id, m.action) : {}),
  openPimkey: () => showPimkey().then(() => ({})),
  openPair: () => openPair().then(() => ({})),
};

// Depuis les pages de l'extension (popup, appairage)
const FROM_EXTENSION = {
  popupState: async ({ tabId }) => {
    const tab = await chrome.tabs.get(tabId);
    if (!pageUrl(tab.url)) return { state: 'nopage' };
    return candidates(tab.url, false);
  },
  fillTab: ({ tabId, id, allowInsecure }) => fillTab(tabId, id, allowInsecure),
  copy: async ({ tabId, id, field }) => {
    const tab = await chrome.tabs.get(tabId);
    return request('copy', { id, url: tab.url, field });
  },
  openPimkey: () => showPimkey().then(() => ({})),
  openPair: () => openPair().then(() => ({})),
  // Appairage terminé ou effacé : la session suivante utilisera la nouvelle clé
  paired: async () => { dropSession(); return {}; },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const own = sender.url?.startsWith(chrome.runtime.getURL(''));
  const fromPage = !own && sender.tab && pageUrl(sender.url);
  const handler = own ? FROM_EXTENSION[msg?.type] : fromPage ? FROM_PAGE[msg?.type] : null;
  if (!handler) return false;
  Promise.resolve().then(() => handler(msg, sender)).then(sendResponse, (e) => sendResponse({ error: errorOf(e) }));
  return true;
});
