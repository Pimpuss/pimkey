import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveRestore, ArrowDownUp, Check, ClipboardPaste, Copy, CopyPlus, Minus, X, Download, ExternalLink, Eye, EyeOff, FileText, Globe, History, Image as ImageIcon, ImageOff, ImageUp,
  Paperclip, Pencil, Plus, RefreshCw, Search, Star, Tag, Trash2, Upload, Vault as VaultIcon,
} from 'lucide-react';
import { Avatar, Modal } from '../components/ui.jsx';
import EntryEditor from '../components/EntryEditor.jsx';
import ImportDialog from '../components/ImportDialog.jsx';
import { errText, useApp } from '../lib/context.jsx';
import {
  EXPIRY_LABEL, TYPES, TYPE_ICONS, TYPE_IDS, domainOf, expiryState, formatDate, formatSize, formatStamp, matches, subtitle,
} from '../lib/types.js';

const REVEAL_SECONDS = 30;
const TRASH_DAYS = 30; // même délai que electron/vault.cjs

// Les éléments de la corbeille n'apparaissent que dans le filtre « Corbeille »
export const FILTERS = {
  all: { label: 'Tous les éléments', test: () => true },
  favorites: { label: 'Favoris', test: (e) => e.favorite },
  expiring: { label: 'À renouveler', test: (e) => !!expiryState(e) },
  ...Object.fromEntries(TYPE_IDS.map((t) => [t, { label: TYPES[t].plural, test: (e) => e.type === t }])),
  trash: { label: 'Corbeille', test: () => true, trash: true },
};

function Confirm({ title, text, action = 'Supprimer', onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn stop" autoFocus onClick={() => { onConfirm(); onClose(); }}><Trash2 /> {action}</button>
      </>
    }>
      <p className="confirm-text">{text}</p>
    </Modal>
  );
}

// « Nouveau » : type imposé par le filtre en cours, sinon petit menu des types
function NewButton({ filter, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  if (TYPES[filter]) {
    return <button className="btn primary sm" onClick={() => onPick(filter)}><Plus /> Nouveau</button>;
  }
  return (
    <div className="dd" ref={ref}>
      <button className="btn primary sm" onClick={() => setOpen(!open)}><Plus /> Nouveau</button>
      {open && (
        <div className="dd-menu">
          {TYPE_IDS.map((t) => {
            const Icon = TYPE_ICONS[t];
            return (
              <button key={t} className="dd-opt" onClick={() => { setOpen(false); onPick(t); }}>
                <Icon className="dd-ico" /><span>{TYPES[t].label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Ordres de la liste (réglage sortBy, retenu)
const byName = (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' });
export const SORTS = {
  name: { label: 'Nom (A → Z)', compare: byName },
  updated: { label: 'Modifiés récemment', compare: (a, b) => b.updatedAt - a.updatedAt || byName(a, b) },
  created: { label: 'Ajoutés récemment', compare: (a, b) => b.createdAt - a.createdAt || byName(a, b) },
  type: { label: 'Catégorie', compare: (a, b) => TYPE_IDS.indexOf(a.type) - TYPE_IDS.indexOf(b.type) || byName(a, b) },
};

function SortMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="dd" ref={ref}>
      <button className={`btn ghost sm icon ${value !== 'name' ? 'active' : ''}`} onClick={() => setOpen(!open)} title={`Trier : ${SORTS[value].label}`}>
        <ArrowDownUp />
      </button>
      {open && (
        <div className="dd-menu">
          {Object.entries(SORTS).map(([key, s]) => (
            <button key={key} className={`dd-opt ${key === value ? 'sel' : ''}`} onClick={() => { setOpen(false); onChange(key); }}>
              <span>{s.label}</span>{key === value && <Check className="dd-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpiryPill({ entry }) {
  const state = expiryState(entry);
  return state ? <span className={`pill ${state === 'expired' ? 'danger' : 'warn'}`}>{EXPIRY_LABEL[state]}</span> : null;
}

// Code 2FA en cours, renouvelé à la fin de sa période, avec le compte à rebours
function TotpCode({ entry }) {
  const [state, setState] = useState(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let alive = true;
    let timer;
    const load = async () => {
      try {
        const r = await window.pimkey.totp.code(entry.id);
        if (!alive) return;
        setState({ ...r, until: Date.now() + r.remaining * 1000 });
        timer = setTimeout(load, r.remaining * 1000 + 50);
      } catch (e) {
        if (alive) setState({ error: errText(e) });
      }
    };
    load();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearTimeout(timer); clearInterval(tick); };
  }, [entry.id, entry.updatedAt]);
  if (!state) return <span className="fval masked">••• •••</span>;
  if (state.error) return <span className="fval totp-error">{state.error}</span>;
  const left = Math.max(0, Math.ceil((state.until - now) / 1000));
  const half = Math.ceil(state.code.length / 2);
  return (
    <span className="fval totp">
      <span className="totp-code">{state.code.slice(0, half)} {state.code.slice(half)}</span>
      <span className={`totp-ring ${left <= 5 ? 'low' : ''}`} style={{ '--p': left / state.period }} title={`Nouveau code dans ${left} s`}>{left}</span>
    </span>
  );
}

// Anciens mots de passe, affichés après le mot de passe maître ; la fenêtre se ferme seule
function HistoryModal({ entry, field, list, onClose }) {
  const { guard, toast } = useApp();
  useEffect(() => {
    const t = setTimeout(onClose, REVEAL_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [onClose]);
  const copy = (i) => guard(async () => {
    const s = await window.pimkey.clip.copyHistory(entry.id, field.key, i);
    toast(`Ancien mot de passe copié${s ? ` · effacé du presse-papiers dans ${s} s` : ''}`);
  });
  return (
    <Modal title={`Historique : ${entry.title}`} onClose={onClose}>
      <div className="history">
        {list.map((h, i) => (
          <div className="history-row" key={h.changedAt + i}>
            <div className="fmain">
              <div className="flabel">Remplacé le {formatStamp(h.changedAt)}</div>
              <span className="fval mono">{h.value}</span>
            </div>
            <button className="btn ghost sm icon" onClick={copy(i)} title="Copier"><Copy /></button>
          </div>
        ))}
      </div>
      <p className="hint-line history-hint">Cette fenêtre se ferme d’elle-même après {REVEAL_SECONDS} s.</p>
    </Modal>
  );
}

// Constats de l'audit sur le mot de passe d'un identifiant
function AuditPills({ entry }) {
  const { entries } = useApp();
  const a = entry.audit;
  if (!a) return null;
  const same = a.reused ? entries.filter((e) => e.audit?.reused === a.reused).length : 0;
  return (
    <>
      {a.pwned > 0 && <span className="pill danger" title={`Vu ${a.pwned.toLocaleString('fr-FR')} fois dans des fuites de données`}>Dans une fuite</span>}
      {same > 1 && <span className="pill warn" title={`Même mot de passe que ${same - 1} autre${same > 2 ? 's' : ''} élément${same > 2 ? 's' : ''}`}>Réutilisé · {same}</span>}
      {a.weak && <span className="pill warn">Faible</span>}
      {a.old && <span className="pill">Inchangé depuis plus d’un an</span>}
    </>
  );
}

// value : valeur d'un champ visible qui n'est pas dans entry.fields (champ personnalisé)
function FieldRow({ entry, field, value: given, revealed, onToggleReveal, extra }) {
  const { guard, toast } = useApp();
  const isSecret = !!field.secret;
  const raw = isSecret ? revealed : given ?? entry.fields[field.key];
  const shown = isSecret && revealed !== undefined;
  const isTotp = field.kind === 'totp';

  const copy = guard(async () => {
    if (isTotp) {
      const s = await window.pimkey.clip.copyTotp(entry.id);
      return toast(`Code 2FA copié${s ? ` · effacé du presse-papiers dans ${s} s` : ''}`);
    }
    const s = await window.pimkey.clip.copy(entry.id, field.key);
    toast(`${field.label} copié${s ? ` · effacé du presse-papiers dans ${s} s` : ''}`);
  });
  const openLink = guard(() => window.pimkey.link.open(entry.id));

  let value;
  if (isTotp && !shown) {
    value = <TotpCode entry={entry} />;
  } else if (isSecret && !shown) {
    const hint = entry.hints[field.key];
    value = <span className="fval masked">{hint ? `•••• •••• •••• ${hint}` : '••••••••••••'}</span>;
  } else if (field.kind === 'url') {
    value = <button className="fval link" onClick={openLink} title={raw}>{domainOf(raw)}</button>;
  } else if (field.kind === 'date') {
    value = <span className="fval">{formatDate(raw)}{field.expiry && <> <ExpiryPill entry={entry} /></>}</span>;
  } else {
    value = <span className={`fval ${field.mono ? 'mono' : ''}`}>{raw}</span>;
  }
  if (field.key === 'expiry') value = <span className="fval">{raw} <ExpiryPill entry={entry} /></span>;

  return (
    <div className={`frow ${field.kind === 'textarea' ? 'block' : ''}`}>
      <div className="fmain">
        <div className="flabel">
          {isTotp ? (shown ? field.label : 'Code 2FA') : field.label}
          {field.key === 'password' && <AuditPills entry={entry} />}
        </div>
        {value}
      </div>
      <div className="factions">
        {extra}
        {isSecret && (
          <button className="btn ghost sm icon" onClick={onToggleReveal}
            title={shown ? 'Masquer' : isTotp ? 'Afficher la clé (mot de passe maître)' : 'Afficher (mot de passe maître)'}>
            {shown ? <EyeOff /> : <Eye />}
          </button>
        )}
        {field.kind === 'url' && <button className="btn ghost sm icon" onClick={openLink} title="Ouvrir dans le navigateur"><ExternalLink /></button>}
        {(field.copy || isTotp) && <button className="btn ghost sm icon" onClick={copy} title={isTotp ? 'Copier le code' : 'Copier'}><Copy /></button>}
      </div>
    </div>
  );
}

function AttachmentTile({ entry, att, onOpen, onRemove }) {
  const { guard } = useApp();
  const [thumb, setThumb] = useState(null);
  const isImage = att.mime.startsWith('image/');
  useEffect(() => {
    if (isImage) window.pimkey.attachment.preview(entry.id, att.id).then(setThumb).catch(() => {});
  }, [entry.id, att.id, isImage]);
  const save = guard(() => window.pimkey.attachment.save(entry.id, att.id));
  return (
    <div className="att">
      <button className="att-thumb" onClick={() => (thumb ? onOpen(thumb) : save())} title={thumb ? 'Agrandir' : 'Enregistrer une copie'}>
        {thumb ? <img src={thumb} alt="" draggable={false} /> : <FileText />}
      </button>
      <div className="att-foot">
        <span title={att.name}>{att.name}<em>{formatSize(att.size)}</em></span>
        <button className="btn ghost sm icon" onClick={save} title="Enregistrer une copie (non chiffrée)"><Download /></button>
        {onRemove && <button className="btn ghost sm icon" onClick={onRemove} title="Supprimer"><Trash2 /></button>}
      </div>
    </div>
  );
}

// Logo de l'élément : clic pour choisir une image, rechercher l'icône du site ou revenir à l'icône par défaut
// Logo pris sur une autre adresse : une image, ou un site dont on prend l'icône (proxmox.com pour un Proxmox local)
function IconFromUrl({ entry, onClose }) {
  const { setEntries, toast } = useApp();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      setEntries(await window.pimkey.icon.fromUrl(entry.id, url));
      toast('Logo mis à jour');
      onClose();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };
  return (
    <Modal title="Logo depuis une adresse" onClose={onClose} footer={
      <>
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn primary" type="submit" form="icon-url" disabled={!url.trim() || busy}>{busy ? 'Recherche…' : 'Utiliser'}</button>
      </>
    }>
      <form id="icon-url" className="editor" onSubmit={submit}>
        <div className="field">
          <label>Adresse d’un site ou d’une image</label>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="proxmox.com" autoFocus spellCheck={false} />
        </div>
        <div className="notice">
          Un site : son icône est utilisée (par exemple <strong>proxmox.com</strong> pour un serveur Proxmox du réseau local).
          Une image : elle est utilisée telle quelle.
        </div>
        {error && <div className="form-error">{error}</div>}
      </form>
    </Modal>
  );
}

function AvatarMenu({ entry }) {
  const { guard, setEntries, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [fromUrl, setFromUrl] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const act = (fn) => guard(async () => { setOpen(false); await fn(); });
  const pick = act(async () => { const list = await window.pimkey.icon.pick(entry.id); if (list) setEntries(list); });
  const paste = act(async () => { setEntries(await window.pimkey.icon.paste(entry.id)); toast('Logo mis à jour'); });
  const reset = act(async () => setEntries(await window.pimkey.icon.reset(entry.id)));
  const refresh = act(async () => {
    const { found, list } = await window.pimkey.icon.refresh(entry.id);
    setEntries(list);
    toast(found ? 'Icône du site mise à jour' : 'Aucune icône trouvée sur ce site', found ? 'info' : 'error');
  });
  return (
    <div className="dd avatar-menu" ref={ref}>
      <button className="avatar-btn" onClick={() => setOpen(!open)} title="Changer le logo">
        <Avatar entry={entry} size="lg" />
        <span className="avatar-edit"><ImageIcon /></span>
      </button>
      {open && (
        <div className="dd-menu left">
          <button className="dd-opt" onClick={pick}><ImageUp className="dd-ico" /><span>Choisir une image…</span></button>
          <button className="dd-opt" onClick={paste}><ClipboardPaste className="dd-ico" /><span>Coller une image</span></button>
          <button className="dd-opt" onClick={() => { setOpen(false); setFromUrl(true); }}><Globe className="dd-ico" /><span>Depuis une adresse…</span></button>
          {entry.type === 'login' && entry.fields.url && !entry.customIcon && (
            <button className="dd-opt" onClick={refresh}><RefreshCw className="dd-ico" /><span>Rechercher l’icône du site</span></button>
          )}
          {entry.customIcon && (
            <button className="dd-opt" onClick={reset}><ImageOff className="dd-ico" /><span>Retirer l’image choisie</span></button>
          )}
        </div>
      )}
      {fromUrl && <IconFromUrl entry={entry} onClose={() => setFromUrl(false)} />}
    </div>
  );
}

function Detail({ entry, onEdit, onDeleted, onDuplicated }) {
  const { guard, setEntries, askMaster, toast, setView } = useApp();
  const def = TYPES[entry.type];
  const [revealed, setRevealed] = useState({});
  const [confirm, setConfirm] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [history, setHistory] = useState(null);
  const timers = useRef({});

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const toggleReveal = (field) => async () => {
    if (revealed[field.key] !== undefined) {
      clearTimeout(timers.current[field.key]);
      return setRevealed(({ [field.key]: _, ...rest }) => rest);
    }
    const value = await askMaster({
      title: `Afficher : ${field.label.toLowerCase()}`,
      text: `« ${entry.title} » : confirmez avec votre mot de passe maître. La valeur sera masquée à nouveau après ${REVEAL_SECONDS} s.`,
      action: (master) => window.pimkey.secret.reveal(entry.id, field.key, master),
      hello: true,
    });
    if (value === undefined) return;
    setRevealed((r) => ({ ...r, [field.key]: value }));
    timers.current[field.key] = setTimeout(() => setRevealed(({ [field.key]: _, ...rest }) => rest), REVEAL_SECONDS * 1000);
  };

  const favorite = guard(async () => setEntries(await window.pimkey.entries.favorite(entry.id, !entry.favorite)));
  const addFiles = guard(async () => {
    const list = await window.pimkey.attachment.add(entry.id);
    if (list) setEntries(list);
  });

  // Glisser-déposer de fichiers sur la fiche : ajoutés (chiffrés) aux pièces jointes
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = (e) => !entry.deletedAt && [...(e.dataTransfer?.types || [])].includes('Files');
  const dropProps = {
    onDragEnter: (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true); },
    onDragOver: (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } },
    onDragLeave: () => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } },
    onDrop: guard(async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = [...e.dataTransfer.files];
      const big = files.find((f) => f.size > 25 * 1024 * 1024);
      if (big) throw new Error(`${big.name} dépasse 25 Mo.`);
      const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
      setEntries(await window.pimkey.attachment.drop(entry.id, data));
      toast(files.length > 1 ? `${files.length} fichiers ajoutés` : `${files[0].name} ajouté`);
    }),
  };

  const restore = guard(async () => { setEntries(await window.pimkey.entries.restore(entry.id)); toast('Élément restauré'); });

  const openHistory = (field) => async () => {
    const list = await askMaster({
      title: 'Historique du mot de passe',
      text: `« ${entry.title} » : confirmez avec votre mot de passe maître pour voir les anciens mots de passe.`,
      action: (master) => window.pimkey.history.reveal(entry.id, field.key, master),
      hello: true,
    });
    if (list) setHistory({ field, list });
  };
  const closeHistory = useCallback(() => setHistory(null), []);

  // Champs du type puis champs personnalisés (clé « custom:<id> »)
  const rows = [
    ...def.fields.filter((f) => (f.secret ? entry.secrets[f.key] : entry.fields[f.key])).map((f) => ({ field: f })),
    ...entry.custom.filter((c) => c.has).map((c) => ({
      field: { key: `custom:${c.id}`, label: c.label, kind: 'text', secret: c.secret, copy: true }, value: c.value,
    })),
  ];
  const Icon = TYPE_ICONS[entry.type];
  const trashed = !!entry.deletedAt;

  return (
    <div className={`detail-inner ${dragging ? 'dragging' : ''}`} {...dropProps}>
      {dragging && <div className="drop-overlay"><Paperclip /> Déposer pour ajouter à « {entry.title} » (chiffré)</div>}
      <div className="detail-head">
        {trashed ? <Avatar entry={entry} size="lg" /> : <AvatarMenu entry={entry} />}
        <div className="detail-title">
          <h1>{entry.title}</h1>
          <span className="detail-type"><Icon /> {def.label}</span>
          {entry.tags.map((t) => (
            <button key={t} className="tag link" onClick={() => setView({ page: 'vault', filter: `tag:${t}` })} title="Voir les éléments de cette étiquette">
              <Tag /> {t}
            </button>
          ))}
        </div>
        {trashed ? (
          <>
            <button className="btn" onClick={restore}><ArchiveRestore /> Restaurer</button>
            <button className="btn icon danger" title="Supprimer définitivement" onClick={() => setConfirm({
              title: 'Supprimer définitivement ?',
              text: `« ${entry.title} » et ses pièces jointes seront effacés du coffre. Cette action est irréversible.`,
              action: 'Supprimer définitivement',
              onConfirm: guard(async () => { setEntries(await window.pimkey.entries.remove(entry.id)); onDeleted(); toast('Élément supprimé définitivement'); }),
            })}>
              <Trash2 />
            </button>
          </>
        ) : (
          <>
            <button className={`btn ghost icon star ${entry.favorite ? 'on' : ''}`} onClick={favorite}
              title={entry.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}>
              <Star />
            </button>
            <button className="btn icon" title="Dupliquer" onClick={guard(async () => {
              const { id, list } = await window.pimkey.entries.duplicate(entry.id);
              setEntries(list);
              onDuplicated(id, list);
            })}><CopyPlus /></button>
            <button className="btn" onClick={onEdit}><Pencil /> Modifier</button>
            <button className="btn icon danger" title="Mettre à la corbeille" onClick={() => setConfirm({
              title: 'Mettre à la corbeille ?',
              text: `« ${entry.title} » pourra être restauré depuis la corbeille pendant ${TRASH_DAYS} jours.`,
              action: 'Mettre à la corbeille',
              onConfirm: guard(async () => { setEntries(await window.pimkey.entries.trash(entry.id)); onDeleted(); toast('Élément mis à la corbeille'); }),
            })}>
              <Trash2 />
            </button>
          </>
        )}
      </div>

      {trashed && (
        <div className="notice trash-notice">
          Dans la corbeille depuis le {formatStamp(entry.deletedAt)}. Il sera supprimé définitivement
          le {formatStamp(entry.deletedAt + TRASH_DAYS * 86400e3)}, sauf si vous le restaurez.
        </div>
      )}

      {rows.length ? (
        <div className="fields">
          {rows.map(({ field: f, value }) => (
            <FieldRow key={f.key} entry={entry} field={f} value={value} revealed={revealed[f.key]} onToggleReveal={toggleReveal(f)}
              extra={f.history && entry.history[f.key]?.length > 0 && (
                <button className="btn ghost sm icon" onClick={openHistory(f)}
                  title={`Historique : ${entry.history[f.key].length} ancien${entry.history[f.key].length > 1 ? 's' : ''} mot${entry.history[f.key].length > 1 ? 's' : ''} de passe`}>
                  <History />
                </button>
              )} />
          ))}
        </div>
      ) : (
        <div className="fields-empty">Aucun champ rempli. {!trashed && <button className="link-btn" onClick={onEdit}>Compléter</button>}</div>
      )}

      <div className="section-title">
        <span><Paperclip /> Pièces jointes {entry.attachments.length > 0 && <em>{entry.attachments.length}</em>}</span>
        {!trashed && <button className="btn sm" onClick={addFiles}><Plus /> Ajouter un fichier</button>}
      </div>
      {entry.attachments.length ? (
        <div className="attachments">
          {entry.attachments.map((a) => (
            <AttachmentTile key={a.id} entry={entry} att={a} onOpen={(src) => setViewer({ src, name: a.name })}
              onRemove={!trashed && (() => setConfirm({
                title: 'Supprimer la pièce jointe ?',
                text: `« ${a.name} » sera supprimé définitivement du coffre.`,
                onConfirm: guard(async () => setEntries(await window.pimkey.attachment.remove(entry.id, a.id))),
              }))} />
          ))}
        </div>
      ) : trashed ? (
        <p className="att-empty">Aucune pièce jointe.</p>
      ) : (
        <p className="att-empty">
          {entry.type === 'identity' ? 'Ajoutez le scan ou la photo du document (recto, verso…), chiffré dans le coffre.' : 'Images, PDF… chiffrés dans le coffre.'}
          {' '}Vous pouvez aussi glisser des fichiers sur la fiche.
        </p>
      )}

      <div className="meta-foot">Créé le {formatStamp(entry.createdAt)} · modifié le {formatStamp(entry.updatedAt)}</div>

      {confirm && <Confirm {...confirm} onClose={() => setConfirm(null)} />}
      {history && <HistoryModal entry={entry} field={history.field} list={history.list} onClose={closeHistory} />}
      {viewer && (
        <Modal title={viewer.name} wide onClose={() => setViewer(null)}>
          <img className="viewer" src={viewer.src} alt={viewer.name} draggable={false} />
        </Modal>
      )}
    </div>
  );
}

export default function Vault() {
  const { entries, setEntries, view, selectedId, setSelectedId, query, setQuery, guard, toast, settings, updateSettings } = useApp();
  const sort = SORTS[settings.sortBy] || SORTS.name;
  const [editor, setEditor] = useState(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [importing, setImporting] = useState(false);
  // « tag:Banque » : éléments portant cette étiquette
  const filter = useMemo(() => {
    if (!view.filter?.startsWith('tag:')) return FILTERS[view.filter] || FILTERS.all;
    const tag = view.filter.slice(4);
    return { label: tag, tag, test: (e) => e.tags.includes(tag) };
  }, [view.filter]);
  const liveCount = useMemo(() => entries.filter((e) => !e.deletedAt).length, [entries]);

  const visible = useMemo(
    () => entries
      .filter((e) => !!e.deletedAt === !!filter.trash)
      .filter(filter.test)
      .filter((e) => matches(e, query))
      .sort(sort.compare),
    [entries, filter, query, sort],
  );
  const selected = visible.find((e) => e.id === selectedId);

  // Toujours un élément affiché quand la liste n'est pas vide
  useEffect(() => {
    if (!selected && visible.length) setSelectedId(visible[0].id);
  }, [selected, visible, setSelectedId]);

  // Éléments cochés (actions groupées) : propres à la liste affichée, oubliés quand on change de filtre.
  // Case à cocher ou Ctrl + clic pour cocher, Maj + clic pour cocher une plage, Ctrl + A pour tout cocher.
  const [checked, setChecked] = useState(() => new Set());
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const anchor = useRef(null);
  useEffect(() => { setChecked(new Set()); anchor.current = null; }, [view.filter]);
  const checkedIds = useMemo(() => visible.filter((e) => checked.has(e.id)).map((e) => e.id), [visible, checked]);
  const allChecked = visible.length > 0 && checkedIds.length === visible.length;
  const clearChecked = () => setChecked(new Set());

  const toggleCheck = (id, range) => {
    setChecked((prev) => {
      const next = new Set(prev);
      const from = range && anchor.current ? visible.findIndex((x) => x.id === anchor.current) : -1;
      const to = visible.findIndex((x) => x.id === id);
      if (from >= 0 && to >= 0) {
        for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(visible[i].id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  };
  const onItemClick = (e, id) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return toggleCheck(id, e.shiftKey);
    setSelectedId(id);
  };

  const n = checkedIds.length;
  const many = (one, more) => (n > 1 ? `${n} ${more}` : one);
  const bulk = (fn, message) => guard(async () => {
    setEntries(await fn(checkedIds));
    clearChecked();
    toast(message);
  });

  const listRef = useRef(null);
  const select = (item) => {
    if (!item) return;
    setSelectedId(item.id);
    listRef.current?.querySelector(`[data-id="${item.id}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  // Saisie de lettres : saute à l'élément dont le nom commence ainsi (lettres tapées vite = début de mot)
  const typed = useRef({ text: '', at: 0 });
  const copySelected = (key, label) => guard(async () => {
    const s = await window.pimkey.clip.copy(selected.id, key);
    toast(`${label} copié${s ? ` · effacé du presse-papiers dans ${s} s` : ''}`);
  });

  // Clavier dans la liste : ↑ ↓ Début Fin Page↑ Page↓, Entrée modifier, Suppr supprimer, Espace cocher,
  // Ctrl + A tout cocher, Ctrl + C copier le mot de passe, Ctrl + B copier l'identifiant, lettres : aller au nom
  const onListKey = (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const i = visible.findIndex((x) => x.id === selectedId);
    const key = e.key.toLowerCase();
    if (e.key === 'Escape' && n) return clearChecked();
    if (ctrl && key === 'a') { e.preventDefault(); return setChecked(new Set(visible.map((x) => x.id))); }
    if (ctrl && (key === 'c' || key === 'b') && selected?.type === 'login') {
      e.preventDefault();
      if (key === 'c' && selected.secrets.password) copySelected('password', 'Mot de passe')();
      if (key === 'b' && selected.fields.username) copySelected('username', 'Identifiant')();
      return;
    }
    if (e.key === ' ' && selectedId) { e.preventDefault(); return toggleCheck(selectedId); }
    if (e.key === 'Enter' && selected && !filter.trash) { e.preventDefault(); return setEditor({ entry: selected }); }
    if (e.key === 'Delete' && (n || selected)) {
      e.preventDefault();
      if (!n) setChecked(new Set([selected.id]));
      return setBulkConfirm(filter.trash ? 'delete' : 'trash');
    }
    const moves = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: visible.length - 1, PageDown: i + 10, PageUp: i - 10 };
    if (e.key in moves) {
      e.preventDefault();
      return select(visible[Math.max(0, Math.min(visible.length - 1, moves[e.key]))]);
    }
    if (e.key.length === 1 && !ctrl && !e.altKey && e.key.trim()) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 800 ? typed.current.text : '') + key, at: now };
      const t = typed.current.text;
      const starts = (x) => x.title.toLowerCase().startsWith(t);
      // Une seule lettre : élément suivant qui commence par elle (on fait le tour) ; plusieurs : le premier qui correspond
      select(t.length === 1 ? [...visible.slice(i + 1), ...visible.slice(0, i + 1)].find(starts) : visible.find(starts));
    }
  };

  // Ctrl + N : nouvel élément (de la catégorie affichée, sinon un identifiant), quand aucune fenêtre n'est ouverte
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'n' || document.querySelector('.modal')) return;
      e.preventDefault();
      setEditor({ type: TYPES[view.filter] ? view.filter : 'login' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.filter]);

  return (
    <div className="vault">
      <section className="list-pane">
        {n ? (
          <div className="list-head bulk">
            <span role="checkbox" aria-checked={allChecked ? 'true' : 'mixed'} tabIndex={0} className="check on"
              title={allChecked ? 'Tout décocher' : 'Tout cocher'}
              onClick={() => setChecked(allChecked ? new Set() : new Set(visible.map((x) => x.id)))}
              onKeyDown={(ev) => ev.key === ' ' && (ev.preventDefault(), ev.currentTarget.click())}>
              {allChecked ? <Check /> : <Minus />}
            </span>
            <strong className="bulk-count">{many('1 sélectionné', 'sélectionnés')}</strong>
            {filter.trash ? (
              <>
                <button className="btn sm" onClick={bulk(window.pimkey.entries.restoreMany, many('Élément restauré', 'éléments restaurés'))}>
                  <ArchiveRestore /> Restaurer
                </button>
                <button className="btn sm icon danger" title="Supprimer définitivement" onClick={() => setBulkConfirm('delete')}><Trash2 /></button>
              </>
            ) : (
              <button className="btn sm danger" onClick={() => setBulkConfirm('trash')}><Trash2 /> Supprimer</button>
            )}
            <button className="btn ghost sm icon" title="Annuler la sélection (Échap)" onClick={clearChecked}><X /></button>
          </div>
        ) : (
          <div className="list-head">
            <h1>{filter.label}</h1>
            <span className="count">{visible.length}</span>
            {filter.trash ? (
              visible.length > 0 && !query && <button className="btn sm danger" onClick={() => setConfirmEmpty(true)}><Trash2 /> Vider</button>
            ) : (
              <>
                <SortMenu value={SORTS[settings.sortBy] ? settings.sortBy : 'name'} onChange={(sortBy) => updateSettings({ sortBy })} />
                <NewButton filter={view.filter} onPick={(type) => setEditor({ type })} />
              </>
            )}
          </div>
        )}
        <div className={`list-scroll ${n ? 'selecting' : ''}`} ref={listRef} tabIndex={0} onKeyDown={onListKey}>
          {visible.map((e) => (
            <button key={e.id} data-id={e.id} className={`item ${e.id === selectedId ? 'active' : ''} ${checked.has(e.id) ? 'checked' : ''}`}
              onClick={(ev) => onItemClick(ev, e.id)}>
              <span className="item-lead">
                <Avatar entry={e} />
                <span role="checkbox" aria-checked={checked.has(e.id)} aria-label={`Cocher ${e.title}`} className="item-check"
                  onClick={(ev) => { ev.stopPropagation(); toggleCheck(e.id, ev.shiftKey); }}>
                  <span className={`check ${checked.has(e.id) ? 'on' : ''}`}>{checked.has(e.id) && <Check />}</span>
                </span>
              </span>
              <span className="item-txt">
                <strong>{e.title}</strong>
                <span>{subtitle(e) || TYPES[e.type].label}</span>
              </span>
              {expiryState(e) && <span className={`dot-state ${expiryState(e)}`} title={EXPIRY_LABEL[expiryState(e)]} />}
              {e.favorite && <Star className="fav-ico" />}
            </button>
          ))}
          {!visible.length && query && (
            <div className="list-empty">
              <Search />
              Aucun résultat pour « {query} »
              <button className="link-btn" onClick={() => setQuery('')}>Effacer la recherche</button>
            </div>
          )}
          {!visible.length && !query && filter.trash && (
            <div className="list-empty">
              <Trash2 />
              La corbeille est vide. Un élément supprimé y reste {TRASH_DAYS} jours avant d’être effacé.
            </div>
          )}
          {!visible.length && !query && !filter.trash && liveCount > 0 && <div className="list-empty">Rien ici pour le moment.</div>}
        </div>
      </section>

      <section className="detail">
        {selected ? (
          <Detail key={selected.id} entry={selected} onEdit={() => setEditor({ entry: selected })} onDeleted={() => setSelectedId(null)}
            onDuplicated={(id, list) => {
              setQuery('');
              setSelectedId(id);
              setEditor({ entry: list.find((e) => e.id === id), duplicate: true });
            }} />
        ) : (
          <div className="empty-state">
            {filter.trash ? <Trash2 /> : <VaultIcon />}
            <h3>{liveCount || filter.trash ? 'Aucun élément sélectionné' : 'Votre coffre est vide'}</h3>
            <p>
              {liveCount || filter.trash
                ? 'Choisissez un élément dans la liste.'
                : 'Ajoutez vos identifiants, documents d’identité, cartes bancaires et notes. Tout est chiffré sur cet ordinateur.'}
            </p>
            {!liveCount && !filter.trash && (
              <div className="empty-actions">
                {TYPE_IDS.map((t) => {
                  const Icon = TYPE_ICONS[t];
                  return <button key={t} className="btn" onClick={() => setEditor({ type: t })}><Icon /> {TYPES[t].label}</button>;
                })}
              </div>
            )}
            {!liveCount && !filter.trash && (
              <button className="link-btn empty-import" onClick={() => setImporting(true)}>
                <Upload size={14} /> Importer depuis Chrome, Edge, Firefox, Bitwarden ou KeePass
              </button>
            )}
          </div>
        )}
      </section>

      {editor && (
        <EntryEditor
          entry={editor.entry}
          type={editor.type}
          tags={filter.tag ? [filter.tag] : []}
          onClose={guard(async () => {
            // Copie fraîchement dupliquée puis abandonnée : on ne la garde pas
            if (editor.duplicate) setEntries(await window.pimkey.entries.removeMany([editor.entry.id]));
            setEditor(null);
          })}
          onSaved={(id) => { setEditor(null); setQuery(''); setSelectedId(id); }}
        />
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {bulkConfirm === 'trash' && (
        <Confirm
          title={n > 1 ? `Supprimer ${n} éléments ?` : 'Supprimer cet élément ?'}
          text={n > 1
            ? `Ils seront placés dans la corbeille, d’où vous pourrez les restaurer pendant ${TRASH_DAYS} jours.`
            : `Il sera placé dans la corbeille, d’où vous pourrez le restaurer pendant ${TRASH_DAYS} jours.`}
          action="Mettre à la corbeille"
          onConfirm={bulk(window.pimkey.entries.trashMany, many('Élément mis à la corbeille', 'éléments mis à la corbeille'))}
          onClose={() => setBulkConfirm(null)}
        />
      )}
      {bulkConfirm === 'delete' && (
        <Confirm
          title={n > 1 ? `Supprimer définitivement ${n} éléments ?` : 'Supprimer définitivement ?'}
          text={`${many('L’élément sélectionné et ses pièces jointes seront effacés', 'Les éléments sélectionnés et leurs pièces jointes seront effacés')} du coffre. Cette action est irréversible.`}
          action="Supprimer définitivement"
          onConfirm={bulk(window.pimkey.entries.removeMany, many('Élément supprimé définitivement', 'éléments supprimés définitivement'))}
          onClose={() => setBulkConfirm(null)}
        />
      )}
      {confirmEmpty && (
        <Confirm
          title="Vider la corbeille ?"
          text={`${visible.length > 1 ? `Les ${visible.length} éléments` : 'L’élément'} de la corbeille et leurs pièces jointes seront effacés du coffre. Cette action est irréversible.`}
          action="Vider la corbeille"
          onConfirm={guard(async () => { setEntries(await window.pimkey.entries.emptyTrash()); toast('Corbeille vidée'); })}
          onClose={() => setConfirmEmpty(false)}
        />
      )}
    </div>
  );
}
