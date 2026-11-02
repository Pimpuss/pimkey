// Fusion de deux coffres (synchronisation par un dossier OneDrive, Google Drive, Dropbox, Syncthing…).
//
// Fusion à trois, élément par élément : chaque appareil retient la signature de chaque élément lors de sa dernière
// synchronisation (la « base »). Ce qui n'a pas bougé depuis la base cède la place à l'autre côté ; un élément absent
// d'un côté mais inchangé de l'autre depuis la base a été supprimé pour de bon, sans trace de suppression à garder.
// Contenu (nom, champs, pièces jointes…) et état (favori, corbeille) se fusionnent séparément : mettre en favori sur
// un appareil et modifier le mot de passe sur l'autre ne sont pas en conflit.
// Contenu modifié des deux côtés : la version modifiée en dernier l'emporte, l'autre est gardée à part, sous le nom
// « … (conflit) », pour ne jamais perdre un mot de passe.
const crypto = require('node:crypto');

// Écriture stable (clés triées) : même contenu, même signature, quel que soit l'ordre des propriétés
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
  : x));
const digest = (v) => crypto.createHash('sha256').update(canon(v)).digest('base64').slice(0, 22);

// État : favori, corbeille (metaAt : date du dernier changement d'état). Volatiles : résultats recalculés sur chaque
// appareil (fuites, rappels d'expiration), jamais source de conflit.
const META = ['favorite', 'deletedAt', 'metaAt'];
const VOLATILE = ['pwned', 'expiryNotice'];

const omit = (e, keys) => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k)));
const contentOf = (e) => omit(e, [...META, ...VOLATILE, 'updatedAt']);
const metaOf = (e) => ({ favorite: !!e.favorite, deletedAt: e.deletedAt || null });

// Signature d'un élément : [contenu, état]
const signature = (e) => [digest(contentOf(e)), digest(metaOf(e))];

const metaTime = (e) => Math.max(e.metaAt || 0, e.deletedAt || 0);

function mergePair(l, r, base) {
  const [cl, ml] = signature(l);
  const [cr, mr] = signature(r);
  const [cb, mb] = base || [];
  let src;
  let loser = null;
  if (cl === cr || cr === cb) src = l;
  else if (cl === cb) src = r;
  else {
    src = (r.updatedAt || 0) > (l.updatedAt || 0) ? r : l;
    loser = src === l ? r : l;
  }
  const meta = ml === mr || mr === mb ? l : ml === mb ? r : metaTime(r) > metaTime(l) ? r : l;
  const out = { ...omit(src, [...META, ...VOLATILE]), ...metaOf(meta) };
  if (!out.deletedAt) delete out.deletedAt;
  if (meta.metaAt) out.metaAt = meta.metaAt;
  // Volatiles : la vérification des fuites la plus récente, le rappel d'expiration le plus avancé
  const pwned = [l.pwned, r.pwned].filter(Boolean).sort((a, b) => b.at - a.at)[0];
  if (pwned) out.pwned = pwned;
  const notice = [l.expiryNotice, r.expiryNotice].filter(Boolean).sort((a, b) => b.stage - a.stage)[0];
  if (notice) out.expiryNotice = notice;
  return { entry: out, loser: loser && !loser.deletedAt ? loser : null };
}

// Version écartée d'un conflit : nouvel élément, sans les pièces jointes que la version gardée référence déjà
// (un fichier n'appartient qu'à un élément : le supprimer avec l'un ne doit pas l'enlever à l'autre)
function conflictCopy(loser, kept, now) {
  const keptIds = new Set((kept.attachments || []).map((a) => a.id));
  const copy = omit(loser, [...META, ...VOLATILE]);
  return {
    ...copy,
    id: crypto.randomUUID(),
    title: `${loser.title} (conflit)`.slice(0, 200),
    attachments: (loser.attachments || []).filter((a) => !keptIds.has(a.id)),
    favorite: false,
    updatedAt: now,
  };
}

// local, remote : listes d'éléments ; base : id → signature lors de la dernière synchronisation (vide la première fois :
// tout est gardé). → { entries, conflicts }
function mergeEntries(local, remote, base = {}, now = Date.now()) {
  const L = new Map(local.map((e) => [e.id, e]));
  const R = new Map(remote.map((e) => [e.id, e]));
  const ids = [...L.keys(), ...[...R.keys()].filter((id) => !L.has(id))];
  const same = (e, b) => { const s = signature(e); return s[0] === b[0] && s[1] === b[1]; };
  const entries = [];
  const copies = [];
  for (const id of ids) {
    const l = L.get(id);
    const r = R.get(id);
    const b = base[id];
    if (l && r) {
      const { entry, loser } = mergePair(l, r, b);
      entries.push(entry);
      if (loser) copies.push(conflictCopy(loser, entry, now));
    } else {
      // Présent d'un seul côté : nouveau, ou supprimé de l'autre côté (gardé s'il a été modifié depuis)
      const e = l || r;
      if (!b || !same(e, b)) entries.push(e);
    }
  }
  return { entries: [...entries, ...copies], conflicts: copies.length };
}

// Icônes des sites : la plus récemment cherchée
function mergeIcons(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (!out[k] || (v.at || 0) > (out[k].at || 0)) out[k] = v;
  return out;
}

module.exports = { mergeEntries, mergeIcons, signature, canon };
