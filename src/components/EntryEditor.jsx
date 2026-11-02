import { useMemo, useState } from 'react';
import { LockKeyhole as Masked, Eye, EyeOff, Plus, RefreshCw, ScanSearch, Star, Tag, WandSparkles, X } from 'lucide-react';
import { Avatar, Modal, Select, StrengthBar, Toggle } from './ui.jsx';
import { useApp } from '../lib/context.jsx';
import { TYPES, TYPE_ICONS } from '../lib/types.js';
import { siteName } from '../../shared/sitename.mjs';
import { generatePassphrase, generatePassword, passphraseBits } from '../lib/password.js';

const SEPARATORS = [['-', 'Tiret  -'], ['.', 'Point  .'], ['_', 'Souligné  _'], [' ', 'Espace']];

// Générateur : mot de passe (caractères) ou phrase de passe (mots français) ; le dernier mode choisi est retenu
function Generator({ onUse }) {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('pimkey-gen-mode') || 'chars'; } catch { return 'chars'; } });
  const [opts, setOpts] = useState({ length: 20, upper: true, digits: true, symbols: true });
  const [phrase, setPhrase] = useState({ words: 6, separator: '-', capitalize: true, digit: true });
  const make = (m = mode, o = opts, p = phrase) => (m === 'words' ? generatePassphrase(p) : generatePassword(o));
  const [value, setValue] = useState(() => make());
  const set = (patch) => { const next = { ...opts, ...patch }; setOpts(next); setValue(make('chars', next)); };
  const setP = (patch) => { const next = { ...phrase, ...patch }; setPhrase(next); setValue(make('words', opts, next)); };
  const switchMode = (m) => {
    setMode(m);
    setValue(make(m));
    try { localStorage.setItem('pimkey-gen-mode', m); } catch {}
  };
  return (
    <div className="gen">
      <div className="gen-modes" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'chars'} className={mode === 'chars' ? 'on' : ''} onClick={() => switchMode('chars')}>Mot de passe</button>
        <button type="button" role="tab" aria-selected={mode === 'words'} className={mode === 'words' ? 'on' : ''} onClick={() => switchMode('words')}>Phrase de passe</button>
      </div>
      <div className="gen-top">
        <code className="gen-out">{value}</code>
        <button type="button" className="btn ghost sm icon" title="Générer un autre" onClick={() => setValue(make())}><RefreshCw /></button>
        <button type="button" className="btn primary sm" onClick={() => onUse(value)}>Utiliser</button>
      </div>
      {mode === 'chars' ? (
        <div className="gen-opts">
          <label className="gen-len">
            Longueur <strong>{opts.length}</strong>
            <input type="range" min="8" max="64" value={opts.length} onChange={(e) => set({ length: Number(e.target.value) })} />
          </label>
          <label><Toggle on={opts.upper} onChange={(upper) => set({ upper })} /> Majuscules</label>
          <label><Toggle on={opts.digits} onChange={(digits) => set({ digits })} /> Chiffres</label>
          <label><Toggle on={opts.symbols} onChange={(symbols) => set({ symbols })} /> Symboles</label>
        </div>
      ) : (
        <div className="gen-opts">
          <label className="gen-len">
            Mots <strong>{phrase.words}</strong>
            <input type="range" min="3" max="10" value={phrase.words} onChange={(e) => setP({ words: Number(e.target.value) })} />
            <em className="gen-bits">≈ {passphraseBits(phrase)} bits</em>
          </label>
          <Select width={150} value={phrase.separator} options={SEPARATORS} onChange={(separator) => setP({ separator })} label="Séparateur" />
          <label><Toggle on={phrase.capitalize} onChange={(capitalize) => setP({ capitalize })} /> Majuscules</label>
          <label><Toggle on={phrase.digit} onChange={(digit) => setP({ digit })} /> Un chiffre</label>
        </div>
      )}
    </div>
  );
}

// Champ secret : vide = inchangé à l'édition ; l'œil recharge la valeur actuelle après le mot de passe maître.
// has : une valeur est enregistrée (par défaut, d'après entry.secrets)
function SecretField({ field, entry, value, onChange, has = entry?.secrets[field.key] }) {
  const { askMaster } = useApp();
  const [shown, setShown] = useState(false);
  const [gen, setGen] = useState(false);
  const stored = has && value === undefined;

  const toggle = async () => {
    if (shown) return setShown(false);
    if (stored) {
      const current = await askMaster({
        title: `Afficher : ${field.label.toLowerCase()}`,
        text: 'Pour modifier la valeur enregistrée, confirmez avec votre mot de passe maître.',
        action: (master) => window.pimkey.secret.reveal(entry.id, field.key, master),
        hello: true,
      });
      if (current === undefined) return;
      onChange(current);
    }
    setShown(true);
  };

  return (
    <>
      <div className="input-row">
        <div className="pw-input">
          <input
            className={`input ${field.mono ? 'mono' : ''}`}
            type={shown ? 'text' : 'password'}
            value={value ?? ''}
            placeholder={stored ? '•••••••• (inchangé)' : field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="btn ghost sm icon eye" onClick={toggle} title={shown ? 'Masquer' : 'Afficher'}>
            {shown ? <EyeOff /> : <Eye />}
          </button>
        </div>
        {field.key === 'password' && (
          <button type="button" className={`btn icon ${gen ? 'active' : ''}`} title="Générateur de mot de passe" onClick={() => setGen(!gen)}>
            <WandSparkles />
          </button>
        )}
      </div>
      {field.key === 'password' && <StrengthBar password={value} />}
      {field.kind === 'totp' && !stored && !value && (
        <div className="hint-line">La clé secrète affichée par le site à l’activation de la double authentification (sous le QR code).</div>
      )}
      {gen && <Generator onUse={(v) => { onChange(v); setShown(true); setGen(false); }} />}
    </>
  );
}

// Étiquettes : Entrée ou virgule pour ajouter, suggestions parmi les étiquettes existantes
function TagInput({ tags, onChange, known }) {
  const [text, setText] = useState('');
  const add = (raw) => {
    const t = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...tags, t]);
    setText('');
  };
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      if (!text.trim()) return;
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1));
  };
  const suggestions = known.filter((k) => !tags.includes(k));
  return (
    <div className="tag-input">
      {tags.map((t) => (
        <span key={t} className="tag">
          <Tag /> {t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Retirer ${t}`}><X /></button>
        </span>
      ))}
      <input list="known-tags" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
        onBlur={() => text.trim() && add(text)} placeholder={tags.length ? '' : 'Perso, Travail, Banque…'} spellCheck={false} />
      <datalist id="known-tags">{suggestions.map((k) => <option key={k} value={k} />)}</datalist>
    </div>
  );
}

// Champs personnalisés : nom, valeur, masqué ou non. Une valeur masquée déjà enregistrée reste inconnue
// de l'interface (value undefined) tant qu'on ne la remplace pas.
function CustomFields({ entry, list, onChange }) {
  const update = (i, patch) => onChange(list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="custom-fields">
      {list.map((c, i) => {
        const has = !!entry?.custom.find((x) => x.id === c.id && x.secret && x.has);
        return (
          <div className="custom-row" key={c.key}>
            <input className="input custom-label" value={c.label} onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Nom du champ" spellCheck={false} autoFocus={c.fresh} />
            <div className="custom-value">
              {c.secret ? (
                <SecretField field={{ key: `custom:${c.id}`, label: c.label || 'Champ', kind: 'password' }} entry={entry} has={has}
                  value={c.value} onChange={(value) => update(i, { value })} />
              ) : (
                <input className="input" value={c.value ?? ''} onChange={(e) => update(i, { value: e.target.value })} placeholder="Valeur" spellCheck={false} />
              )}
            </div>
            <button type="button" className={`btn icon ${c.secret ? 'active' : ''}`} title={c.secret ? 'Valeur masquée' : 'Masquer la valeur'}
              disabled={c.secret && has && c.value === undefined}
              onClick={() => update(i, { secret: !c.secret })}>
              <Masked />
            </button>
            <button type="button" className="btn ghost icon" title="Retirer ce champ" onClick={() => onChange(list.filter((_, j) => j !== i))}><X /></button>
          </div>
        );
      })}
      <button type="button" className="btn sm add-field" onClick={() => onChange([...list, { key: crypto.randomUUID(), label: '', value: '', secret: false, fresh: true }])}>
        <Plus /> Ajouter un champ
      </button>
    </div>
  );
}

export default function EntryEditor({ entry, type: newType, tags: newTags = [], onClose, onSaved }) {
  const { guard, entries, setEntries, toast } = useApp();
  const type = entry?.type || newType;
  const def = TYPES[type];
  const Icon = TYPE_ICONS[type];
  const [title, setTitle] = useState(entry?.title || '');
  const [favorite, setFavorite] = useState(!!entry?.favorite);
  // Champs visibles pré-remplis ; champs secrets : undefined tant qu'on n'y touche pas
  const [values, setValues] = useState(() => {
    const v = {};
    for (const f of def.fields) if (!f.secret) v[f.key] = entry?.fields[f.key] || (f.kind === 'select' ? f.options[0] : '');
    return v;
  });
  const [tags, setTags] = useState(entry?.tags || newTags);
  // key : clé React stable ; value undefined = valeur masquée enregistrée, inchangée
  const [custom, setCustom] = useState(() => (entry?.custom || []).map((c) => ({ key: c.id, id: c.id, label: c.label, secret: c.secret, value: c.secret ? undefined : c.value })));
  const knownTags = useMemo(() => [...new Set(entries.flatMap((e) => e.tags || []))].sort((a, b) => a.localeCompare(b, 'fr')), [entries]);
  const [busy, setBusy] = useState(false);
  const set = (key) => (val) => setValues((v) => ({ ...v, [key]: val }));

  // Logo cherché sur Internet : { data, source } en attente, appliqué à l'enregistrement
  const [logo, setLogo] = useState(null);
  const [scanning, setScanning] = useState(false);
  const scanName = type === 'card' ? values.bank || title : title;
  const scanLogo = guard(async () => {
    setScanning(true);
    try {
      const found = await window.pimkey.icon.lookup({ url: values.url || '', name: scanName });
      if (found) setLogo(found);
      else toast(values.url ? 'Aucun logo trouvé sur ce site.' : 'Aucun logo trouvé : ajoutez le lien du site et réessayez.', 'error');
    } finally {
      setScanning(false);
    }
  });
  const preview = { type, title: title || def.label, icon: logo?.data || entry?.icon || null };

  const save = guard(async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const fields = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
      const customOut = custom.map(({ id, label, value, secret }) => ({ id, label, value, secret }));
      const { id, list } = await window.pimkey.entries.save({ id: entry?.id, type, title, favorite, fields, tags, custom: customOut });
      setEntries(logo ? await window.pimkey.icon.set(id, logo.data) : list);
      onSaved(id);
    } finally {
      setBusy(false);
    }
  });

  // Identifiant sans nom : on propose le nom du site (« accounts.epicgames.com » → « Epic Games »)
  const onUrlBlur = () => {
    if (!title.trim() && values.url) setTitle(siteName(values.url));
  };

  const input = (f) => {
    const common = { value: values[f.key], onChange: (e) => set(f.key)(e.target.value), placeholder: f.placeholder, spellCheck: false };
    switch (f.kind) {
      case 'password':
      case 'totp':
        return <SecretField field={f} entry={entry} value={values[f.key]} onChange={set(f.key)} />;
      case 'select':
        return <Select value={values[f.key]} options={f.options.map((o) => [o, o])} onChange={set(f.key)} label={f.label} />;
      case 'textarea':
        return <textarea className="input" rows={f.rows || 4} {...common} />;
      case 'date':
        return <input className="input" type="date" {...common} />;
      case 'url':
        return <input className="input" {...common} onBlur={onUrlBlur} />;
      default:
        return <input className={`input ${f.mono ? 'mono' : ''}`} {...common} />;
    }
  };

  return (
    <Modal
      title={entry ? `Modifier « ${entry.title} »` : `Nouveau : ${def.label.toLowerCase()}`}
      onClose={onClose}
      persistent
      footer={
        <>
          <label className="fav-check">
            <Toggle on={favorite} onChange={setFavorite} /> <Star /> Favori
          </label>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="submit" form="entry-form" className="btn primary" disabled={busy || !title.trim()}>Enregistrer</button>
        </>
      }
    >
      <form id="entry-form" className="editor" onSubmit={save}
        onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && save(e)}>
        <div className="field">
          <label>Nom</label>
          <div className="title-row">
            <Avatar entry={preview} />
            <div className="title-input">
              <span className="title-ico"><Icon /></span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
                placeholder={{ login: 'Ex. : Gmail perso', identity: 'Ex. : Passeport', card: 'Ex. : Visa Boursorama', note: 'Ex. : Codes Wi-Fi' }[type]} />
            </div>
            <button type="button" className="btn" onClick={scanLogo} disabled={scanning || (!values.url?.trim() && !scanName.trim())}
              title="Chercher le logo sur Internet : sur le site du lien, sinon d’après le nom">
              <ScanSearch /> {scanning ? 'Recherche…' : 'Chercher le logo'}
            </button>
          </div>
          {logo && (
            <div className="hint-line logo-found">
              Logo trouvé sur <strong>{logo.source}</strong>, appliqué à l’enregistrement.
              <button type="button" className="link-btn" onClick={() => setLogo(null)}>Annuler</button>
            </div>
          )}
        </div>
        {def.fields.map((f) => (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            {input(f)}
          </div>
        ))}
        <div className="field">
          <label>Champs personnalisés</label>
          <CustomFields entry={entry} list={custom} onChange={setCustom} />
        </div>
        <div className="field">
          <label>Étiquettes</label>
          <TagInput tags={tags} onChange={setTags} known={knownTags} />
        </div>
        {/* Entrée valide le formulaire même depuis un champ (sauf dans les zones de texte) */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
