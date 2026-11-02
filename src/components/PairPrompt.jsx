import { Puzzle } from 'lucide-react';
import { Modal } from './ui.jsx';

// Demande d'appairage d'une extension navigateur : le même code doit s'afficher dans l'extension. Un code différent
// signifie qu'un autre programme s'est intercalé : refuser.
export default function PairPrompt({ pair, onDone }) {
  const answer = (ok) => {
    window.pimkey.bridge.answer(ok);
    onDone(ok);
  };
  return (
    <Modal title="Appairer une extension navigateur" onClose={() => answer(false)} persistent>
      <div className="master-head">
        <span className="master-ico"><Puzzle /></span>
        <p>
          <strong>{pair.name}</strong> demande l’accès à vos identifiants. Vérifiez que l’extension affiche exactement
          ce code, puis confirmez des deux côtés.
        </p>
      </div>
      <div className="pair-code">{pair.code.slice(0, 3)} {pair.code.slice(3)}</div>
      <div className="notice">
        Si le code est différent, ou si vous n’avez rien demandé, refusez : un autre programme essaie de se faire passer
        pour l’extension.
      </div>
      <div className="master-actions">
        <button type="button" className="btn ghost" onClick={() => answer(false)}>Refuser</button>
        <button type="button" className="btn primary" onClick={() => answer(true)}>Le code est identique</button>
      </div>
    </Modal>
  );
}
