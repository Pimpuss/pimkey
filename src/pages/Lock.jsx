import { useEffect, useRef, useState } from 'react';
import { Fingerprint, ShieldCheck } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import { PasswordInput, StrengthBar } from '../components/ui.jsx';
import { errText, useApp } from '../lib/context.jsx';

const REASONS = {
  idle: 'Verrouillé après une période d’inactivité.',
  system: 'Verrouillé avec la session Windows.',
  minimize: 'Verrouillé à la réduction de la fenêtre.',
  tray: 'Verrouillé à la fermeture de la fenêtre. Pimkey reste dans la zone de notification.',
  restore: 'Sauvegarde restaurée : déverrouillez avec son mot de passe maître.',
};

// Premier lancement (création du coffre) ou coffre verrouillé
export default function Lock() {
  const { status, lockReason, onUnlocked } = useApp();
  const setup = status === 'setup';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Windows Hello activé : bouton, et invite proposée d'emblée sauf après un verrouillage volontaire
  const [hello, setHello] = useState(false);
  const autoTried = useRef(false);
  const unlockHello = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onUnlocked(await window.pimkey.vault.unlockHello());
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };
  useEffect(() => {
    if (setup) return;
    window.pimkey.hello.status().then((s) => {
      setHello(s.enabled && s.supported);
      if (s.enabled && s.supported && !autoTried.current && !['manual', 'tray'].includes(lockReason) && document.hasFocus()) {
        autoTried.current = true;
        unlockHello();
      }
    }).catch(() => {});
  }, [setup]);

  const mismatch = setup && confirm && confirm !== password;
  const canSubmit = setup ? password.length >= 8 && password === confirm : !!password;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      const list = setup ? await window.pimkey.vault.create(password) : await window.pimkey.vault.unlock(password);
      onUnlocked(list);
    } catch (err) {
      setError(errText(err));
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <div className="lock">
      <div className="lock-drag" />
      <form className="lock-card" onSubmit={submit}>
        <span className="lock-logo"><Logo size={72} /></span>
        <h1>{setup ? 'Bienvenue dans Pimkey' : 'Pimkey est verrouillé'}</h1>
        <p>
          {setup
            ? 'Choisissez un mot de passe maître. Il chiffre tout votre coffre et n’est enregistré nulle part : s’il est oublié, vos données ne pourront pas être récupérées.'
            : REASONS[lockReason] || 'Entrez votre mot de passe maître pour ouvrir le coffre.'}
        </p>
        <div className="lock-form">
          <PasswordInput value={password} onChange={setPassword} autoFocus className="lg"
            placeholder={setup ? 'Nouveau mot de passe maître' : 'Mot de passe maître'} />
          {setup && (
            <>
              <StrengthBar password={password} />
              <PasswordInput value={confirm} onChange={setConfirm} className="lg" placeholder="Confirmez le mot de passe" />
              {password && password.length < 8 && <div className="hint-line">Au moins 8 caractères ; une phrase de plusieurs mots est idéale.</div>}
              {mismatch && <div className="form-error">Les deux mots de passe ne correspondent pas.</div>}
            </>
          )}
          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="btn primary big" disabled={!canSubmit || busy}>
            {busy ? (setup ? 'Création du coffre…' : 'Déchiffrement…') : setup ? 'Créer mon coffre' : 'Déverrouiller'}
          </button>
          {hello && (
            <button type="button" className="btn big hello-btn" onClick={unlockHello} disabled={busy}>
              <Fingerprint /> Windows Hello
            </button>
          )}
        </div>
        <div className="lock-foot"><ShieldCheck /> Chiffré sur cet ordinateur (AES-256 + scrypt), rien n’est envoyé en ligne</div>
      </form>
    </div>
  );
}
