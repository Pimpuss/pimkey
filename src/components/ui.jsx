import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Eye, EyeOff, X } from 'lucide-react';
import { TYPE_ICONS } from '../lib/types.js';
import { strength } from '../lib/password.js';

export function gradientFor(name = '') {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `linear-gradient(160deg, hsl(${h} 55% 42%), hsl(${(h + 50) % 360} 60% 22%))`;
}

// Pastille d'un élément : logo choisi ou icône du site sur fond clair, sinon initiale sur un dégradé tiré du nom
export function Avatar({ entry, size }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [entry.icon]);
  if (entry.icon && !broken) {
    return (
      <span className={`avatar img ${size || ''}`}>
        <img src={entry.icon} alt="" draggable={false} onError={() => setBroken(true)} />
      </span>
    );
  }
  const Icon = TYPE_ICONS[entry.type];
  const letter = entry.type === 'login' && entry.title.trim() ? entry.title.trim()[0].toUpperCase() : null;
  return (
    <span className={`avatar ${size || ''}`} style={{ background: gradientFor(entry.title) }}>
      {letter || <Icon />}
    </span>
  );
}

export function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      className={`toggle ${on ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

// Fenêtres ouvertes, de la plus ancienne à la plus récente : Échap ne ferme que celle du dessus
const modalStack = [];

// persistent : un clic à côté ne ferme pas la fenêtre (formulaires en cours de saisie)
export function Modal({ title, onClose, children, footer, wide, persistent }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const me = {};
    modalStack.push(me);
    const onKey = (e) => e.key === 'Escape' && modalStack.at(-1) === me && close.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(me), 1);
    };
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => !persistent && e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} style={wide ? { width: 'min(860px, calc(100vw - 40px))' } : undefined}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn ghost sm icon" onClick={onClose} aria-label="Fermer"><X /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Menu déroulant aux couleurs de l'app (remplace le <select> natif de Windows).
// options : [[valeur, libellé, Icône?], …]
export function Select({ value, options, onChange, label = 'Choisir', width }) {
  const [open, setOpen] = useState(false);
  const current = Math.max(0, options.findIndex(([v]) => v === value));
  const [hi, setHi] = useState(current);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    setHi(current);
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (i) => { onChange(options[i][0]); setOpen(false); };
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); return setOpen(false); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) pick(hi); else setOpen(true);
    }
  };

  const [, curLabel, CurIcon] = options[current];
  return (
    <div className="dd" ref={ref} style={{ width }}>
      <button type="button" className={`dd-btn ${open ? 'open' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => setOpen(!open)} onKeyDown={onKeyDown}>
        {CurIcon && <CurIcon className="dd-ico" />}
        <span>{curLabel}</span>
        <ChevronDown className="dd-chev" />
      </button>
      {open && (
        <div className="dd-menu" role="listbox">
          {options.map(([v, l, Icon], i) => (
            <button type="button" key={v} role="option" aria-selected={v === value}
              className={`dd-opt ${v === value ? 'sel' : ''} ${i === hi ? 'hi' : ''}`}
              onMouseEnter={() => setHi(i)} onClick={() => pick(i)}>
              {Icon && <Icon className="dd-ico" />}
              <span>{l}</span>
              {v === value && <Check className="dd-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Champ mot de passe avec œil (affichage local, sans mot de passe maître : c'est ce que l'on est en train de taper)
export function PasswordInput({ value, onChange, className = '', ...rest }) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const onKey = (e) => setCaps(e.getModifierState?.('CapsLock'));
  return (
    <div className="pw-wrap">
      <div className="pw-input">
        <input
          {...rest}
          className={`input ${className}`}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          onKeyUp={onKey}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="btn ghost sm icon eye" tabIndex={-1} onClick={() => setShown(!shown)}
          title={shown ? 'Masquer' : 'Afficher'}>
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {caps && <div className="caps">Verrouillage des majuscules activé</div>}
    </div>
  );
}

export function StrengthBar({ password }) {
  const { score, label } = strength(password);
  if (!password) return null;
  return (
    <div className="strength-row">
      <div className={`strength s${score}`}><span /><span /><span /><span /></div>
      <span className={`strength-label s${score}`}>{label}</span>
    </div>
  );
}
