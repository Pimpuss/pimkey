import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { applyAccent } from './accent.js';
import MasterPrompt from '../components/MasterPrompt.jsx';
import PairPrompt from '../components/PairPrompt.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function AppProvider({ children }) {
  // loading → setup (aucun coffre) | locked | unlocked
  const [status, setStatus] = useState('loading');
  const [lockReason, setLockReason] = useState(null);
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState({});
  const [view, setView] = useState({ page: 'vault', filter: 'all' });
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [prompt, setPrompt] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [update, setUpdate] = useState({ state: 'idle' });
  const [pair, setPair] = useState(null); // demande d'appairage d'une extension navigateur
  const toastId = useRef(0);

  const toast = useCallback((text, kind = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const guard = useCallback(
    (fn) => async (...args) => {
      try {
        return await fn(...args);
      } catch (e) {
        toast(errText(e), 'error');
        return undefined;
      }
    },
    [toast],
  );

  // Tout ce qui est déchiffré est oublié dès le verrouillage
  const onLocked = useCallback((reason) => {
    setEntries([]);
    setSelectedId(null);
    setQuery('');
    setPrompt((p) => { p?.resolve(undefined); return null; });
    setPair(null);
    setLockReason(reason || null);
    setStatus('locked');
  }, []);

  const onUnlocked = useCallback((list) => {
    setEntries(list);
    setView({ page: 'vault', filter: 'all' });
    setLockReason(null);
    setStatus('unlocked');
  }, []);

  useEffect(() => {
    window.pimkey.settings.get().then(setSettings);
    window.pimkey.vault.status().then(async (s) => {
      if (s.unlocked) onUnlocked(await window.pimkey.entries.list());
      else setStatus(s.exists ? 'locked' : 'setup');
    });
    // 'entries' : liste mise à jour par le processus principal (icônes de sites récupérées en arrière-plan)
    // 'show' : clic sur une notification d'expiration (un élément, ou le filtre « À renouveler »)
    const onShow = ({ id, filter }) => {
      setQuery('');
      setView({ page: 'vault', filter: id ? 'all' : filter || 'all' });
      if (id) setSelectedId(id);
    };
    window.pimkey.update.status().then(setUpdate).catch(() => {});
    // 'pair' : appairage d'une extension demandé (code à comparer), abandonné (null) ou terminé ({ done: nom })
    const onPair = (p) => {
      if (p?.done) {
        setPair(null);
        toast(`${p.done} est appairé à Pimkey`);
      } else setPair(p);
    };
    // 'sync' : fusion avec le dossier synchronisé ; notice : conflits, mot de passe maître changé ailleurs
    const onSync = (s) => { if (s?.notice) toast(s.notice); };
    const offs = [window.pimkey.on('locked', onLocked), window.pimkey.on('entries', setEntries), window.pimkey.on('show', onShow), window.pimkey.on('update', setUpdate),
      window.pimkey.on('pair', onPair), window.pimkey.on('sync', onSync)];
    return () => offs.forEach((off) => off());
  }, [onLocked, onUnlocked, toast]);

  // Activité souris / clavier : repousse le verrouillage automatique (signalée au plus toutes les 15 s)
  useEffect(() => {
    if (status !== 'unlocked') return;
    let last = 0;
    const ping = () => {
      if (Date.now() - last < 15e3) return;
      last = Date.now();
      window.pimkey.app.activity();
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, ping, { passive: true }));
    return () => events.forEach((ev) => window.removeEventListener(ev, ping));
  }, [status]);

  useEffect(() => { applyAccent(settings.accent); }, [settings.accent]);

  const updateSettings = useMemo(() => guard(async (patch) => setSettings(await window.pimkey.settings.set(patch))), [guard]);

  const lock = useCallback(async () => {
    await window.pimkey.vault.lock();
    onLocked('manual');
  }, [onLocked]);

  // Demande le mot de passe maître puis exécute action(master) ; la fenêtre reste ouverte tant que
  // l'action échoue (mot de passe incorrect). Résout avec le résultat, ou undefined si annulé.
  // Dans le délai de grâce (réglage), action(null) réussit directement et rien n'est demandé.
  const askMaster = useCallback(async (opts) => {
    try {
      return await opts.action(null);
    } catch {
      return new Promise((resolve) => setPrompt({ ...opts, resolve }));
    }
  }, []);

  const value = useMemo(
    () => ({
      status, setStatus, lockReason, entries, setEntries, settings, setSettings, updateSettings, view, setView, selectedId, setSelectedId,
      query, setQuery, toast, guard, lock, onLocked, onUnlocked, askMaster, update,
    }),
    [status, lockReason, entries, settings, updateSettings, view, selectedId, query, toast, guard, lock, onLocked, onUnlocked, askMaster, update],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {prompt && <MasterPrompt prompt={prompt} onDone={() => setPrompt(null)} />}
      {pair && status === 'unlocked' && (
        <PairPrompt pair={pair} onDone={(ok) => { setPair(null); if (ok) toast('Approuvé : confirmez aussi dans le navigateur'); }} />
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
