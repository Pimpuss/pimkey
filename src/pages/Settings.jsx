import { useEffect, useState } from 'react';
import { Check, Cloud, CloudOff, DatabaseBackup, FolderInput, FolderOpen, History, Keyboard, KeyRound, Palette, Puzzle, RefreshCw, RotateCcw, ShieldCheck, Upload, Unlink, WandSparkles } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import { Modal, PasswordInput, Select, StrengthBar, Toggle } from '../components/ui.jsx';
import { errText, useApp } from '../lib/context.jsx';
import { ACCENTS, resolveAccent } from '../lib/accent.js';
import ImportDialog from '../components/ImportDialog.jsx';

const LOCK_DELAYS = [[0, 'Jamais'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 heure']];
const SHORTCUTS = [
  ['Ctrl + F', 'Rechercher'], ['Ctrl + N', 'Nouvel élément'], ['Ctrl + L', 'Verrouiller'],
  ['↑ ↓ Début Fin', 'Parcourir la liste'], ['Lettre', 'Aller au nom qui commence par'], ['Entrée', 'Modifier l’élément'],
  ['Ctrl + C', 'Copier le mot de passe'], ['Ctrl + B', 'Copier l’identifiant'], ['Suppr', 'Mettre à la corbeille'],
  ['Espace', 'Cocher'], ['Ctrl + A', 'Tout cocher'], ['Échap', 'Annuler la sélection'],
];
const GRACE_DELAYS = [[0, 'Toujours'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 heure'], [240, '4 heures']];
const CLIP_DELAYS = [[10, '10 secondes'], [30, '30 secondes'], [60, '1 minute'], [120, '2 minutes'], [0, 'Jamais']];
const BACKUP_KEEP = [[0, 'Désactivées'], [5, '5 dernières'], [10, '10 dernières'], [30, '30 dernières']];

const formatWhen = (ts) =>
  new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Mises à jour : état, vérification à la demande, redémarrage pour installer
const UPDATE_TEXT = {
  dev: 'Les mises à jour ne s’appliquent qu’à l’app installée.',
  idle: 'Recherche automatique au démarrage puis toutes les 6 heures.',
  checking: 'Recherche d’une nouvelle version…',
  latest: 'Pimkey est à jour.',
};
function UpdateSetting() {
  const { update } = useApp();
  const text = update.state === 'downloading' ? `Téléchargement de la version ${update.version}… ${update.percent || 0} %`
    : update.state === 'ready' ? `La version ${update.version} est prête : elle s’installera au redémarrage.`
      : update.state === 'error' ? `Recherche impossible : ${update.error}` : UPDATE_TEXT[update.state];
  return (
    <Setting title="Mises à jour" actions={update.state === 'ready'
      ? <button className="btn primary" onClick={() => window.pimkey.update.install()}><RotateCcw /> Redémarrer</button>
      : <button className="btn" disabled={update.state === 'dev' || update.state === 'checking' || update.state === 'downloading'}
        onClick={() => window.pimkey.update.check()}><RefreshCw /> Rechercher</button>}>
      {text}
    </Setting>
  );
}

// Windows Hello : activation après le mot de passe maître puis le geste Hello (visage, empreinte, PIN)
function HelloSetting() {
  const { guard, toast, askMaster } = useApp();
  const [state, setState] = useState(null);
  useEffect(() => { window.pimkey.hello.status().then(setState).catch(() => setState(null)); }, []);
  if (!state?.supported) return null;
  const toggle = guard(async (on) => {
    if (on) {
      const ok = await askMaster({
        title: 'Activer Windows Hello',
        text: 'Confirmez avec votre mot de passe maître, puis avec Windows Hello (visage, empreinte ou code PIN).',
        action: (master) => window.pimkey.hello.enable(master),
      });
      if (!ok) return;
      toast('Windows Hello activé');
    } else {
      await window.pimkey.hello.disable();
      toast('Windows Hello désactivé');
    }
    setState(await window.pimkey.hello.status());
  });
  return (
    <Setting title="Déverrouiller avec Windows Hello" actions={<Toggle on={state.enabled} onChange={toggle} />}>
      Visage, empreinte ou code PIN Windows au lieu du mot de passe maître. La clé du coffre est protégée par une clé
      du module de sécurité (TPM) de cet ordinateur ; le mot de passe maître reste valable et indispensable sur un autre PC.
    </Setting>
  );
}

// Identifiants nommés par leur adresse (anciens imports de Chrome ou Edge) : proposés au renommage, avec un exemple
function TidyTitles() {
  const { entries, setEntries, guard, toast } = useApp();
  const [preview, setPreview] = useState(null);
  useEffect(() => { window.pimkey.entries.tidyTitles(true).then(setPreview).catch(() => {}); }, [entries]);
  const run = guard(async () => {
    const r = await window.pimkey.entries.tidyTitles(false);
    setEntries(r.list);
    toast(`${r.count} identifiant${r.count > 1 ? 's renommés' : ' renommé'}`);
  });
  if (!preview?.count) return null;
  const ex = preview.examples[0];
  return (
    <Setting title="Noms tirés des adresses" actions={<button className="btn" onClick={run}><WandSparkles /> Renommer</button>}>
      {preview.count > 1 ? `${preview.count} identifiants portent` : '1 identifiant porte'} l’adresse du site comme nom
      (export de Chrome ou Edge), par exemple « {ex.from} » qui deviendrait « {ex.to} ». Les noms choisis à la main ne sont pas touchés.
    </Setting>
  );
}

// Copies automatiques : une par jour quand le coffre a changé, dans un dossier au choix (OneDrive, disque externe…)
function AutoBackups() {
  const { settings, setSettings, updateSettings, guard, toast } = useApp();
  const [status, setStatus] = useState(null);
  const keep = settings.backupKeep ?? 10;
  useEffect(() => { window.pimkey.backup.status().then(setStatus); }, [keep]);

  const now = guard(async () => { setStatus(await window.pimkey.backup.now()); toast('Copie enregistrée'); });
  const setDir = (choose) => guard(async () => {
    const r = await window.pimkey.backup.setDir(choose);
    if (!r) return;
    setSettings(r.settings);
    setStatus(r.status);
    if (r.status.error) toast(`Copie impossible : ${r.status.error}`, 'error');
  });

  return (
    <>
      <Setting title="Copies automatiques" actions={
        <>
          {keep > 0 && <button className="btn" onClick={now}><History /> Copier maintenant</button>}
          <Select width={170} value={keep} options={BACKUP_KEEP} onChange={(v) => updateSettings({ backupKeep: v })} />
        </>
      }>
        Une copie chiffrée par jour, quand le coffre a changé ; les plus anciennes sont effacées. Elle se restaure
        ci-dessous, avec le mot de passe maître en vigueur au moment de la copie.
        {keep > 0 && status && (
          <em className="setting-sub">
            {status.last ? `Dernière copie : ${formatWhen(status.last)} · ${status.count} copie${status.count > 1 ? 's' : ''}` : 'Aucune copie pour le moment'}
          </em>
        )}
        {keep > 0 && status?.error && <em className="setting-error">Dernière copie impossible : {status.error}</em>}
      </Setting>
      {keep > 0 && (
        <Setting title="Dossier des copies" actions={
          <>
            {status?.custom && <button className="btn ghost icon" title="Revenir au dossier par défaut" onClick={setDir(false)}><RotateCcw /></button>}
            <button className="btn" onClick={setDir(true)}><FolderInput /> Choisir…</button>
            <button className="btn icon" title="Ouvrir le dossier" onClick={guard(() => window.pimkey.backup.openDir())}><FolderOpen /></button>
          </>
        }>
          Choisissez un dossier synchronisé (OneDrive…) ou un disque externe pour garder une copie hors de cet ordinateur.
          {status && <em className="setting-path">{status.dir}</em>}
        </Setting>
      )}
    </>
  );
}

// Synchronisation : coffre chiffré recopié dans un dossier synchronisé et fusionné avec celui des autres appareils
function SyncSetting() {
  const { setEntries, guard, toast, askMaster } = useApp();
  const [status, setStatus] = useState(null);
  useEffect(() => {
    window.pimkey.sync.status().then(setStatus).catch(() => {});
    return window.pimkey.on('sync', setStatus);
  }, []);

  const join = async () => {
    const r = await askMaster({
      title: 'Rejoindre le coffre synchronisé',
      text: 'Ce dossier contient déjà un coffre Pimkey, créé sur un autre appareil. Entrez son mot de passe maître : '
        + 'vos éléments y seront ajoutés et ce mot de passe deviendra celui de cet ordinateur (Windows Hello sera à réactiver).',
      action: (master) => window.pimkey.sync.join(master),
    });
    if (!r) return;
    setEntries(r.list);
    setStatus(r.status);
    toast('Coffre synchronisé');
  };
  const choose = guard(async () => {
    const s = await window.pimkey.sync.setDir();
    if (!s) return;
    setStatus(s);
    if (s.needPassword) await join();
    else if (!s.error) toast('Synchronisation activée');
  });
  const now = guard(async () => { setStatus(await window.pimkey.sync.now()); toast('Coffre synchronisé'); });
  const stop = guard(async () => { setStatus(await window.pimkey.sync.disable()); toast('Synchronisation arrêtée'); });
  if (!status) return null;

  return (
    <Setting title="Synchroniser avec un dossier" actions={status.dir ? (
      <>
        {status.needPassword
          ? <button className="btn primary" onClick={guard(join)}><KeyRound /> Rejoindre…</button>
          : <button className="btn" onClick={now}><RefreshCw /> Synchroniser</button>}
        <button className="btn icon" title="Changer de dossier" onClick={choose}><FolderInput /></button>
        <button className="btn icon" title="Ouvrir le dossier" onClick={guard(() => window.pimkey.sync.openDir())}><FolderOpen /></button>
        <button className="btn ghost icon" title="Arrêter la synchronisation" onClick={stop}><CloudOff /></button>
      </>
    ) : <button className="btn" onClick={choose}><FolderInput /> Choisir un dossier…</button>}>
      Le coffre chiffré est recopié dans un dossier synchronisé (OneDrive, Google Drive, Dropbox, Syncthing…) et fusionné,
      élément par élément, avec les modifications faites sur vos autres appareils. Le service ne voit qu’un fichier chiffré.
      {status.dir && <em className="setting-path">{status.dir}</em>}
      {status.at && !status.error && <em className="setting-sub">Dernière synchronisation : {formatWhen(status.at)}</em>}
      {status.needPassword && <em className="setting-error">Ce dossier contient un coffre créé sur un autre appareil : rejoignez-le avec son mot de passe maître.</em>}
      {status.error && <em className="setting-error">Synchronisation impossible : {status.error}</em>}
    </Setting>
  );
}

// Extension Chrome et Edge : hôte natif déclaré au navigateur, navigateurs appairés (révocables)
function BrowserExtension() {
  const { guard, toast } = useApp();
  const [state, setState] = useState(null);
  const refresh = () => window.pimkey.bridge.status().then(setState).catch(() => {});
  useEffect(() => {
    refresh();
    // Un appairage terminé (fenêtre d'approbation) ajoute un navigateur à la liste
    return window.pimkey.on('pair', (p) => p?.done && refresh());
  }, []);
  if (!state) return null;

  const toggle = guard(async (on) => setState(await window.pimkey.bridge.enable(on)));
  const revoke = (d) => guard(async () => {
    setState(await window.pimkey.bridge.revoke(d.id));
    toast(`${d.name} n’a plus accès à Pimkey`);
  });
  const browsers = ['chrome', 'edge'].filter((b) => state.browsers[b]).map((b) => (b === 'chrome' ? 'Chrome' : 'Edge'));
  const day = (ts) => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <Setting title="Extension Chrome et Edge" actions={<Toggle on={state.enabled} onChange={toggle} />}>
        Propose vos identifiants sur la page de connexion du site, et les remplit après un clic. Chaque navigateur est
        approuvé une fois ici (code à comparer) ; coffre verrouillé, l’extension n’obtient rien.
        {state.enabled && state.error && <em className="setting-error">{state.error}</em>}
        {state.enabled && !state.error && (
          <em className="setting-sub">
            {browsers.length ? `Prête pour ${browsers.join(' et ')}` : 'Inscription auprès des navigateurs impossible'}
            {state.devices.length > 0 && ` · ${state.devices.length} navigateur${state.devices.length > 1 ? 's appairés' : ' appairé'}`}
          </em>
        )}
      </Setting>
      {state.enabled && (
        <Setting title="Installer l’extension" actions={
          <button className="btn" onClick={guard(() => window.pimkey.bridge.openDir())}><FolderOpen /> Ouvrir le dossier</button>
        }>
          Dans <code>chrome://extensions</code> ou <code>edge://extensions</code>, activez le mode développeur, puis
          « Charger l’extension non empaquetée » et choisissez ce dossier. Cliquez ensuite sur son icône pour l’appairer.
          <em className="setting-path">{state.extensionDir}</em>
        </Setting>
      )}
      {state.devices.length > 0 && (
        <Setting title="Navigateurs appairés">
          Révoquer coupe aussitôt l’accès ; il faudra appairer à nouveau ce navigateur.
          <span className="device-list">
            {state.devices.map((d) => (
              <span key={d.id} className="device">
                <span className="txt">
                  <strong>{d.name}</strong>
                  <span>Appairé le {day(d.createdAt)}{d.usedAt ? ` · utilisé le ${day(d.usedAt)}` : ''}</span>
                </span>
                <button className="btn sm" onClick={revoke(d)}><Unlink /> Révoquer</button>
              </span>
            ))}
          </span>
        </Setting>
      )}
    </>
  );
}

function Setting({ title, children, actions }) {
  return (
    <div className="setting">
      <div className="txt"><strong>{title}</strong><span>{children}</span></div>
      <div className="setting-actions">{actions}</div>
    </div>
  );
}

function ChangeMaster({ onClose }) {
  const { toast } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = current && next.length >= 8 && next === confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError('');
    try {
      await window.pimkey.vault.changePassword(current, next);
      toast('Mot de passe maître modifié');
      onClose();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Changer le mot de passe maître" onClose={onClose} persistent footer={
      <>
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn primary" type="submit" form="change-master" disabled={!ok || busy}>{busy ? 'Chiffrement…' : 'Changer'}</button>
      </>
    }>
      <form id="change-master" className="editor" onSubmit={submit}>
        <div className="field"><label>Mot de passe actuel</label><PasswordInput value={current} onChange={setCurrent} autoFocus /></div>
        <div className="field"><label>Nouveau mot de passe</label><PasswordInput value={next} onChange={setNext} /><StrengthBar password={next} /></div>
        <div className="field"><label>Confirmez le nouveau mot de passe</label><PasswordInput value={confirm} onChange={setConfirm} /></div>
        {confirm && next !== confirm && <div className="form-error">Les deux mots de passe ne correspondent pas.</div>}
        {error && <div className="form-error">{error}</div>}
        <div className="notice">Les sauvegardes déjà exportées et les copies automatiques précédentes restent protégées par l’ancien mot de passe.</div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function Restore({ file, onClose }) {
  const { onLocked } = useApp();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      await window.pimkey.backup.restore(password);
      onLocked('restore');
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };
  return (
    <Modal title="Restaurer une sauvegarde" onClose={onClose} footer={
      <>
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn stop" type="submit" form="restore" disabled={!password || busy}>{busy ? 'Restauration…' : 'Remplacer mon coffre'}</button>
      </>
    }>
      <form id="restore" className="editor" onSubmit={submit}>
        <div className="notice danger">
          Le coffre actuel sera remplacé par <strong>{file}</strong>. Il est mis de côté dans le dossier des données
          (« avant-restauration-… ») au cas où.
        </div>
        <div className="field">
          <label>Mot de passe maître de cette sauvegarde</label>
          <PasswordInput value={password} onChange={setPassword} autoFocus />
        </div>
        {error && <div className="form-error">{error}</div>}
      </form>
    </Modal>
  );
}

function AccentPicker() {
  const { settings, updateSettings } = useApp();
  const current = resolveAccent(settings.accent);
  const isPreset = (a) => !settings.accent?.custom && a.main === current.main;
  return (
    <div className="accent-swatches">
      {ACCENTS.map((a) => (
        <button key={a.id} className={`accent-swatch ${isPreset(a) ? 'active' : ''}`} title={a.name}
          style={{ background: `linear-gradient(135deg, ${a.main}, ${a.second})` }}
          onClick={() => updateSettings({ accent: a.id === 'violet' ? null : { main: a.main, second: a.second } })}>
          {isPreset(a) && <Check />}
        </button>
      ))}
      <label className={`accent-swatch custom ${settings.accent?.custom ? 'active' : ''}`} title="Couleur libre">
        {settings.accent?.custom && <Check />}
        <input type="color" value={current.main} onChange={(e) => updateSettings({ accent: { main: e.target.value, custom: true } })} />
      </label>
    </div>
  );
}

export default function Settings() {
  const { settings, updateSettings, guard, toast } = useApp();
  const [modal, setModal] = useState(null);
  const [info, setInfo] = useState(null);
  useEffect(() => { window.pimkey.app.info().then(setInfo); }, []);

  const exportBackup = guard(async () => {
    if (await window.pimkey.backup.export()) toast('Sauvegarde exportée');
  });
  const pickBackup = guard(async () => {
    const file = await window.pimkey.backup.pick();
    if (file) setModal({ restore: file });
  });

  return (
    <div className="page">
      <div className="page-head"><h1>Paramètres</h1></div>
      <div className="settings">
        <h2 className="section"><ShieldCheck /> Sécurité</h2>
        <Setting title="Verrouillage automatique" actions={
          <Select width={170} value={settings.autoLockMinutes ?? 5} options={LOCK_DELAYS} onChange={(v) => updateSettings({ autoLockMinutes: v })} />
        }>
          Le coffre se verrouille après cette durée sans activité dans Pimkey.
        </Setting>
        <HelloSetting />
        <Setting title="Redemander le mot de passe maître" actions={
          <Select width={170} value={settings.masterGraceMinutes ?? 1} options={GRACE_DELAYS} onChange={(v) => updateSettings({ masterGraceMinutes: v })} />
        }>
          Après l’avoir saisi (ou après Windows Hello) pour afficher un secret, il n’est plus demandé pendant ce délai, tant que le coffre reste ouvert (« Toujours » : à chaque fois).
        </Setting>
        <Setting title="Verrouiller avec Windows" actions={
          <Toggle on={settings.lockOnSystemLock !== false} onChange={(v) => updateSettings({ lockOnSystemLock: v })} />
        }>
          Verrouillage de la session (Win + L) ou mise en veille de l’ordinateur.
        </Setting>
        <Setting title="Garder Pimkey dans la zone de notification" actions={
          <Toggle on={settings.closeToTray !== false} onChange={(v) => updateSettings({ closeToTray: v })} />
        }>
          Fermer la fenêtre (✕) verrouille le coffre et laisse Pimkey près de l’horloge ; on le quitte depuis son icône (clic droit).
        </Setting>
        <Setting title="Verrouiller à la réduction de la fenêtre" actions={
          <Toggle on={!!settings.lockOnMinimize} onChange={(v) => updateSettings({ lockOnMinimize: v })} />
        }>
          Pratique si d’autres personnes utilisent cet ordinateur.
        </Setting>
        <Setting title="Vider le presse-papiers" actions={
          <Select width={170} value={settings.clipboardSeconds ?? 30} options={CLIP_DELAYS} onChange={(v) => updateSettings({ clipboardSeconds: v })} />
        }>
          Un identifiant ou mot de passe copié est effacé du presse-papiers après ce délai (s’il y est encore).
        </Setting>
        <Setting title="Masquer Pimkey des captures d’écran" actions={
          <Toggle on={settings.hideFromCapture !== false} onChange={(v) => updateSettings({ hideFromCapture: v })} />
        }>
          La fenêtre apparaît noire dans les captures, enregistrements et partages d’écran (Teams, Discord…).
          {info?.dev && <em className="dev-note"> Sans effet en mode développement.</em>}
        </Setting>

        <Setting title="Icônes des sites" actions={
          <Toggle on={settings.siteIcons !== false} onChange={(v) => updateSettings({ siteIcons: v })} />
        }>
          Affiche le logo de chaque site, récupéré directement sur le site (aucun service tiers, sans cookies) et rangé
          chiffré dans le coffre. Désactivé, les icônes déjà récupérées sont effacées.
        </Setting>

        <Setting title="Rappels d’expiration" actions={
          <Toggle on={settings.expiryNotify !== false} onChange={(v) => updateSettings({ expiryNotify: v })} />
        }>
          Notification Windows quand un document ou une carte expire dans 3 mois, 1 mois, 1 semaine, puis le jour où il a expiré
          (une seule fois par étape, coffre ouvert).
          {info?.dev && <em className="dev-note"> Sans effet en mode développement.</em>}
        </Setting>

        <h2 className="section"><Puzzle /> Navigateur</h2>
        <BrowserExtension />

        <h2 className="section"><Cloud /> Synchronisation</h2>
        <SyncSetting />

        <h2 className="section"><KeyRound /> Mot de passe maître</h2>
        <Setting title="Changer le mot de passe maître" actions={<button className="btn" onClick={() => setModal({ master: true })}>Changer</button>}>
          Il n’est enregistré nulle part : en cas d’oubli, le coffre ne peut pas être ouvert. Notez-le en lieu sûr.
        </Setting>

        <h2 className="section"><DatabaseBackup /> Sauvegarde et import</h2>
        <AutoBackups />
        <Setting title="Exporter une sauvegarde chiffrée" actions={<button className="btn" onClick={exportBackup}><DatabaseBackup /> Exporter</button>}>
          Un seul fichier avec tout le coffre et ses pièces jointes, toujours chiffré. À garder sur une clé USB ou un disque externe.
        </Setting>
        <Setting title="Restaurer une sauvegarde" actions={<button className="btn" onClick={pickBackup}><Upload /> Restaurer…</button>}>
          Remplace le coffre actuel par une sauvegarde exportée ou une copie automatique ; demande le mot de passe maître de la sauvegarde.
        </Setting>
        <Setting title="Importer depuis un autre gestionnaire" actions={<button className="btn" onClick={() => setModal({ import: true })}><Upload /> Importer…</button>}>
          Export CSV de Chrome, Edge, Firefox, Bitwarden ou KeePass : les éléments s’ajoutent à ceux du coffre.
        </Setting>
        <TidyTitles />

        <h2 className="section"><Keyboard /> Raccourcis clavier</h2>
        <div className="setting shortcuts">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys}><kbd>{keys}</kbd><span>{what}</span></div>
          ))}
        </div>

        <h2 className="section"><Palette /> Apparence</h2>
        <div className="setting accent-setting">
          <div className="txt"><strong>Couleur d’accent</strong><span>Boutons, sélection et logo.</span></div>
          <AccentPicker />
        </div>

        <h2 className="section"><Logo size={18} /> À propos</h2>
        <UpdateSetting />
        <Setting title={<>Pimkey <span className="setting-version">{info ? `v${info.version}` : ''}</span></>}
          actions={<button className="btn" onClick={() => window.pimkey.app.openData()}><FolderOpen /> Dossier des données</button>}>
          Coffre chiffré en AES-256-GCM, clé dérivée du mot de passe maître par scrypt. Aucune donnée ne quitte cet ordinateur.
        </Setting>
      </div>
      {modal?.master && <ChangeMaster onClose={() => setModal(null)} />}
      {modal?.restore && <Restore file={modal.restore} onClose={() => setModal(null)} />}
      {modal?.import && <ImportDialog onClose={() => setModal(null)} />}
    </div>
  );
}
