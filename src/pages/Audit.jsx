import { useMemo, useState } from 'react';
import { ChevronDown, Clock, Copy as Reused, ShieldAlert, ShieldCheck, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { Avatar } from '../components/ui.jsx';
import { useApp } from '../lib/context.jsx';
import { formatStamp, subtitle } from '../lib/types.js';

const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

// Problèmes relevés sur les mots de passe des identifiants (calculés par le coffre : l'interface ne voit
// jamais les mots de passe), et vérification des fuites à la demande
export function auditIssues(entries) {
  const logins = entries.filter((e) => e.audit && !e.deletedAt);
  const groups = new Map();
  for (const e of logins) if (e.audit.reused) groups.set(e.audit.reused, [...(groups.get(e.audit.reused) || []), e]);
  return {
    logins,
    pwned: logins.filter((e) => e.audit.pwned > 0),
    reused: [...groups.values()].filter((g) => g.length > 1),
    weak: logins.filter((e) => e.audit.weak),
    old: logins.filter((e) => e.audit.old),
  };
}

// Nombre d'identifiants concernés par au moins un problème (compteur de la barre latérale)
export const issueCount = (entries) =>
  entries.filter((e) => e.audit && !e.deletedAt && (e.audit.pwned > 0 || e.audit.reused || e.audit.weak || e.audit.old)).length;

function Row({ entry, note }) {
  const { setView, setSelectedId } = useApp();
  return (
    <button className="item audit-item" onClick={() => { setView({ page: 'vault', filter: 'all' }); setSelectedId(entry.id); }}>
      <Avatar entry={entry} />
      <span className="item-txt">
        <strong>{entry.title}</strong>
        <span>{subtitle(entry) || 'Identifiant'}</span>
      </span>
      {note && <span className="audit-note">{note}</span>}
    </button>
  );
}

// Sections repliées, mémorisées d'une visite à l'autre (simple confort : rien de grave si le stockage échoue)
const FOLDED_KEY = 'pimkey.audit.folded';
function readFolded() {
  try { return JSON.parse(localStorage.getItem(FOLDED_KEY)) || {}; } catch { return {}; }
}

function Section({ id, icon: Icon, title, count, text, kind, folded, onToggle, children }) {
  return (
    <section className={`audit-section ${folded ? 'folded' : ''}`}>
      <h2 className={`section ${kind || ''}`}>
        <button type="button" className="audit-toggle" onClick={() => onToggle(id)} aria-expanded={!folded}>
          <ChevronDown className="audit-chevron" />
          <Icon /> {title}
          <span className="audit-count">{count.toLocaleString('fr-FR')}</span>
        </button>
      </h2>
      {!folded && text && <p className="audit-text">{text}</p>}
      {!folded && <div className="audit-list">{children}</div>}
    </section>
  );
}

export default function Audit() {
  const { entries, setEntries, guard, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [folded, setFolded] = useState(readFolded);
  const toggle = (id) => setFolded((f) => {
    const next = { ...f, [id]: !f[id] };
    try { localStorage.setItem(FOLDED_KEY, JSON.stringify(next)); } catch { /* sans mémorisation */ }
    return next;
  });
  const fold = (id) => ({ id, folded: !!folded[id], onToggle: toggle });
  const { logins, pwned, reused, weak, old } = useMemo(() => auditIssues(entries), [entries]);
  const checkedAt = logins.reduce((min, e) => (e.audit.checkedAt && (!min || e.audit.checkedAt < min) ? e.audit.checkedAt : min), null);
  const unchecked = logins.filter((e) => e.audit.pwned === null).length;

  const check = guard(async () => {
    setBusy(true);
    try {
      const r = await window.pimkey.audit.breaches();
      setEntries(r.list);
      toast(r.breached ? `${plural(r.breached, 'mot de passe trouvé', 'mots de passe trouvés')} dans des fuites` : 'Aucun mot de passe trouvé dans des fuites', r.breached ? 'error' : 'info');
    } finally {
      setBusy(false);
    }
  });

  const cards = [
    ['pwned', 'Dans une fuite', pwned.length, unchecked === logins.length && logins.length ? '—' : null],
    ['reused', 'Réutilisés', reused.reduce((n, g) => n + g.length, 0)],
    ['weak', 'Faibles', weak.length],
    ['old', 'Inchangés depuis 1 an', old.length],
  ];
  const clean = !pwned.length && !reused.length && !weak.length && !old.length;

  return (
    <div className="page audit-page">
      <div className="audit-head">
      <div className="page-head"><h1>Santé des mots de passe</h1></div>
      <p className="audit-text">
        {logins.length ? `${plural(logins.length, 'identifiant analysé', 'identifiants analysés')} sur cet ordinateur.` : 'Aucun identifiant avec mot de passe pour le moment.'}
      </p>

      <div className="audit-cards">
        {cards.map(([key, label, n, placeholder]) => (
          <div key={key} className={`audit-card ${n ? key : ''}`}>
            <strong>{placeholder ?? n}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="setting audit-breach">
        <div className="txt">
          <strong>Vérifier les fuites de données</strong>
          <span>
            Compare vos mots de passe aux fuites connues de Have I Been Pwned. Seuls les 5 premiers caractères de
            l’empreinte de chaque mot de passe sont envoyés : ni le mot de passe, ni l’identifiant, ni le site ne quittent l’ordinateur.
            <em className="setting-sub">
              {checkedAt ? `Dernière vérification : ${formatStamp(checkedAt)}` : 'Jamais vérifié'}
              {checkedAt && unchecked > 0 && ` · ${plural(unchecked, 'mot de passe', 'mots de passe')} pas encore vérifié${unchecked > 1 ? 's' : ''}`}
            </em>
          </span>
        </div>
        <div className="setting-actions">
          <button className="btn primary" onClick={check} disabled={busy || !logins.length}>
            <ShieldQuestion /> {busy ? 'Vérification…' : 'Vérifier maintenant'}
          </button>
        </div>
      </div>
      </div>

      <div className="audit-scroll">
      {clean && logins.length > 0 && (
        <div className="empty-state audit-clean">
          <ShieldCheck />
          <h3>Rien à signaler</h3>
          <p>Aucun mot de passe faible, réutilisé ou ancien{unchecked ? '' : ', et aucun trouvé dans une fuite'}.</p>
        </div>
      )}

      {pwned.length > 0 && (
        <Section {...fold('pwned')} count={pwned.length} icon={ShieldAlert} kind="danger" title="Trouvés dans une fuite"
          text="Ces mots de passe circulent dans des fuites de données : changez-les en priorité, sur chaque site qui les utilise.">
          {pwned.map((e) => <Row key={e.id} entry={e} note={`vu ${e.audit.pwned.toLocaleString('fr-FR')} fois`} />)}
        </Section>
      )}

      {reused.length > 0 && (
        <Section {...fold('reused')} count={reused.reduce((n, g) => n + g.length, 0)} icon={Reused} title="Réutilisés"
          text="Un même mot de passe sur plusieurs sites : s’il fuit sur l’un, les autres sont exposés. Donnez à chacun le sien.">
          {reused.map((g) => (
            <div key={g[0].audit.reused} className="audit-group">
              <div className="audit-group-head">Même mot de passe pour {g.length} éléments</div>
              {g.map((e) => <Row key={e.id} entry={e} />)}
            </div>
          ))}
        </Section>
      )}

      {weak.length > 0 && (
        <Section {...fold('weak')} count={weak.length} icon={TriangleAlert} title="Faibles" text="Trop courts ou trop simples : le générateur en propose de solides.">
          {weak.map((e) => <Row key={e.id} entry={e} />)}
        </Section>
      )}

      {old.length > 0 && (
        <Section {...fold('old')} count={old.length} icon={Clock} title="Inchangés depuis plus d’un an">
          {old.map((e) => <Row key={e.id} entry={e} note={`depuis le ${new Date(e.audit.since).toLocaleDateString('fr-FR')}`} />)}
        </Section>
      )}
      </div>
    </div>
  );
}
