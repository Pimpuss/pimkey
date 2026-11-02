import '@fontsource-variable/inter';
import './styles.css';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

async function boot() {
  // Hors Electron (aperçu navigateur), on branche une API factice pour travailler l'interface.
  if (!window.pimkey) {
    const { installMock } = await import('./lib/mock.js');
    installMock();
  }
  createRoot(document.getElementById('root')).render(<App />);
}

boot();
