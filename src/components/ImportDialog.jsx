import { useState } from 'react';
import { FileUp, Upload } from 'lucide-react';
import { Modal, Toggle } from './ui.jsx';
import { errText, useApp } from '../lib/context.jsx';

const HOW_TO = [
  ['Chrome / Edge', 'Paramètres → Mots de passe (Gestionnaire de mots de passe) → Exporter les mots de passe'],
  ['Firefox', 'Mots de passe (about:logins) → menu ··· → Exporter les identifiants'],
  ['Bitwarden', 'Outils → Exporter le coffre → format .csv'],
  ['KeePass / KeePassXC', 'Fichier ou Base de données → Exporter → CSV'],
];

const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

// Import d'un export CSV : choix du fichier, résumé (format, doublons), puis import
export default function ImportDialog({ onClose }) {
  const { setEntries, setView, setSelectedId, toast } = useApp();
  const [info, setInfo] = useState(null);
  const [skip, setSkip] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async () => {
    setError('');
    try {
      const r = await window.pimkey.importer.pick();
      if (r) setInfo(r);
    } catch (e) {
      setError(errText(e));
    }
  };
  const close = () => {
    window.pimkey.importer.cancel();
    onClose();
  };
  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await window.pimkey.importer.confirm(skip);
      setEntries(r.list);
      setSelectedId(null);
      setView({ page: 'vault', filter: 'all' });
      toast(r.added ? `${plural(r.added, 'élément importé', 'éléments importés')}` : 'Aucun nouvel élément à importer');
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const toImport = info ? info.count - (skip ? info.duplicates : 0) : 0;
  return (
    <Modal title="Importer des mots de passe" onClose={close} persistent footer={
      <>
        <button className="btn ghost" onClick={close}>Annuler</button>
        {info ? (
          <button className="btn primary" onClick={confirm} disabled={busy || !toImport}>
            <Upload /> {busy ? 'Import…' : `Importer ${plural(toImport, 'élément', 'éléments')}`}
          </button>
        ) : (
          <button className="btn primary" onClick={pick}><FileUp /> Choisir le fichier CSV…</button>
        )}
      </>
    }>
      <div className="editor">
        {info ? (
          <>
            <div className="import-summary">
              <strong>{info.file}</strong>
              <span>
                Format {info.format} · {plural(info.count, 'élément', 'éléments')}
                {info.notes > 0 && ` dont ${plural(info.notes, 'note', 'notes')}`}
                {info.totp > 0 && ` · ${plural(info.totp, 'clé 2FA', 'clés 2FA')}`}
                {info.tags > 0 && ` · ${plural(info.tags, 'dossier devenu étiquette', 'dossiers devenus étiquettes')}`}
              </span>
            </div>
            {info.duplicates > 0 && (
              <label className="import-skip">
                <Toggle on={skip} onChange={setSkip} />
                <span>
                  Ignorer {plural(info.duplicates, 'élément déjà présent', 'éléments déjà présents')} dans le coffre
                  <em>Même site, identifiant et mot de passe.</em>
                </span>
              </label>
            )}
            <div className="notice danger">
              Ce fichier contient vos mots de passe <strong>en clair</strong>. Une fois l’import terminé, supprimez-le
              et videz la corbeille de Windows.
            </div>
            <button className="link-btn" onClick={pick}>Choisir un autre fichier</button>
          </>
        ) : (
          <>
            <p className="import-intro">Exportez vos mots de passe en CSV depuis votre gestionnaire actuel, puis choisissez le fichier :</p>
            <div className="import-how">
              {HOW_TO.map(([name, how]) => (
                <div key={name}><strong>{name}</strong><span>{how}</span></div>
              ))}
            </div>
            <p className="hint-line">Les dossiers (Bitwarden) et groupes (KeePass) deviennent des étiquettes. Rien n’est envoyé sur Internet.</p>
          </>
        )}
        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  );
}
