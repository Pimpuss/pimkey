// Clé d'appairage de l'extension, dans IndexedDB de l'extension : inaccessible aux scripts de contenu (qui, eux,
// partagent chrome.storage.local) et rangée en CryptoKey non extractible, que même ce code ne peut plus relire.
import { importPairKey } from './bridge.mjs';

const DB = 'pimkey';
const STORE = 'kv';

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
    });
  } finally {
    d.close();
  }
}

// { id, name, keys: { mac, kdf } } ou null
export const loadPairing = () => tx('readonly', (s) => s.get('pairing')).then((p) => p || null);

export async function savePairing({ id, name, key }) {
  const keys = await importPairKey(key);
  await tx('readwrite', (s) => s.put({ id, name, keys, at: Date.now() }, 'pairing'));
}

export const clearPairing = () => tx('readwrite', (s) => s.delete('pairing'));
