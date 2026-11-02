import { useEffect, useRef, useState } from 'react';
import { Fingerprint, LockKeyhole } from 'lucide-react';
import { Modal, PasswordInput } from './ui.jsx';
import { errText } from '../lib/context.jsx';

// Confirmation par le mot de passe maître avant une action sensible (afficher un secret…).
// prompt.hello : Windows Hello accepté à la place (s'il est activé), et proposé d'emblée
export default function MasterPrompt({ prompt, onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hello, setHello] = useState(false);
  const autoTried = useRef(false);

  const cancel = () => {
    prompt.resolve(undefined);
    onDone();
  };

  const run = async (confirm) => {
    setBusy(true);
    setError('');
    try {
      const result = await confirm();
      prompt.resolve(result);
      onDone();
    } catch (err) {
      setError(errText(err));
      setPassword('');
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (!password || busy) return;
    run(() => prompt.action(password));
  };

  // Geste Hello réussi : l'action passe sans mot de passe
  const confirmHello = () => {
    if (busy) return;
    run(async () => {
      await window.pimkey.hello.confirm();
      return prompt.action(null);
    });
  };

  useEffect(() => {
    if (!prompt.hello) return;
    window.pimkey.hello.status().then((s) => {
      setHello(s.enabled && s.supported);
      if (s.enabled && s.supported && !autoTried.current && document.hasFocus()) {
        autoTried.current = true;
        confirmHello();
      }
    }).catch(() => {});
  }, []);

  return (
    <Modal title={prompt.title || 'Mot de passe maître'} onClose={cancel}>
      <form className="master-form" onSubmit={submit}>
        <div className="master-head">
          <span className="master-ico"><LockKeyhole /></span>
          <p>{prompt.text || 'Confirmez avec votre mot de passe maître.'}</p>
        </div>
        <PasswordInput value={password} onChange={setPassword} autoFocus placeholder="Mot de passe maître" />
        {error && <div className="form-error">{error}</div>}
        <div className="master-actions">
          {hello && (
            <button type="button" className="btn hello-btn master-hello" onClick={confirmHello} disabled={busy}>
              <Fingerprint /> Windows Hello
            </button>
          )}
          <button type="button" className="btn ghost" onClick={cancel}>Annuler</button>
          <button type="submit" className="btn primary" disabled={!password || busy}>{busy ? 'Vérification…' : 'Confirmer'}</button>
        </div>
      </form>
    </Modal>
  );
}
