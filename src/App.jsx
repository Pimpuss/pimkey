import { useEffect, useMemo } from 'react';
import { Layers, Lock as LockIcon, Search, Settings as SettingsIcon, ShieldCheck, Star, Tag, Trash2, TriangleAlert, X } from 'lucide-react';
import Logo from './components/Logo.jsx';
import { AppProvider, useApp } from './lib/context.jsx';
import { TYPES, TYPE_ICONS, TYPE_IDS, expiryState } from './lib/types.js';
import Lock from './pages/Lock.jsx';
import Vault from './pages/Vault.jsx';
import Settings from './pages/Settings.jsx';
import Audit, { issueCount } from './pages/Audit.jsx';

function TitleBar() {
  const { query, setQuery, view, setView, lock } = useApp();
  return (
    <header className="titlebar">
      <div className="brand">
        <span className="brand-mark"><Logo size={22} /></span>
        Pimkey
      </div>
      <label className="search">
        <Search size={15} />
        <input
          placeholder="Rechercher dans le coffre…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (view.page !== 'vault') setView({ page: 'vault', filter: 'all' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
            // ↓ ou Entrée : on passe à la liste pour la parcourir au clavier
            if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); document.querySelector('.list-scroll')?.focus(); }
          }}
        />
        {query && <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Effacer"><X size={14} /></button>}
      </label>
      <span className="grow" />
      <button className="btn sm lock-btn" onClick={lock} title="Verrouiller le coffre (Ctrl + L)">
        <LockIcon /> Verrouiller
      </button>
    </header>
  );
}

function Sidebar() {
  const { entries, view, setView, settings, update } = useApp();
  const counts = useMemo(() => {
    const live = entries.filter((e) => !e.deletedAt);
    const c = {
      all: live.length, favorites: live.filter((e) => e.favorite).length, expiring: live.filter((e) => expiryState(e)).length,
      trash: entries.length - live.length,
      audit: issueCount(entries),
    };
    for (const t of TYPE_IDS) c[t] = live.filter((e) => e.type === t).length;
    for (const e of live) for (const t of e.tags || []) c[`tag:${t}`] = (c[`tag:${t}`] || 0) + 1;
    return c;
  }, [entries]);
  const tags = Object.keys(counts).filter((k) => k.startsWith('tag:')).map((k) => k.slice(4)).sort((a, b) => a.localeCompare(b, 'fr'));

  const item = (filter, label, Icon) => (
    <button
      key={filter}
      className={`nav-item ${view.page === 'vault' && view.filter === filter ? 'active' : ''}`}
      onClick={() => setView({ page: 'vault', filter })}
    >
      <Icon /> {label}
      {counts[filter] > 0 && <span className="count">{counts[filter]}</span>}
    </button>
  );

  const autoLock = settings.autoLockMinutes ?? 5;
  return (
    <nav className="sidebar">
      {item('all', 'Tous les éléments', Layers)}
      {item('favorites', 'Favoris', Star)}
      <button className={`nav-item ${view.page === 'audit' ? 'active' : ''}`} onClick={() => setView({ page: 'audit', filter: view.filter })}>
        <ShieldCheck /> Santé des mots de passe
        {counts.audit > 0 && <span className="count warn">{counts.audit}</span>}
      </button>
      <div className="side-title">Catégories</div>
      {TYPE_IDS.map((t) => item(t, TYPES[t].plural, TYPE_ICONS[t]))}
      {tags.length > 0 && <div className="side-title">Étiquettes</div>}
      {tags.map((t) => item(`tag:${t}`, t, Tag))}

      {counts.expiring > 0 && (
        <button className={`side-alert ${view.filter === 'expiring' ? 'active' : ''}`} onClick={() => setView({ page: 'vault', filter: 'expiring' })}>
          <TriangleAlert />
          <span>{counts.expiring} {counts.expiring > 1 ? 'éléments expirés ou bientôt' : 'élément expiré ou bientôt'}</span>
        </button>
      )}

      <div className="side-spacer" />
      {item('trash', 'Corbeille', Trash2)}
      <button className={`nav-item ${view.page === 'settings' ? 'active' : ''}`} onClick={() => setView({ page: 'settings', filter: view.filter })}>
        <SettingsIcon /> Paramètres
      </button>
      {update.state === 'ready' && (
        <button className="update-card" onClick={() => window.pimkey.update.install()} title="Pimkey redémarre sur la nouvelle version">
          <strong>Pimkey {update.version} est prêt</strong>
          <span>Redémarrer pour installer</span>
        </button>
      )}
      <div className="status-card">
        <span className="pill ok"><span className="dot" /> Coffre ouvert</span>
        <div className="muted">{autoLock ? `Verrouillage auto après ${autoLock} min d’inactivité` : 'Verrouillage auto désactivé'}</div>
      </div>
    </nav>
  );
}

function Shell() {
  const { view, lock } = useApp();
  // Ctrl + L : verrouiller ; Ctrl + F : rechercher
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey) return;
      if (e.key.toLowerCase() === 'l') { e.preventDefault(); lock(); }
      if (e.key.toLowerCase() === 'f') { e.preventDefault(); document.querySelector('.search input')?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lock]);
  return (
    <div className="app">
      <TitleBar />
      <Sidebar />
      <main className="main">{view.page === 'settings' ? <Settings /> : view.page === 'audit' ? <Audit /> : <Vault />}</main>
    </div>
  );
}

function Root() {
  const { status } = useApp();
  if (status === 'loading') return <div className="lock" />;
  return status === 'unlocked' ? <Shell /> : <Lock />;
}

export default function App() {
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  );
}
