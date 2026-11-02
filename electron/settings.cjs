// Réglages en clair (settings.json) : ils doivent être lisibles avant le déverrouillage et ne contiennent rien de secret.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  autoLockMinutes: 5, // 0 = jamais
  clipboardSeconds: 30, // 0 = ne pas vider le presse-papiers
  lockOnMinimize: false,
  closeToTray: true, // ✕ : rester dans la zone de notification (coffre verrouillé) au lieu de quitter
  lockOnSystemLock: true, // verrouillage de Windows (Win + L) ou mise en veille
  masterGraceMinutes: 1, // après une confirmation, le mot de passe maître n'est pas redemandé pendant ce délai ; 0 = toujours
  hideFromCapture: true, // fenêtre noire dans les captures d'écran et les partages d'écran
  siteIcons: true, // icône de chaque site, lue sur le site lui-même
  expiryNotify: true, // notification Windows quand un document ou une carte expire bientôt
  backupKeep: 10, // nombre de copies automatiques gardées ; 0 = pas de copie automatique
  backupDir: null,
  syncDir: null, // dossier synchronisé (OneDrive…) où le coffre est recopié et fusionné ; null = pas de synchronisation
  syncAuto: true, // fusion après chaque modification, au déverrouillage et quand le dossier change ; sinon à la demande
  browserExtension: false, // extension Chrome et Edge : hôte natif déclaré et canal ouvert // dossier des copies automatiques ; null = « copies » dans le dossier des données
  sortBy: 'name', // ordre de la liste : name, updated, created, type
  accent: null,
};

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch {}
  }

  set(patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULTS)) continue;
      if (typeof DEFAULTS[k] === 'number') this.data[k] = Math.max(0, Math.min(1440, Number(v) || 0));
      else if (typeof DEFAULTS[k] === 'boolean') this.data[k] = !!v;
      else this.data[k] = v ?? null;
    }
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.data;
  }
}

module.exports = { Settings };
