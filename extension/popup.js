// Popup : identifiants du site de l'onglet ; un clic remplit identifiant, mot de passe (et code 2FA si le champ est
// là). Copier passe par le presse-papiers de Pimkey (exclu de l'historique Win + V, vidé après le délai réglé).
import { STATES } from './lib/link.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const svg = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ICONS = {
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  key: svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>'),
  otp: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M10 2h4"/>'),
};

let tab = null;

function note(text, kind = '') {
  document.querySelector('.note')?.remove();
  const n = el('div', `note ${kind}`, text);
  $('main').prepend(n);
}

function stateView(err) {
  const s = STATES[err.state] || { title: 'Pimkey ne répond pas', text: err.message };
  const box = el('div', `state ${err.state === 'impostor' ? 'warn' : ''}`);
  box.append(el('b', null, s.title), el('p', null, err.state === 'request' ? err.message : s.text));
  const actions = el('div');
  if (s.action === 'open') {
    const b = el('button', 'btn primary', 'Ouvrir Pimkey');
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = 'Ouverture…';
      await send({ type: 'openPimkey' });
      window.close();
    };
    actions.append(b);
  } else if (s.action === 'pair') {
    const b = el('button', 'btn primary', 'Appairer avec Pimkey');
    b.onclick = () => { send({ type: 'openPair' }); window.close(); };
    actions.append(b);
  }
  if (actions.children.length) box.append(actions);
  return box;
}

function avatar(entry) {
  const a = el('span', 'av');
  if (entry.icon) {
    a.classList.add('img');
    const img = el('img');
    img.src = entry.icon;
    img.alt = '';
    a.append(img);
  } else a.textContent = (entry.title.trim()[0] || '?').toUpperCase();
  return a;
}

async function fillEntry(entry, allowInsecure = false) {
  if (entry.insecure && !allowInsecure) {
    note(`Page non chiffrée (http) : le mot de passe de « ${entry.title} » circulerait en clair. Cliquez à nouveau pour remplir quand même.`, 'warn');
    entry.insecure = false;
    entry.confirmed = true;
    return;
  }
  const r = await send({ type: 'fillTab', tabId: tab.id, id: entry.id, allowInsecure: allowInsecure || !!entry.confirmed });
  if (r.error) return render({ error: r.error });
  if (!r.filled) return note('Aucun champ de connexion trouvé sur cette page : copiez l’identifiant et le mot de passe avec les boutons.');
  window.close();
}

async function copy(entry, field, label) {
  const r = await send({ type: 'copy', tabId: tab.id, id: entry.id, field });
  if (r.error) return note(r.error.message, 'warn');
  note(r.seconds ? `${label} copié : effacé du presse-papiers dans ${r.seconds} s.` : `${label} copié.`, 'ok');
}

function render(r) {
  const main = $('main');
  main.replaceChildren();
  if (r.state === 'nopage') {
    const box = el('div', 'state');
    box.append(el('b', null, 'Aucun site ici'), el('p', null, 'Ouvrez la page de connexion d’un site pour y remplir vos identifiants.'));
    return main.append(box);
  }
  if (r.error) return main.append(stateView(r.error));
  $('site').textContent = r.name === r.site ? r.site : `${r.name} · ${r.site}`;
  if (!r.entries.length) {
    const box = el('div', 'state');
    box.append(el('b', null, 'Aucun identifiant pour ce site'), el('p', null, `Pimkey ne propose que les identifiants dont le lien est sur ${r.site}.`));
    return main.append(box);
  }
  if (!r.secure) note('Page non chiffrée (http).', 'warn');
  for (const entry of r.entries) {
    const row = el('div', 'entry');
    const fill = el('button', 'fill');
    fill.title = 'Remplir';
    const txt = el('span', 'txt');
    txt.append(el('b', null, entry.title), el('span', null, entry.username || '(sans identifiant)'));
    fill.append(avatar(entry), txt);
    fill.onclick = () => fillEntry(entry);
    row.append(fill);
    const tool = (icon, title, field) => {
      const b = el('button', 'ico');
      b.innerHTML = ICONS[icon];
      b.title = title;
      b.onclick = () => copy(entry, field, title.replace(/^Copier (le |l’)?/, '').replace(/^./, (c) => c.toUpperCase()));
      row.append(b);
    };
    if (entry.username) tool('user', 'Copier l’identifiant', 'username');
    if (entry.hasPassword) tool('key', 'Copier le mot de passe', 'password');
    if (entry.totp) tool('otp', 'Copier le code 2FA', 'totp');
    main.append(row);
  }
}

$('open').onclick = async () => { await send({ type: 'openPimkey' }); window.close(); };
$('pair').onclick = () => { send({ type: 'openPair' }); window.close(); };

[tab] = await chrome.tabs.query({ active: true, currentWindow: true });
try {
  $('site').textContent = new URL(tab.url).hostname;
} catch {}
render(await send({ type: 'popupState', tabId: tab.id }));
