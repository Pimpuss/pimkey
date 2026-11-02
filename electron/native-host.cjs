// Hôte natif de l'extension navigateur, lancé par Chrome ou Edge (manifeste enregistré dans HKCU depuis les
// Paramètres de Pimkey) avec Pimkey.exe en mode Node (ELECTRON_RUN_AS_NODE, voir pimkey-host.cmd).
// Simple relais : chaque message du navigateur (stdin : longueur sur 4 octets puis JSON) part tel quel vers Pimkey
// par un tube nommé, et inversement. Appairage et messages sont authentifiés et chiffrés de bout en bout entre
// l'extension et Pimkey : ce relais ne comprend ni ne garde rien, le remplacer ne donne accès à rien.
//
// Pimkey absent (fermé, ou extension désactivée dans ses Paramètres) : l'hôte répond { t: 'absent' } ; sur
// { t: 'launch' }, il ouvre Pimkey et se connecte dès que le tube apparaît ({ t: 'present' }).
const crypto = require('node:crypto');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_FRAME = 1024 * 1024;

// Tube propre à l'utilisateur Windows (les noms de tubes sont communs à toute la machine)
function pipeName() {
  if (process.env.PIMKEY_BRIDGE_PIPE) return process.env.PIMKEY_BRIDGE_PIPE;
  const id = crypto.createHash('sha256').update(os.homedir().toLowerCase()).digest('hex').slice(0, 16);
  return `\\\\.\\pipe\\pimkey-browser-${id}`;
}

const frame = (obj) => {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
};

// Découpe un flux en messages ; un message trop long ou illisible coupe la connexion (onError)
function frameReader(onMessage, onError) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (len > MAX_FRAME) return onError(new Error('Message trop long.'));
      if (buf.length < 4 + len) return;
      const body = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      let msg;
      try { msg = JSON.parse(body.toString('utf8')); } catch { return onError(new Error('Message illisible.')); }
      onMessage(msg);
    }
  };
}

// Ouvre Pimkey : l'app installée (Pimkey.exe), ou en développement electron.exe sur le dossier du projet.
// Lancé détaché, sans ELECTRON_RUN_AS_NODE, pour qu'il survive à l'hôte et démarre en vraie app.
function launchPimkey() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const dev = !__dirname.includes('app.asar');
  const child = spawn(process.execPath, dev ? [path.join(__dirname, '..')] : [], { detached: true, stdio: 'ignore', env, windowsHide: false });
  child.on('error', () => {});
  child.unref();
}

function run() {
  const out = (obj) => process.stdout.write(frame(obj));
  // Sortie après l'envoi de ce qui reste à écrire vers le navigateur
  const quit = (code) => process.stdout.write('', () => process.exit(code));
  // connecting → connected | absent ; absent → launching (sur { t: 'launch' }) → connected | absent
  let state = 'connecting';
  let pipe = null;
  let queue = []; // messages reçus pendant la première tentative de connexion

  const handle = (msg) => {
    if (state === 'connected') pipe.write(frame(msg));
    else if (state === 'connecting') queue.push(msg);
    else if (msg?.t === 'launch' && state === 'absent') {
      state = 'launching';
      launchPimkey();
      waitForPimkey(Date.now() + 30e3);
    } else if (state === 'absent') out({ t: 'absent' });
  };

  function connect(onFail) {
    const socket = net.connect(pipeName());
    socket.once('connect', () => {
      const wasLaunching = state === 'launching';
      pipe = socket;
      state = 'connected';
      socket.on('data', frameReader((msg) => out(msg), () => quit(1)));
      socket.on('close', () => quit(0));
      socket.on('error', () => quit(0));
      if (wasLaunching) out({ t: 'present' });
      for (const msg of queue) socket.write(frame(msg));
      queue = [];
    });
    socket.once('error', () => { if (!pipe) onFail(); });
  }

  function waitForPimkey(until) {
    connect(() => {
      if (Date.now() > until) { state = 'absent'; out({ t: 'absent' }); return; }
      setTimeout(() => waitForPimkey(until), 400);
    });
  }

  process.stdin.on('data', frameReader(handle, () => quit(1)));
  process.stdin.on('end', () => quit(0));
  connect(() => {
    state = 'absent';
    const waiting = queue;
    queue = [];
    for (const msg of waiting) handle(msg);
  });
}

if (require.main === module) run();

module.exports = { pipeName, frame, frameReader, MAX_FRAME };
