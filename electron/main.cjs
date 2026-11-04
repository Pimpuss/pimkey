// Pimkey : fenêtre, IPC, verrouillage automatique et presse-papiers.
// Les secrets ne quittent le processus principal que pour être affichés, après confirmation du mot de passe
// maître ; la copie passe directement par le presse-papiers, sans transiter par l'interface.
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, powerMonitor, nativeImage, session, Notification, Tray, Menu } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Vault, siteOf } = require('./vault.cjs');
const { Settings } = require('./settings.cjs');
const { fetchSiteIcon, isPrivateHost } = require('./favicon.cjs');
const { readCsv } = require('./importer.cjs');
const { Bridge, register, unregister, registration, EXTENSION_IDS } = require('./bridge.cjs');
const hello = process.platform === 'win32' ? require('./hello.cjs') : null;
// Icône donnée à la fenêtre Windows Hello : celle de Pimkey.exe une fois installé, le .ico du projet en développement
const helloIcon = () => (app.isPackaged ? process.execPath : path.join(__dirname, '..', 'build', 'icon.ico'));
const { baseDomain, guessDomains } = require('../shared/sitename.mjs');

// Développement seulement : coffre de test dans un autre dossier (PIMKEY_DATA_DIR), sans toucher au vrai.
// Avant le verrou d'instance unique, qui dépend de ce dossier.
if (!app.isPackaged && process.env.PIMKEY_DATA_DIR) app.setPath('userData', path.resolve(process.env.PIMKEY_DATA_DIR));

if (!app.requestSingleInstanceLock()) app.quit();

const MAX_ATTACHMENT = 25 * 1024 * 1024;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };

let win = null;
let vault = null;
let settings = null;
let lastActivity = Date.now();
let clip = { value: null, timer: null };
let pendingRestore = null;
let pendingImport = null; // éléments lus dans un CSV, en attente de confirmation (en clair : oubliés au verrouillage)
let masterOkAt = 0; // dernière confirmation réussie du mot de passe maître (délai de grâce)
let helloOkAt = 0; // confirmation par Windows Hello, valable pour l'action qui la suit immédiatement

// Mot de passe maître pour afficher un secret : sans mot de passe (master vide), accepté seulement juste après
// une confirmation Windows Hello, ou dans le délai de grâce qui suit une confirmation réussie ; l'interface affiche
// alors la demande (erreur MASTER_REQUIRED)
async function confirmMaster(master) {
  const grace = settings.data.masterGraceMinutes * 60e3;
  if (!master) {
    const hello = helloOkAt && Date.now() - helloOkAt < 30e3;
    helloOkAt = 0;
    if (hello) return;
    if (grace > 0 && masterOkAt && Date.now() - masterOkAt < grace) return;
    throw new Error('MASTER_REQUIRED');
  }
  if (!(await vault.verify(master))) throw new Error('Mot de passe maître incorrect.');
  masterOkAt = Date.now();
}

const winAlive = () => !!win && !win.isDestroyed();
const send = (channel, payload) => {
  if (winAlive() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
};

// En développement (npm run dev), la fenêtre reste visible dans les captures et partages d'écran (Discord…)
const hideFromCapture = () => app.isPackaged && settings.data.hideFromCapture;

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#0a0b12',
    title: 'Pimkey',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0b12', symbolColor: '#9ea2bd', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setContentProtection(hideFromCapture());
  win.once('ready-to-show', () => win.show());
  win.on('minimize', () => settings.data.lockOnMinimize && lock('minimize'));
  // ✕ : Pimkey reste dans la zone de notification, coffre verrouillé (réglage) ; Quitter depuis son menu
  win.on('close', (e) => {
    if (quitting || !settings.data.closeToTray || !tray) return;
    e.preventDefault();
    win.hide();
    lock('tray');
  });
  // Liens externes : navigateur par défaut ; l'interface ne quitte jamais sa propre page
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!process.env.VITE_DEV_SERVER_URL || !url.startsWith(process.env.VITE_DEV_SERVER_URL)) e.preventDefault();
  });
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// ---------- Mises à jour ----------
// App installée seulement : vérification au démarrage puis toutes les 6 h sur les releases GitHub (package.json,
// build.publish), téléchargement en arrière-plan, installation au redémarrage proposé par l'interface ou à la sortie.

let update = { state: app.isPackaged ? 'idle' : 'dev' };
const setUpdate = (patch) => { update = { ...update, ...patch }; send('update', update); };

function setupUpdates() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'latest', checkedAt: Date.now() }));
  autoUpdater.on('update-available', (i) => setUpdate({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => setUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => setUpdate({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => {
    const msg = String(e?.message || e).split('\n')[0];
    const error = /\b404\b/.test(msg) ? 'aucune version publiée sur GitHub pour le moment'
      : /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|net::/.test(msg) ? 'pas de connexion à Internet' : msg;
    setUpdate({ state: 'error', error });
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10e3);
  setInterval(check, 6 * 3600e3);
  return { check, install: () => { quitting = true; autoUpdater.quitAndInstall(); } };
}
let updater = null;

// ---------- Zone de notification ----------

let tray = null;
let quitting = false; // Quitter (menu, mise à jour, arrêt de Windows) : la fenêtre se ferme vraiment

function showWindow() {
  if (!winAlive()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Icône nette à 100 % et 200 % d'affichage (16 et 32 px)
function trayImage() {
  const src = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
  const img = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const size = 16 * scaleFactor;
    img.addRepresentation({ scaleFactor, width: size, height: size, buffer: src.resize({ width: size, height: size, quality: 'best' }).toPNG() });
  }
  return img;
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('Pimkey');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Ouvrir Pimkey', click: showWindow },
    { label: 'Verrouiller', enabled: !!vault?.unlocked, click: () => lock('manual') },
    { type: 'separator' },
    { label: 'Quitter Pimkey', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.on('click', showWindow);
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
}

// ---------- Verrouillage ----------

function lock(reason) {
  if (!vault.unlocked) return;
  if (syncTimer) runSync(); // dernière modification envoyée avant d'oublier la clé
  vault.lock();
  bridge?.dropSessions();
  pendingImport = null;
  masterOkAt = 0;
  helloOkAt = 0;
  clearClipboard();
  send('locked', reason);
}

function watchIdle() {
  setInterval(() => {
    const min = settings.data.autoLockMinutes;
    if (vault.unlocked && min > 0 && Date.now() - lastActivity > min * 60e3) lock('idle');
  }, 10e3);
  const onSystemLock = () => settings.data.lockOnSystemLock && lock('system');
  powerMonitor.on('lock-screen', onSystemLock);
  powerMonitor.on('suspend', onSystemLock);
  // Coffre laissé ouvert plusieurs jours : la copie quotidienne et les rappels d'expiration se font quand même
  setInterval(() => { autoBackup(); notifyExpiries(); }, 3600e3);
}

// ---------- Presse-papiers ----------

// Vidé après le délai choisi, seulement s'il contient encore ce que Pimkey y a mis
function clearClipboard() {
  clearTimeout(clip.timer);
  if (clip.value != null && clipboard.readText() === clip.value) clipboard.clear();
  clip = { value: null, timer: null };
}

// Sous Windows, copie exclue de l'historique Win + V et du presse-papiers cloud ; copie ordinaire si l'appel échoue
let privateClipboard = null;
if (process.platform === 'win32') {
  try { privateClipboard = require('./clipboard-win.cjs'); } catch (e) { console.warn('Copie privée indisponible :', e.message); }
}

function copy(value) {
  clearTimeout(clip.timer);
  try {
    privateClipboard.writePrivateText(value, winAlive() ? win.getNativeWindowHandle() : 0);
  } catch {
    clipboard.writeText(value);
  }
  clip.value = value;
  const s = settings.data.clipboardSeconds;
  if (s > 0) clip.timer = setTimeout(clearClipboard, s * 1000);
  return s;
}

function addAttachment(entryId, name, buf) {
  const ext = path.extname(name).slice(1).toLowerCase();
  vault.addAttachment(entryId, { name, mime: MIME[ext] || 'application/octet-stream', buf });
}

// ---------- Notifications d'expiration ----------
// Document ou carte qui expire bientôt : notification Windows (seulement coffre ouvert : les dates sont chiffrées).
// Pas en développement : sans raccourci du menu Démarrer pour fr.yalma.pimkey, Electron en crée un (« Electron.lnk »,
// icône d'electron.exe) que Windows reprend ensuite pour la barre des tâches. L'app installée a le sien (installateur).

let notice = null; // gardée en mémoire jusqu'au clic
function notifyExpiries() {
  if (!app.isPackaged || !vault.unlocked || !settings.data.expiryNotify || !Notification.isSupported()) return;
  const due = vault.expiryNotices();
  if (!due.length) return;
  const when = (d) => (d < 0 ? 'a expiré' : d === 0 ? 'expire aujourd’hui' : `expire dans ${d} jour${d > 1 ? 's' : ''}`);
  notice = new Notification(due.length === 1
    ? { title: `${due[0].title} ${when(due[0].days)}`, body: 'Pensez à le renouveler. Cliquez pour l’ouvrir dans Pimkey.' }
    : { title: `${due.length} éléments à renouveler`, body: due.slice(0, 3).map((d) => `${d.title} ${when(d.days)}`).join('\n') + (due.length > 3 ? '\n…' : '') });
  notice.on('click', () => {
    if (!winAlive()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    send('show', due.length === 1 ? { id: due[0].id } : { filter: 'expiring' });
  });
  notice.show();
}

// ---------- Copies automatiques ----------
// Une copie au plus par jour, seulement si le coffre a changé depuis la précédente : c'est une sauvegarde
// ordinaire (.pimkey-backup, chiffrée), qui se restaure depuis les Paramètres. Les plus anciennes sont effacées.

const AUTO_EVERY = 20 * 3600e3; // un peu moins de 24 h : une copie par jour même si Pimkey est ouvert plus tôt
const AUTO_FILE = /^Pimkey-auto-[\d-]+\.pimkey-backup$/;
let autoStatus = { error: null };

const backupDir = () => settings.data.backupDir || path.join(app.getPath('userData'), 'copies');

// Copies automatiques du dossier, de la plus ancienne à la plus récente (le nom porte la date)
function autoCopies(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => AUTO_FILE.test(f)).sort();
  } catch {
    return [];
  }
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// force : copie même si la dernière est récente (changement de mot de passe maître, de dossier, « Copier maintenant »)
function autoBackup(force = false) {
  if (!vault.unlocked || !settings.data.backupKeep) return;
  const dir = backupDir();
  try {
    const last = autoCopies(dir).at(-1);
    if (!force && last) {
      const lastAt = fs.statSync(path.join(dir, last)).mtimeMs;
      if (Date.now() - lastAt < AUTO_EVERY || fs.statSync(vault.file).mtimeMs <= lastAt) return;
    }
    fs.mkdirSync(dir, { recursive: true });
    vault.writeBackup(path.join(dir, `Pimkey-auto-${stamp()}.pimkey-backup`));
    for (const f of autoCopies(dir).slice(0, -settings.data.backupKeep)) fs.rmSync(path.join(dir, f), { force: true });
    autoStatus = { error: null };
  } catch (e) {
    autoStatus = { error: e.message };
  }
}

function backupStatus() {
  const dir = backupDir();
  const files = autoCopies(dir);
  let last = null;
  try { last = files.length ? fs.statSync(path.join(dir, files.at(-1))).mtimeMs : null; } catch {}
  return { dir, custom: !!settings.data.backupDir, count: files.length, last, error: autoStatus.error };
}

// ---------- Synchronisation ----------
// Coffre recopié dans un dossier synchronisé (OneDrive, Google Drive, Dropbox, Syncthing…) et fusionné, élément par
// élément, avec celui des autres appareils (vault.syncWith) : peu après chaque modification, au déverrouillage, et
// quand le fichier du dossier change. Coffre verrouillé, rien ne se fait : la fusion attend le déverrouillage.

const SYNC_IDLE = { at: null, error: null, needPassword: false };
let syncState = { ...SYNC_IDLE };
let syncTimer = null;
let syncSeen = null; // état du fichier du dossier lors de la dernière fusion

const syncDir = () => settings.data.syncDir;
const syncStatus = () => ({ dir: syncDir(), ...syncState });

function remoteStamp() {
  try {
    const s = fs.statSync(path.join(syncDir(), 'vault.pimkey'));
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return null;
  }
}

function runSync() {
  clearTimeout(syncTimer);
  syncTimer = null;
  if (!syncDir() || !vault.unlocked) return;
  let notice = null;
  try {
    const r = vault.syncWith(syncDir(), { icons: settings.data.siteIcons });
    syncState = { ...SYNC_IDLE, at: Date.now() };
    if (r.changed) send('entries', vault.list());
    if (r.passwordChanged) notice = 'Le mot de passe maître a été changé sur un autre appareil : utilisez désormais le nouveau.';
    if (r.conflicts) {
      notice = `${r.conflicts > 1 ? `${r.conflicts} éléments modifiés` : '1 élément modifié'} sur deux appareils à la fois : `
        + 'la version la plus récente est gardée, l’autre porte la mention « (conflit) ».';
    }
  } catch (e) {
    const needPassword = e.message === 'SYNC_PASSWORD';
    syncState = { ...syncState, needPassword, error: needPassword ? null : e.message };
  }
  syncSeen = remoteStamp();
  send('sync', { ...syncStatus(), notice });
}

// Synchronisation automatique en pause (réglage) : seulement à la demande (« Synchroniser »)
const syncAuto = () => !!syncDir() && settings.data.syncAuto !== false;

const scheduleSync = () => {
  if (!syncAuto()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, 2000);
};

// Changement venu d'un autre appareil : le service de synchronisation réécrit le fichier du dossier
function watchSync() {
  let ticks = 0;
  setInterval(() => {
    if (!syncAuto() || !vault.unlocked || syncTimer) return;
    // Toutes les 5 minutes, fusion même sans changement visible (copies en conflit laissées par le service)
    if (remoteStamp() !== syncSeen || ++ticks % 20 === 0) runSync();
  }, 15e3);
}

// ---------- Icônes ----------

const ICON_IMAGES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico'];
const toDataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;

// Image ramenée à `size` px au plus (PNG) ; SVG et petites images gardées telles quelles
function iconData({ buf, mime }, size = 64) {
  if (mime === 'image/svg+xml') return buf.length <= 100 * 1024 ? toDataUrl(mime, buf) : null;
  if (buf.length <= 24 * 1024) return toDataUrl(mime, buf);
  const img = nativeImage.createFromBuffer(buf);
  // Format que nativeImage ne décode pas (ICO, WebP…) : gardé tel quel s'il reste raisonnable
  if (img.isEmpty()) return buf.length <= 100 * 1024 ? toDataUrl(mime, buf) : null;
  return toDataUrl('image/png', (img.getSize().width > size ? img.resize({ width: size, quality: 'best' }) : img).toPNG());
}

// Logo choisi par l'utilisateur, ramené à 128 px ; Windows lit PNG, JPEG et ICO depuis le fichier
function pickedIcon(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (ext === 'svg') return iconData({ buf: fs.readFileSync(file), mime: 'image/svg+xml' });
  const img = nativeImage.createFromPath(file);
  if (!img.isEmpty()) return imageData(img);
  const buf = fs.readFileSync(file);
  return buf.length <= 256 * 1024 ? toDataUrl(MIME[ext] || 'image/png', buf) : null;
}

// Session en mémoire, sans cookies ni cache sur le disque : les sites ne reconnaissent pas l'utilisateur.
// Les appareils du réseau local (Proxmox, routeur, NAS…) ont souvent un certificat auto-signé : accepté pour eux
// seuls, et seulement dans cette session qui ne sert qu'à lire des icônes.
let iconSession = null;
function getIconSession() {
  if (iconSession) return iconSession;
  iconSession = session.fromPartition('pimkey-icons');
  iconSession.setCertificateVerifyProc(({ hostname, errorCode }, done) => done(errorCode !== 0 && isPrivateHost(hostname) ? 0 : -3));
  // Identité de navigateur ordinaire : la mention « Electron » fait refuser la page par certaines protections anti-robots
  iconSession.setUserAgent(iconSession.getUserAgent().replace(/\s+(pimkey|Electron)\/\S+/gi, ''));
  return iconSession;
}
const iconFetch = (url, opts) => getIconSession().fetch(url, opts);

async function iconFor(url, size) {
  const icon = await fetchSiteIcon(url, iconFetch).catch(() => null);
  return icon && iconData(icon, size);
}

// Icône d'un site, sinon celle de son domaine principal : les pages de connexion (auth.uber.com, id.atlassian.com…)
// n'en déclarent pas toujours
async function siteIcon(site, size) {
  const icon = await iconFor(site.root, size);
  const base = baseDomain(site.key);
  return icon || (base !== site.key ? iconFor(`https://${base}/`, size) : null);
}

// Logo cherché depuis l'éditeur : sur le site du lien saisi, sinon sur les sites probables d'après le nom.
// Rien n'est enregistré ici : l'éditeur l'applique à l'enregistrement (icon:set).
async function lookupIcon({ url, name } = {}) {
  const sites = [];
  const site = url && siteOf(String(url).trim());
  if (site) sites.push(site);
  for (const d of guessDomains(name)) if (!sites.some((s) => baseDomain(s.key) === d)) sites.push({ key: d, root: `https://${d}/` });
  for (const s of sites.slice(0, 3)) {
    const data = await siteIcon(s, 128);
    if (data) return { data, source: s.key };
  }
  return null;
}

// Image venue de l'interface (logo trouvé par lookupIcon) : seulement une image en data URL de taille raisonnable
const ICON_DATA = /^data:image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
function checkIconData(data) {
  if (typeof data !== 'string' || data.length > 400 * 1024 || !ICON_DATA.test(data)) throw new Error('Image invalide.');
  return data;
}

// Image réduite à 128 px au plus (PNG)
const imageData = (img) => toDataUrl('image/png', (img.getSize().width > 128 ? img.resize({ width: 128, quality: 'best' }) : img).toPNG());

// Cherche en arrière-plan les icônes manquantes, 4 sites à la fois, puis met la liste à jour
let iconsRunning = false;
let iconsAgain = false;
async function refreshSiteIcons() {
  if (!settings.data.siteIcons || !vault.unlocked) return;
  if (iconsRunning) { iconsAgain = true; return; }
  iconsRunning = true;
  const data = vault.data; // si le coffre est verrouillé entre-temps, on abandonne
  try {
    const queue = vault.sitesWithoutIcon();
    let changed = false;
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let site; (site = queue.shift());) {
        const icon = await siteIcon(site);
        if (vault.data !== data) return;
        vault.setSiteIcon(site.key, icon, false);
        changed = true;
      }
    }));
    if (changed && vault.data === data) {
      vault.save();
      send('entries', vault.list());
    }
  } finally {
    iconsRunning = false;
    if (iconsAgain) { iconsAgain = false; refreshSiteIcons(); }
  }
}

// ---------- Fuites de mots de passe (Have I Been Pwned) ----------
// k-anonymat : seuls les 5 premiers caractères de l'empreinte SHA-1 de chaque mot de passe partent, et le service
// renvoie toutes les empreintes qui commencent ainsi (complétées par du remplissage) ; la comparaison se fait ici.
// Lancé seulement à la demande, dans une session sans cookies ni cache disque.

let hibpSession = null;
const hibpFetch = (url, opts) => (hibpSession ||= session.fromPartition('pimkey-hibp')).fetch(url, opts);

async function checkBreaches() {
  const data = vault.data;
  const byPrefix = new Map();
  for (const e of vault.logins()) {
    const hash = crypto.createHash('sha1').update(e.fields.password, 'utf8').digest('hex').toUpperCase();
    const list = byPrefix.get(hash.slice(0, 5)) || [];
    list.push({ id: e.id, suffix: hash.slice(5) });
    byPrefix.set(hash.slice(0, 5), list);
  }
  const queue = [...byPrefix];
  const results = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let item; (item = queue.shift());) {
      const [prefix, list] = item;
      let text;
      try {
        const r = await hibpFetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        text = await r.text();
      } catch {
        throw new Error('Vérification impossible : Have I Been Pwned ne répond pas (connexion à Internet ?).');
      }
      const counts = new Map(text.split('\n').map((line) => {
        const [suffix, n] = line.trim().split(':');
        return [suffix, Number(n) || 0];
      }));
      for (const x of list) results.push([x.id, counts.get(x.suffix) || 0]);
    }
  }));
  if (vault.data !== data) throw new Error('Le coffre a été verrouillé pendant la vérification.');
  vault.setPwned(results);
  return { checked: results.length, breached: results.filter(([, n]) => n > 0).length };
}

// ---------- Extension navigateur ----------
// Activée dans les Paramètres : hôte natif déclaré à Chrome et Edge (HKCU) et tube nommé ouvert. Désactivée : ni l'un
// ni l'autre. L'appairage s'approuve dans la fenêtre de Pimkey (code à comparer avec celui de l'extension).

let bridge = null;
let bridgeError = null;
let pairAnswer = null; // réponse attendue de la fenêtre pour l'appairage en cours

const hostDir = () => path.join(app.getPath('userData'), 'native-host');
// Hors de l'archive asar dans l'app installée (asarUnpack) : lancé par Pimkey.exe en mode Node
const hostScript = () => path.join(__dirname, 'native-host.cjs').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const extensionDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, '..', 'extension'));

function answerPair(ok) {
  pairAnswer?.(ok);
  pairAnswer = null;
}

async function startBridge() {
  bridgeError = null;
  try {
    await register({ dir: hostDir(), exe: process.execPath, script: hostScript() });
    bridge ||= new Bridge({
      vault,
      hooks: {
        approvePair: ({ name, code }) => new Promise((resolve) => {
          answerPair(false);
          pairAnswer = resolve;
          showWindow();
          send('pair', { name, code });
        }),
        cancelPair: () => { answerPair(false); send('pair', null); },
        paired: (name) => send('pair', { done: name }),
        show: showWindow,
        copy,
        changed: () => { refreshSiteIcons(); send('entries', vault.list()); },
      },
    });
    await bridge.start();
  } catch (e) {
    bridgeError = e.message;
  }
}

async function stopBridge() {
  bridge?.stop();
  answerPair(false);
  await unregister(hostDir());
}

async function bridgeStatus() {
  return {
    enabled: !!settings.data.browserExtension,
    listening: !!bridge?.listening,
    error: bridgeError,
    browsers: settings.data.browserExtension ? await registration(hostDir()) : { chrome: false, edge: false },
    devices: vault.unlocked ? vault.devices() : [],
    extensionDir: extensionDir(),
    extensionId: EXTENSION_IDS[0],
  };
}

function normalizeUrl(raw) {
  const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error("Cette adresse n'est pas un lien web valide.");
  return url;
}

// ---------- IPC ----------

function handle(channel, fn) {
  ipcMain.handle(channel, (_e, ...args) => {
    lastActivity = Date.now();
    return fn(...args);
  });
}

function setupIpc() {
  handle('vault:status', () => ({ exists: vault.exists(), unlocked: vault.unlocked }));
  handle('vault:create', async (password) => {
    await vault.create(password);
    return vault.list();
  });
  // Après tout déverrouillage : icônes manquantes, copie de l'état d'avant les modifications du jour, rappels
  const afterUnlock = () => {
    setTimeout(() => syncAuto() && runSync(), 300);
    setTimeout(refreshSiteIcons, 1500);
    setTimeout(() => autoBackup(), 500);
    setTimeout(notifyExpiries, 3000);
    return vault.list();
  };
  handle('vault:unlock', async (password) => {
    await vault.unlock(password);
    return afterUnlock();
  });

  // Windows Hello : activation (mot de passe maître exigé, puis geste Hello), déverrouillage, désactivation
  let helloSupported = null;
  handle('hello:status', async () => ({
    supported: hello ? (helloSupported ??= await hello.isSupported()) : false,
    enabled: !!vault.helloChallenge(),
  }));
  handle('hello:enable', async (master) => {
    if (!hello) throw new Error('Windows Hello n’est disponible que sous Windows.');
    if (!master) throw new Error('MASTER_REQUIRED');
    if (!(await vault.verify(master))) throw new Error('Mot de passe maître incorrect.');
    const challenge = crypto.randomBytes(32).toString('base64');
    vault.enableHello(challenge, await hello.sign(challenge, true, helloIcon()));
    return true;
  });
  handle('hello:disable', async () => {
    vault.disableHello();
    await hello?.remove();
    return true;
  });
  // Geste Hello à la place du mot de passe maître (afficher un secret) : il ouvre aussi le délai de grâce
  handle('hello:confirm', async () => {
    const challenge = vault.helloChallenge();
    if (!hello || !challenge) throw new Error('Windows Hello n’est pas activé pour ce coffre.');
    if (!vault.verifyHello(await hello.sign(challenge, false, helloIcon()))) throw new Error('Windows Hello n’a pas été reconnu : utilisez le mot de passe maître.');
    masterOkAt = helloOkAt = Date.now();
    return true;
  });
  handle('vault:unlockHello', async () => {
    const challenge = vault.helloChallenge();
    if (!hello || !challenge) throw new Error('Windows Hello n’est pas activé pour ce coffre.');
    vault.unlockWithHello(await hello.sign(challenge, false, helloIcon()));
    return afterUnlock();
  });
  handle('vault:lock', () => lock('manual'));
  // La copie la plus récente s'ouvre ainsi avec le nouveau mot de passe
  handle('vault:changePassword', async (current, next) => {
    await vault.changePassword(current, next);
    autoBackup(true);
  });

  handle('entries:list', () => vault.list());
  handle('entries:save', (input) => {
    const id = vault.saveEntry(input);
    refreshSiteIcons();
    return { id, list: vault.list() };
  });

  handle('icon:pick', async (id) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choisir le logo de cet élément',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ICON_IMAGES }],
    });
    if (r.canceled) return null;
    const file = r.filePaths[0];
    if (fs.statSync(file).size > 5 * 1024 * 1024) throw new Error('Image trop lourde (5 Mo au plus).');
    const data = pickedIcon(file);
    if (!data) throw new Error('Cette image ne peut pas être lue.');
    vault.setEntryIcon(id, data);
    return vault.list();
  });
  // Logo pris sur une autre adresse : une image (https://…/logo.png) ou un site (proxmox.com)
  handle('icon:fromUrl', async (id, raw) => {
    const icon = await iconFor(normalizeUrl(String(raw || '').trim()), 128);
    if (!icon) throw new Error('Aucune image trouvée à cette adresse.');
    vault.setEntryIcon(id, icon);
    return vault.list();
  });
  // Logo collé depuis le presse-papiers (capture d'écran, image copiée dans le navigateur…)
  handle('icon:paste', (id) => {
    const img = clipboard.readImage();
    if (img.isEmpty()) throw new Error("Le presse-papiers ne contient pas d'image.");
    vault.setEntryIcon(id, imageData(img));
    return vault.list();
  });
  handle('icon:reset', (id) => {
    vault.setEntryIcon(id, null);
    return vault.list();
  });
  handle('icon:lookup', (query) => lookupIcon(query));
  handle('icon:set', (id, data) => {
    vault.setEntryIcon(id, checkIconData(data));
    return vault.list();
  });
  // Recherche à nouveau l'icône du site (après un changement de logo du site, par exemple)
  handle('icon:refresh', async (id) => {
    const site = siteOf(vault.getField(id, 'url'));
    if (!site) throw new Error('Aucun lien pour cet élément.');
    const icon = await siteIcon(site);
    vault.setSiteIcon(site.key, icon);
    return { found: !!icon, list: vault.list() };
  });
  handle('entries:trash', (id) => {
    vault.trashEntry(id);
    return vault.list();
  });
  handle('entries:restore', (id) => {
    vault.restoreEntry(id);
    return vault.list();
  });
  handle('entries:delete', (id) => {
    vault.deleteEntry(id);
    return vault.list();
  });
  handle('entries:emptyTrash', () => {
    vault.emptyTrash();
    return vault.list();
  });
  // Sélection multiple dans la liste
  const ids = (list) => {
    if (!Array.isArray(list) || !list.length || list.some((x) => typeof x !== 'string')) throw new Error('Aucun élément sélectionné.');
    return [...new Set(list)];
  };
  // Noms tirés des adresses (anciens imports Chrome) : dryRun pour l'aperçu dans les Paramètres
  handle('entries:duplicate', (id) => {
    const copy = vault.duplicateEntry(id);
    return { id: copy, list: vault.list() };
  });
  handle('entries:tidyTitles', (dryRun) => {
    const r = vault.tidyTitles(!!dryRun);
    return dryRun ? r : { ...r, list: vault.list() };
  });
  handle('entries:trashMany', (list) => {
    vault.trashEntries(ids(list));
    return vault.list();
  });
  handle('entries:restoreMany', (list) => {
    vault.restoreEntries(ids(list));
    return vault.list();
  });
  handle('entries:deleteMany', (list) => {
    vault.removeEntries(ids(list));
    return vault.list();
  });
  handle('entries:favorite', (id, favorite) => {
    vault.setFavorite(id, favorite);
    return vault.list();
  });

  // Afficher un secret : le mot de passe maître est redemandé à chaque fois
  handle('secret:reveal', async (id, key, master) => {
    await confirmMaster(master);
    return vault.getField(id, key);
  });
  handle('clip:copy', (id, key) => {
    const value = vault.getField(id, key);
    if (!value) throw new Error('Ce champ est vide.');
    return copy(value);
  });

  // Codes 2FA : le code (valable quelques secondes) s'affiche sans mot de passe maître ; la clé, elle, reste secrète
  handle('totp:code', (id) => vault.totpCode(id));
  handle('clip:copyTotp', (id) => copy(vault.totpCode(id).code));

  // Historique d'un mot de passe : mot de passe maître redemandé, comme pour l'afficher
  handle('history:reveal', async (id, key, master) => {
    await confirmMaster(master);
    return vault.getHistory(id, key);
  });
  handle('clip:copyHistory', (id, key, index) => {
    const h = vault.getHistory(id, key)[index];
    if (!h) throw new Error('Ancienne valeur introuvable.');
    return copy(h.value);
  });

  handle('audit:breaches', () => checkBreaches().then((r) => ({ ...r, list: vault.list() })));

  // Import : le fichier est lu et analysé, puis importé après confirmation (doublons, nombre d'éléments)
  handle('import:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Importer des mots de passe (CSV)',
      properties: ['openFile'],
      filters: [{ name: 'Export CSV', extensions: ['csv'] }],
    });
    if (r.canceled) return null;
    const file = r.filePaths[0];
    if (fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('Fichier trop lourd (20 Mo au plus).');
    const { format, entries } = readCsv(fs.readFileSync(file, 'utf8'));
    if (!entries.length) throw new Error('Aucun élément à importer dans ce fichier.');
    pendingImport = entries;
    const { duplicates } = vault.importEntries(entries, { dryRun: true, skipDuplicates: false });
    return {
      file: path.basename(file), format: format.label, count: entries.length, duplicates,
      notes: entries.filter((e) => e.type === 'note').length,
      totp: entries.filter((e) => e.fields.totp).length,
      tags: [...new Set(entries.flatMap((e) => e.tags))].length,
    };
  });
  handle('import:confirm', (skipDuplicates) => {
    if (!pendingImport) throw new Error('Choisissez d’abord un fichier.');
    const r = vault.importEntries(pendingImport, { skipDuplicates: !!skipDuplicates });
    pendingImport = null;
    refreshSiteIcons();
    return { ...r, list: vault.list() };
  });
  handle('import:cancel', () => { pendingImport = null; });
  handle('link:open', (id) => {
    const raw = vault.getField(id, 'url').trim();
    if (!raw) throw new Error('Aucun lien pour cet élément.');
    // Appli Android (android://…@com.instagram.android) : on ouvre le site de la marque
    const app = siteOf(raw);
    return shell.openExternal(/^android:/i.test(raw) && app ? app.root : normalizeUrl(raw));
  });

  handle('attachment:add', async (entryId) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Ajouter des fichiers au coffre',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images et PDF', extensions: Object.keys(MIME) }, { name: 'Tous les fichiers', extensions: ['*'] }],
    });
    if (r.canceled) return null;
    for (const file of r.filePaths) {
      if (fs.statSync(file).size > MAX_ATTACHMENT) throw new Error(`${path.basename(file)} dépasse 25 Mo.`);
    }
    for (const file of r.filePaths) addAttachment(entryId, path.basename(file), fs.readFileSync(file));
    return vault.list();
  });
  // Fichiers glissés sur la fiche : l'interface envoie leur contenu (jamais un chemin à lire sur le disque)
  handle('attachment:drop', (entryId, files) => {
    if (!Array.isArray(files) || !files.length) throw new Error('Aucun fichier.');
    for (const f of files) {
      if (!(f?.data instanceof Uint8Array) || typeof f.name !== 'string') throw new Error('Fichier illisible.');
      if (f.data.length > MAX_ATTACHMENT) throw new Error(`${f.name} dépasse 25 Mo.`);
    }
    for (const f of files) addAttachment(entryId, path.basename(f.name) || 'fichier', Buffer.from(f.data));
    return vault.list();
  });
  handle('attachment:preview', (entryId, attId) => {
    const a = vault.readAttachment(entryId, attId);
    return a.mime.startsWith('image/') ? `data:${a.mime};base64,${a.buf.toString('base64')}` : null;
  });
  handle('attachment:save', async (entryId, attId) => {
    const a = vault.readAttachment(entryId, attId);
    const r = await dialog.showSaveDialog(win, { title: 'Enregistrer une copie (non chiffrée)', defaultPath: a.name });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, a.buf);
    return true;
  });
  handle('attachment:remove', (entryId, attId) => {
    vault.removeAttachment(entryId, attId);
    return vault.list();
  });

  handle('backup:export', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(win, {
      title: 'Exporter une sauvegarde chiffrée',
      defaultPath: `Pimkey-sauvegarde-${day}.pimkey-backup`,
      filters: [{ name: 'Sauvegarde Pimkey', extensions: ['pimkey-backup'] }],
    });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, vault.exportBackup());
    return true;
  });
  handle('backup:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Restaurer une sauvegarde',
      defaultPath: autoCopies(backupDir()).length ? backupDir() : undefined,
      properties: ['openFile'],
      filters: [{ name: 'Sauvegarde Pimkey', extensions: ['pimkey-backup'] }],
    });
    pendingRestore = r.canceled ? null : r.filePaths[0];
    return pendingRestore && path.basename(pendingRestore);
  });
  handle('backup:restore', async (password) => {
    if (!pendingRestore) throw new Error('Choisissez d’abord une sauvegarde.');
    await vault.restoreBackup(fs.readFileSync(pendingRestore, 'utf8'), password);
    pendingRestore = null;
    clearClipboard();
  });
  handle('backup:status', () => backupStatus());
  handle('backup:now', () => {
    autoBackup(true);
    if (autoStatus.error) throw new Error(`Copie impossible : ${autoStatus.error}`);
    return backupStatus();
  });
  // Dossier des copies : choisi dans une boîte de dialogue (jamais une adresse venue de l'interface), ou null = par défaut
  handle('backup:setDir', async (choose) => {
    let dir = null;
    if (choose) {
      const r = await dialog.showOpenDialog(win, {
        title: 'Dossier des copies automatiques',
        defaultPath: backupDir(),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (r.canceled) return null;
      dir = r.filePaths[0];
    }
    settings.set({ backupDir: dir });
    autoBackup(true);
    return { settings: settings.data, status: backupStatus() };
  });
  handle('backup:openDir', () => {
    fs.mkdirSync(backupDir(), { recursive: true });
    return shell.openPath(backupDir());
  });

  // Synchronisation : dossier choisi dans une boîte de dialogue (jamais une adresse venue de l'interface)
  handle('sync:status', () => syncStatus());
  handle('sync:setDir', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Dossier de synchronisation (OneDrive, Google Drive, Dropbox…)',
      defaultPath: syncDir() || app.getPath('home'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled) return null;
    const dir = r.filePaths[0];
    const own = path.resolve(app.getPath('userData')).toLowerCase();
    if (path.resolve(dir).toLowerCase() === own || path.resolve(dir).toLowerCase().startsWith(own + path.sep)) {
      throw new Error('Choisissez un dossier en dehors du dossier des données de Pimkey.');
    }
    settings.set({ syncDir: dir });
    syncState = { ...SYNC_IDLE };
    runSync();
    return syncStatus();
  });
  // Le dossier contient un coffre créé sur un autre appareil : on le rejoint avec son mot de passe maître
  handle('sync:join', async (password) => {
    if (!password) throw new Error('MASTER_REQUIRED');
    if (!syncDir()) throw new Error('Choisissez d’abord un dossier de synchronisation.');
    await vault.joinSync(syncDir(), password, { icons: settings.data.siteIcons });
    syncState = { ...SYNC_IDLE, at: Date.now() };
    syncSeen = remoteStamp();
    return { status: syncStatus(), list: vault.list() };
  });
  handle('sync:now', () => {
    runSync();
    if (syncState.error) throw new Error(`Synchronisation impossible : ${syncState.error}`);
    return syncStatus();
  });
  handle('sync:disable', () => {
    clearTimeout(syncTimer);
    syncTimer = null;
    settings.set({ syncDir: null });
    syncState = { ...SYNC_IDLE };
    return syncStatus();
  });
  handle('sync:openDir', () => shell.openPath(syncDir()));

  handle('bridge:status', () => bridgeStatus());
  handle('bridge:enable', async (on) => {
    settings.set({ browserExtension: !!on });
    if (on) await startBridge();
    else await stopBridge();
    return bridgeStatus();
  });
  handle('bridge:revoke', (id) => {
    vault.removeDevice(id);
    bridge?.dropDevice(id);
    return bridgeStatus();
  });
  handle('bridge:answer', (ok) => answerPair(!!ok));
  handle('bridge:openDir', () => shell.openPath(extensionDir()));

  handle('settings:get', () => settings.data);
  handle('settings:set', (patch) => {
    const before = settings.data.siteIcons;
    const { backupDir: _, syncDir: __, ...rest } = patch || {};
    const data = settings.set(rest);
    if (winAlive()) win.setContentProtection(hideFromCapture());
    // Icônes désactivées : celles déjà récupérées sont effacées du coffre
    if (before && !data.siteIcons && vault.unlocked) { vault.clearSiteIcons(); send('entries', vault.list()); }
    if (!before && data.siteIcons) refreshSiteIcons();
    if ('backupKeep' in rest) autoBackup();
    if (rest.syncAuto && syncAuto()) runSync(); // reprise : ce qui a changé pendant la pause part tout de suite
    return data;
  });
  handle('app:info', () => ({ version: app.getVersion(), dataDir: app.getPath('userData'), dev: !app.isPackaged }));
  handle('app:openData', () => shell.openPath(app.getPath('userData')));
  handle('update:status', () => update);
  handle('update:check', () => updater?.check());
  handle('update:install', () => updater?.install());
  // L'interface signale l'activité (souris, clavier) pour le verrouillage automatique
  ipcMain.on('app:activity', () => { lastActivity = Date.now(); });
}

// Pimkey relancé alors qu'il tourne déjà (souvent caché dans la zone de notification) : on montre la fenêtre
app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(() => {
  app.setAppUserModelId('fr.yalma.pimkey');
  const dir = app.getPath('userData');
  vault = new Vault(dir);
  vault.onChange = scheduleSync;
  settings = new Settings(dir);
  setupIpc();
  createWindow();
  createTray();
  watchIdle();
  watchSync();
  updater = setupUpdates();
  if (settings.data.browserExtension) startBridge();
});

app.on('will-quit', () => {
  bridge?.stop();
  if (syncTimer) runSync();
  clearClipboard();
  vault?.lock();
});

app.on('window-all-closed', () => app.quit());
