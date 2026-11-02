// Appairage avec Pimkey (une fois par navigateur) : clés éphémères ECDH, code à 6 chiffres affiché ici et dans
// Pimkey, confirmé des deux côtés. Dans un onglet plutôt que dans le popup : il reste ouvert pendant qu'on passe
// dans Pimkey pour approuver.
import * as P from './lib/bridge.mjs';
import { loadPairing, savePairing, clearPairing } from './lib/store.js';
import { openPort, showPimkey, STATES, ping } from './lib/link.js';

const PAIR_TIMEOUT = 3 * 60e3;
const step = document.getElementById('step');

function view(...nodes) {
  step.replaceChildren(...nodes);
  step.style.display = 'flex';
  step.style.flexDirection = 'column';
  step.style.gap = '16px';
}
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const btn = (label, fn, primary) => {
  const b = el('button', `btn${primary ? ' primary' : ''}`, label);
  b.onclick = fn;
  return b;
};
const actions = (...b) => {
  const a = el('div', 'actions');
  a.append(...b);
  return a;
};

const browserName = () => (navigator.userAgentData?.brands || []).some((b) => /edge/i.test(b.brand)) ? 'Edge' : 'Chrome';

async function start() {
  const current = await loadPairing();
  const name = el('input');
  name.value = current?.name || browserName();
  name.maxLength = 60;
  const label = el('label', null, 'Nom de ce navigateur dans Pimkey');
  label.append(name);
  view(
    el('p', null, current
      ? `Cette extension est appairée avec Pimkey (« ${current.name} »). Appairer à nouveau remplace la clé actuelle.`
      : 'Pimkey doit être ouvert et déverrouillé. Un code s’affichera ici et dans Pimkey : vérifiez qu’il est identique, puis confirmez des deux côtés.'),
    label,
    actions(
      ...(current ? [btn('Oublier l’appairage', async () => { await clearPairing(); chrome.runtime.sendMessage({ type: 'paired' }); start(); })] : []),
      btn(current ? 'Appairer à nouveau' : 'Commencer', () => pair(name.value.trim() || browserName(), current?.id), true),
    ),
  );
}

function problem(title, text, retry, open) {
  view(el('p', 'error', title), el('p', null, text), actions(
    ...(open ? [btn('Ouvrir Pimkey', async () => { await showPimkey().catch(() => {}); })] : []),
    btn('Réessayer', retry, true),
  ));
}

// replaces : appairage actuel, que Pimkey retire une fois le nouveau approuvé
async function pair(name, replaces) {
  view(el('p', null, 'Connexion à Pimkey…'));
  const box = openPort();
  const retry = () => pair(name, replaces);
  try {
    if ((await ping(box)) === 'locked') return problem(STATES.locked.title, 'Déverrouillez Pimkey, puis réessayez.', retry, true);
    const own = await P.pairingKeyPair();
    box.post({ t: 'pair', name, commit: await P.sha256B64(own.pub), replaces });
    const r = await box.next(15e3);
    if (r.t === 'locked') return problem(STATES.locked.title, 'Déverrouillez Pimkey, puis réessayez.', retry, true);
    if (r.t === 'busy') return problem('Un autre appairage est en cours', 'Terminez-le ou refusez-le dans Pimkey, puis réessayez.', retry);
    if (r.t !== 'pair') throw new Error('Réponse inattendue de Pimkey.');
    box.post({ t: 'pair-key', pub: own.pub });
    const secret = await P.pairingSecret(own.privateKey, r.pub, own.pub, r.pub);
    const keys = await P.importPairKey(secret.key);
    const result = box.next(PAIR_TIMEOUT); // approbation dans Pimkey, ou refus

    await new Promise((resolve, reject) => {
      result.then((m) => m.t === 'pair-refused' && reject(new Error('refused')), () => {});
      view(
        el('p', null, 'Pimkey affiche maintenant une demande d’appairage. Vérifiez qu’il montre exactement ce code :'),
        el('div', 'code', P.formatCode(secret.code)),
        el('p', null, 'Si le code est différent, annulez : un autre programme essaie de s’intercaler.'),
        actions(
          btn('Annuler', () => reject(new Error('cancel'))),
          btn('Le code est identique', resolve, true),
        ),
      );
    });
    box.post({ t: 'pair-ok', mac: await P.sign(keys, 'pair-ext', own.pub, r.pub) });
    view(el('p', null, 'Confirmé ici. Approuvez maintenant dans la fenêtre de Pimkey…'));

    const done = await result;
    if (done.t === 'pair-refused') throw new Error('refused');
    if (done.t !== 'paired' || !(await P.verify(keys, done.mac, 'pair-app', done.id, own.pub, r.pub))) throw new Error('Pimkey n’a pas confirmé l’appairage.');
    await savePairing({ id: done.id, name, key: secret.key });
    await chrome.runtime.sendMessage({ type: 'paired' });
    view(
      el('p', 'success', `C’est fait : ${name} est appairé avec Pimkey.`),
      el('p', null, 'Sur la page de connexion d’un site enregistré dans Pimkey, cliquez sur l’icône Pimkey (dans le champ ou dans la barre du navigateur) puis sur l’identifiant à remplir.'),
      actions(btn('Fermer', () => window.close(), true)),
    );
  } catch (e) {
    if (e.message === 'cancel') return start();
    if (e.message === 'refused') return problem('Appairage refusé dans Pimkey', 'Rien n’a été enregistré.', retry);
    const s = STATES[e.state];
    problem(s?.title || 'Appairage impossible', s?.text || e.message, retry, e.state === 'absent');
  } finally {
    box.close();
  }
}

start();
