// Script de contenu de Pimkey, dans chaque cadre des pages web : repère les champs de connexion, y place l'icône
// Pimkey, remplit après un clic, et propose d'enregistrer un identifiant saisi.
// - Rien n'est rempli sans un vrai clic (événement isTrusted) sur l'interface de Pimkey ou sur le popup.
// - La liste des comptes ne contient ni mot de passe ni code ; elle s'affiche dans un shadow DOM fermé, que les
//   scripts de la page ne peuvent pas lire.
(() => {
  if (globalThis.__pimkeyContent) return;
  globalThis.__pimkeyContent = true;

  // Extension rechargée ou mise à jour : ce script n'est plus relié à elle tant que la page n'est pas actualisée
  const send = async (msg) => {
    try {
      return (await chrome.runtime.sendMessage(msg)) || {};
    } catch {
      return { error: { state: 'error', message: 'Extension Pimkey mise à jour : actualisez la page.' } };
    }
  };
  const TOP = window === window.top;

  // ---------- Champs de connexion ----------

  const USER_HINT = /user|login|e-?mail|mail|identifiant|account|compte|pseudo|phone|t[ée]l[ée]phone/i;
  const OTP_HINT = /otp|totp|2fa|mfa|one.?time|verification|v[ée]rification|security.?code|auth.*code|code/i;

  function visible(el) {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 12) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
  }
  const usable = (el) => el instanceof HTMLInputElement && !el.disabled && !el.readOnly && visible(el);
  const hint = (el) => [el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label')].join(' ');
  const isText = (el) => ['text', 'email', 'tel', 'number', 'search'].includes(el.type);
  const isPassword = (el) => el.type === 'password';
  function isOtp(el) {
    if (!isText(el)) return false;
    if (/one-time-code/i.test(el.autocomplete)) return true;
    return OTP_HINT.test(hint(el)) && !/mail|user|login/i.test(hint(el))
      && ((el.maxLength >= 4 && el.maxLength <= 10) || el.inputMode === 'numeric' || el.type === 'number' || /\\d|\[0-9\]/.test(el.pattern));
  }
  function isUsername(el) {
    if (!isText(el) || el.type === 'search' || el.type === 'number' || isOtp(el)) return false;
    return /username|email/i.test(el.autocomplete) || el.type === 'email' || USER_HINT.test(hint(el));
  }
  const scopeOf = (el) => el?.form || el?.closest?.('form') || document;
  const inputs = (scope) => [...scope.querySelectorAll('input')].filter(usable);
  const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  // Champs à remplir autour d'un champ (ou de la page) : { username, password, otp }
  function loginFields(anchor) {
    const list = inputs(scopeOf(anchor));
    const password = anchor && isPassword(anchor) ? anchor : list.find(isPassword) || null;
    let username = null;
    if (password) {
      const prev = list.filter((el) => isText(el) && !isOtp(el) && el.type !== 'search' && before(el, password)).reverse();
      username = prev.find(isUsername) || prev[0] || null;
    } else {
      username = anchor && isUsername(anchor) ? anchor : list.find(isUsername) || null;
    }
    const otp = anchor && isOtp(anchor) ? anchor : list.find(isOtp) || null;
    return { username, password, otp };
  }

  // Le champ mérite-t-il l'icône ? Mot de passe, code 2FA, ou identifiant d'un formulaire de connexion
  function kindOf(el) {
    if (!usable(el)) return null;
    if (isPassword(el)) return /new-password/i.test(el.autocomplete) ? null : 'login';
    if (isOtp(el)) return 'otp';
    if (!isUsername(el)) return null;
    const list = inputs(scopeOf(el));
    if (list.some(isPassword) || /username/i.test(el.autocomplete)) return 'login';
    // Première étape d'une connexion en deux temps : formulaire court
    return scopeOf(el) !== document && list.filter((x) => isText(x)).length <= 2 ? 'login' : null;
  }

  // Valeur posée comme une saisie : l'appli de la page (React, Vue, Angular…) voit le changement
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  function setValue(el, value) {
    el.focus({ preventScroll: true });
    valueSetter.call(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fill(creds, anchor) {
    const f = loginFields(anchor);
    let n = 0;
    if (f.username && creds.username) { setValue(f.username, creds.username); n++; }
    if (f.otp && creds.totp) { setValue(f.otp, creds.totp); n++; }
    if (f.password && creds.password) { setValue(f.password, creds.password); n++; }
    return n;
  }

  // ---------- Interface (shadow DOM fermé) ----------

  const LOGO = '<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#141a33"/><path d="M256 84C298 106 344 116 384 118Q398 119 398 133L398 238C398 330 340 394 256 432C172 394 114 330 114 238L114 133Q114 119 128 118C168 116 214 106 256 84Z" fill="#fff"/><circle cx="256" cy="220" r="40" fill="#7c5cff"/><path d="M238 244H274L285 318Q287 334 271 334H241Q225 334 227 318Z" fill="#7c5cff"/></svg>';
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
    .icon { position: fixed; z-index: 2147483647; width: 22px; height: 22px; padding: 2px; border: 0; border-radius: 6px; background: transparent;
      cursor: pointer; opacity: .85; display: none; }
    .icon:hover { opacity: 1; background: rgba(124, 92, 255, .15); }
    .icon svg, .logo svg { width: 100%; height: 100%; display: block; }
    .menu, .banner { position: fixed; z-index: 2147483647; background: #141725; color: #eceef8; border: 1px solid #2c3150; border-radius: 12px;
      box-shadow: 0 18px 50px rgba(0, 0, 0, .45); font-size: 13px; line-height: 1.35; overflow: hidden; }
    .menu { width: 300px; max-height: 340px; overflow-y: auto; padding: 6px; display: none; }
    .head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 8px; color: #9195b0; font-size: 12px; }
    .logo { width: 18px; height: 18px; flex: none; }
    .row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px; border: 0; border-radius: 8px; background: none; color: inherit; text-align: left; cursor: pointer; font-size: 13px; }
    .row:hover, .row:focus-visible { background: #22273d; outline: none; }
    .av { width: 28px; height: 28px; border-radius: 7px; flex: none; display: grid; place-items: center; overflow: hidden; background: #2a2f4a; color: #fff; font-weight: 650; }
    .av.img { background: #fff; padding: 3px; }
    .av img { width: 100%; height: 100%; object-fit: contain; }
    .txt { min-width: 0; flex: 1; }
    .txt b, .txt span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .txt b { font-weight: 600; }
    .txt span { color: #9195b0; font-size: 12px; }
    .msg { padding: 8px 10px 10px; color: #c5c8dc; }
    .msg b { display: block; color: #eceef8; margin-bottom: 3px; }
    .warn { color: #f3dca0; }
    .btns { display: flex; gap: 8px; padding: 0 10px 10px; flex-wrap: wrap; }
    button.b { height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid #2c3150; background: #1a1e30; color: #eceef8; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    button.b:hover { background: #22273d; }
    button.b.p { background: linear-gradient(135deg, #7c5cff, #3ec5f0); border: 0; color: #fff; }
    button.link { border: 0; background: none; color: #9195b0; font-size: 12px; cursor: pointer; padding: 4px 0; text-decoration: underline; }
    .banner { top: 16px; right: 16px; width: 340px; padding: 4px 0 0; }
    .banner .head { color: #eceef8; font-size: 13.5px; font-weight: 600; padding: 10px 12px 4px; }
    .banner .close { margin-left: auto; border: 0; background: none; color: #9195b0; font-size: 18px; cursor: pointer; line-height: 1; }
  `;

  let root = null;
  let host = null;
  function ui() {
    if (root) return root;
    host = document.createElement('pimkey-ui');
    host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
    root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = `<button class="icon" title="Remplir avec Pimkey">${LOGO}</button><div class="menu" role="listbox"></div>`;
    // Un clic dans l'interface ne retire pas le focus du champ de la page
    root.addEventListener('mousedown', (e) => e.preventDefault());
    root.querySelector('.icon').addEventListener('click', (e) => { if (e.isTrusted) toggleMenu(); });
    document.documentElement.appendChild(host);
    return root;
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  // Clic réel de l'utilisateur seulement : un clic simulé par la page ne déclenche rien
  const onClick = (node, fn) => node.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
  const button = (label, fn, primary) => {
    const b = el('button', `b${primary ? ' p' : ''}`, label);
    onClick(b, fn);
    return b;
  };

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

  // ---------- Icône dans le champ ----------

  let target = null; // champ actif
  let targetKind = null;
  let menuOpen = false;

  function place() {
    if (!root) return;
    const icon = root.querySelector('.icon');
    const menu = root.querySelector('.menu');
    if (!target || !target.isConnected || !visible(target)) {
      icon.style.display = 'none';
      menu.style.display = 'none';
      menuOpen = false;
      return;
    }
    const r = target.getBoundingClientRect();
    icon.style.display = 'block';
    icon.style.left = `${Math.round(r.right - 28)}px`;
    icon.style.top = `${Math.round(r.top + (r.height - 22) / 2)}px`;
    if (menuOpen) {
      menu.style.display = 'block';
      const w = Math.max(300, Math.min(r.width, 380));
      menu.style.width = `${w}px`;
      menu.style.left = `${Math.round(Math.max(8, Math.min(r.left, innerWidth - w - 8)))}px`;
      const h = menu.offsetHeight;
      const below = r.bottom + 6 + h <= innerHeight || r.top - 6 - h < 0;
      menu.style.top = `${Math.round(below ? r.bottom + 6 : r.top - 6 - h)}px`;
    } else menu.style.display = 'none';
  }

  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); };

  function setTarget(input) {
    const kind = input && kindOf(input);
    if (!kind) return;
    if (input !== target) closeMenu();
    target = input;
    targetKind = kind;
    ui();
    place();
  }

  function closeMenu() {
    menuOpen = false;
    if (root) root.querySelector('.menu').replaceChildren();
    schedule();
  }

  function toggleMenu() {
    if (menuOpen) return closeMenu();
    menuOpen = true;
    loadMenu();
  }

  function menuHead(text) {
    const h = el('div', 'head');
    const logo = el('span', 'logo');
    logo.innerHTML = LOGO;
    h.append(logo, el('span', null, text));
    return h;
  }

  // Pimkey absent, verrouillé, extension pas appairée… : explication et bouton
  function stateView(err) {
    const box = el('div');
    const STATE_TEXT = {
      nohost: ['Pimkey n’est pas prêt', 'Activez « Extension Chrome et Edge » dans Pimkey › Paramètres.'],
      absent: ['Pimkey n’est pas ouvert', 'Ouvrez-le pour utiliser vos identifiants.'],
      locked: ['Pimkey est verrouillé', 'Déverrouillez-le pour utiliser vos identifiants.'],
      unpaired: ['Extension pas encore appairée', 'Approuvez-la une fois dans Pimkey.'],
      impostor: ['Ce n’est pas votre Pimkey', 'Rien n’a été envoyé. Appairez à nouveau l’extension.'],
    };
    const [title, text] = STATE_TEXT[err.state] || ['Pimkey ne répond pas', err.message || 'Réessayez dans un instant.'];
    const msg = el('div', 'msg');
    msg.append(el('b', null, title), el('span', null, text));
    box.append(msg);
    const btns = el('div', 'btns');
    if (err.state === 'absent' || err.state === 'locked') btns.append(button('Ouvrir Pimkey', () => { send({ type: 'openPimkey' }); closeMenu(); }, true));
    if (err.state === 'unpaired' || err.state === 'impostor') btns.append(button('Appairer', () => { send({ type: 'openPair' }); closeMenu(); }, true));
    if (btns.children.length) box.append(btns);
    return box;
  }

  async function loadMenu() {
    const menu = ui().querySelector('.menu');
    const otp = targetKind === 'otp';
    menu.replaceChildren(menuHead('Pimkey…'));
    schedule();
    const anchor = target;
    const r = await send({ type: 'candidates', otp });
    if (!menuOpen || target !== anchor) return;
    menu.replaceChildren();
    if (r.error) {
      menu.append(menuHead('Pimkey'), stateView(r.error));
    } else {
      menu.append(menuHead(otp ? `Code 2FA · ${r.name}` : r.name));
      if (!r.entries.length) {
        const m = el('div', 'msg', otp ? 'Aucun identifiant de ce site n’a de code 2FA dans Pimkey.' : `Aucun identifiant pour ${r.site} dans Pimkey.`);
        menu.append(m);
      }
      for (const entry of r.entries) {
        const row = el('button', 'row');
        row.setAttribute('role', 'option');
        const txt = el('span', 'txt');
        txt.append(el('b', null, entry.title), el('span', null, otp ? 'Remplir le code 2FA' : entry.username || '(sans identifiant)'));
        row.append(avatar(entry), txt);
        onClick(row, () => (otp ? fillOtp(entry) : choose(entry, anchor)));
        menu.append(row);
      }
    }
    schedule();
  }

  // Page en http alors que l'identifiant est pour https : confirmation avant d'envoyer le mot de passe
  function confirmInsecure(entry, go) {
    const menu = root.querySelector('.menu');
    const msg = el('div', 'msg warn');
    msg.append(el('b', null, 'Page non chiffrée (http)'), el('span', null, `Le mot de passe de « ${entry.title} » circulerait en clair sur le réseau.`));
    const btns = el('div', 'btns');
    btns.append(button('Annuler', closeMenu), button('Remplir quand même', go, true));
    menu.replaceChildren(menuHead('Pimkey'), msg, btns);
    schedule();
  }

  async function choose(entry, anchor, allowInsecure = false) {
    if (entry.insecure && !allowInsecure) return confirmInsecure(entry, () => choose(entry, anchor, true));
    const r = await send({ type: 'fill', id: entry.id, allowInsecure });
    if (r.error) {
      ui().querySelector('.menu').replaceChildren(menuHead('Pimkey'), stateView(r.error));
      return schedule();
    }
    closeMenu();
    fill(r, anchor);
  }

  async function fillOtp(entry) {
    const anchor = target;
    const r = await send({ type: 'otp', id: entry.id });
    if (r.error) {
      ui().querySelector('.menu').replaceChildren(menuHead('Pimkey'), stateView(r.error));
      return schedule();
    }
    closeMenu();
    setValue(anchor, r.code);
  }

  document.addEventListener('focusin', (e) => {
    const t = e.composedPath?.()[0] || e.target;
    if (t instanceof HTMLInputElement) setTarget(t);
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (menuOpen && !e.composedPath().includes(host) && e.composedPath()[0] !== target) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen) closeMenu(); }, true);
  addEventListener('scroll', schedule, { capture: true, passive: true });
  addEventListener('resize', schedule, { passive: true });

  // Au chargement et quand la page change (applis web) : icône sur le premier champ de connexion visible
  function scan() {
    if (target && target.isConnected && kindOf(target)) return schedule();
    target = null;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && kindOf(active)) return setTarget(active);
    const first = [...document.querySelectorAll('input')].find((x) => kindOf(x));
    if (first) setTarget(first);
    else schedule();
  }
  // Au plus un passage toutes les 300 ms, même sur une page qui s'anime sans arrêt
  let scanTimer = 0;
  new MutationObserver(() => {
    scanTimer ||= setTimeout(() => { scanTimer = 0; scan(); }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'style', 'class', 'hidden'] });
  scan();

  // ---------- Remplissage depuis le popup ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'do-fill') {
      // Le cadre a pu changer de site entre-temps : seulement l'origine prévue par l'extension
      if (location.origin !== msg.origin) return sendResponse({ filled: 0 }), false;
      const active = document.activeElement instanceof HTMLInputElement && kindOf(document.activeElement) ? document.activeElement : null;
      sendResponse({ filled: fill(msg.creds, active) });
    } else if (msg?.type === 'offer' && TOP && msg.offer) showBanner(msg.offer);
    return false;
  });

  // ---------- Identifiant saisi : proposition d'enregistrement ----------

  let lastCapture = '';
  function capture(from) {
    const scope = scopeOf(from);
    const pw = [...scope.querySelectorAll('input[type=password]')].find((x) => x.value && visible(x))
      || (scope !== document ? null : [...document.querySelectorAll('input[type=password]')].find((x) => x.value && visible(x)));
    if (!pw) {
      // Connexion en deux temps : l'identifiant d'abord, le mot de passe sur la page suivante
      const user = inputs(scope).find((x) => isUsername(x) && x.value);
      if (user) send({ type: 'capturedUser', username: user.value });
      return;
    }
    const { username } = loginFields(pw);
    const key = `${username?.value || ''}\n${pw.value}`;
    if (key === lastCapture) return;
    lastCapture = key;
    send({ type: 'captured', username: username?.value || '', password: pw.value });
  }
  const SUBMIT_TEXT = /log ?in|sign ?in|connexion|connecter|identifier|valider|continuer|suivant|next|submit|envoyer|ok\b/i;
  function looksSubmit(b) {
    if (b.matches('input[type=submit], button[type=submit]')) return true;
    if (b.tagName === 'BUTTON' && b.form && !['button', 'reset'].includes(b.type)) return true;
    return SUBMIT_TEXT.test(`${b.textContent} ${b.value || ''} ${b.getAttribute('aria-label') || ''}`.slice(0, 200));
  }
  document.addEventListener('submit', (e) => { if (e.isTrusted) capture(e.target); }, true);
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const b = e.composedPath()[0]?.closest?.('button, input[type=submit], input[type=button], [role=button], a');
    if (b && looksSubmit(b)) capture(b);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.isTrusted && e.key === 'Enter' && e.target instanceof HTMLInputElement && (isPassword(e.target) || isUsername(e.target))) capture(e.target);
  }, true);

  let banner = null;
  function showBanner(offer) {
    ui();
    banner?.remove();
    banner = el('div', 'banner');
    const head = el('div', 'head');
    const logo = el('span', 'logo');
    logo.innerHTML = LOGO;
    const close = el('button', 'close', '×');
    close.title = 'Plus tard';
    onClick(close, () => answer('dismiss'));
    head.append(logo, el('span', null, offer.kind === 'changed' ? 'Mettre à jour le mot de passe ?' : 'Enregistrer dans Pimkey ?'), close);
    const msg = el('div', 'msg');
    msg.append(el('b', null, offer.kind === 'changed' ? offer.title : offer.site), el('span', null, offer.username || '(sans identifiant)'));
    const btns = el('div', 'btns');
    btns.append(
      button(offer.kind === 'changed' ? 'Mettre à jour' : 'Enregistrer', () => answer('save'), true),
      button('Plus tard', () => answer('dismiss')),
    );
    const never = el('button', 'link', 'Jamais pour ce site');
    onClick(never, () => answer('never'));
    btns.append(never);
    banner.append(head, msg, btns);
    root.append(banner);

    async function answer(action) {
      const r = await send({ type: 'answerOffer', action });
      if (r.error) {
        btns.replaceChildren(...stateView(r.error).querySelector('.btns')?.children || [], button('Réessayer', () => answer(action)));
        msg.replaceChildren(el('b', null, r.error.state === 'locked' ? 'Pimkey est verrouillé' : 'Enregistrement impossible'),
          el('span', null, r.error.state === 'locked' ? 'Déverrouillez-le, puis réessayez.' : r.error.message));
        return;
      }
      if (action !== 'save') return banner.remove();
      msg.replaceChildren(el('b', null, r.known ? 'Déjà dans Pimkey' : r.updated ? 'Mot de passe mis à jour' : 'Enregistré dans Pimkey'));
      btns.remove();
      setTimeout(() => banner.remove(), 2500);
    }
  }

  if (TOP) send({ type: 'offer' }).then((r) => r?.offer && showBanner(r.offer));
})();
