// Test de la liaison avec l'extension navigateur, sans Electron ni navigateur : protocole (appairage, authentification,
// canal chiffré), serveur sur un vrai tube nommé avec un vrai coffre, et hôte natif (native-host.cjs) en processus séparé.
// Le « client » joue le rôle de l'extension (mêmes messages que extension/lib/link.js et extension/pair.js).
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const P = require('../shared/bridge.mjs');
const { Vault } = require('../electron/vault.cjs');
const { Bridge, pageOf, matchPage } = require('../electron/bridge.cjs');
const { frame, frameReader } = require('../electron/native-host.cjs');

const MASTER = 'correct horse battery';
const step = (s) => console.log('✓', s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Connexion brute : messages reçus en file, comme le port natif de l'extension
function wrap(write, onData, end) {
  const box = { queue: [], waiters: [], closed: false, raw: [] };
  onData(frameReader((m) => {
    box.raw.push(m);
    if (box.waiters.length) box.waiters.shift()(m);
    else box.queue.push(m);
  }, () => {}));
  box.post = (m) => write(frame(m));
  box.next = (ms = 3000) => new Promise((resolve, reject) => {
    if (box.queue.length) return resolve(box.queue.shift());
    if (box.closed) return reject(new Error('closed'));
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    box.waiters.push((m) => { clearTimeout(t); resolve(m); });
  });
  box.close = end;
  return box;
}

function connectPipe(pipe) {
  return new Promise((resolve, reject) => {
    const s = net.connect(pipe);
    s.once('error', reject);
    s.once('connect', () => {
      const box = wrap((b) => s.write(b), (fn) => s.on('data', fn), () => s.destroy());
      s.on('close', () => {
        box.closed = true;
        for (const w of box.waiters.splice(0)) w({ t: '__closed' });
      });
      box.socket = s;
      resolve(box);
    });
  });
}

// L'hôte natif lancé comme le ferait le navigateur (stdin / stdout), sur le tube du test
function spawnHost(pipe) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'electron', 'native-host.cjs'), 'chrome-extension://test/'], {
    env: { ...process.env, PIMKEY_BRIDGE_PIPE: pipe }, stdio: ['pipe', 'pipe', 'inherit'],
  });
  const box = wrap((b) => child.stdin.write(b), (fn) => child.stdout.on('data', fn), () => child.kill());
  child.on('exit', () => {
    box.closed = true;
    for (const w of box.waiters.splice(0)) w({ t: '__closed' });
  });
  box.child = child;
  return box;
}

// Appairage côté extension (comme extension/pair.js) ; approve : réponse de la fenêtre de Pimkey
async function pairClient(box, { name = 'Chrome', tamperCommit = false, replaces } = {}) {
  const own = await P.pairingKeyPair();
  box.post({ t: 'pair', name, commit: tamperCommit ? P.randomB64(32) : await P.sha256B64(own.pub), replaces });
  const r = await box.next();
  if (r.t !== 'pair') return { reply: r };
  box.post({ t: 'pair-key', pub: own.pub });
  const secret = await P.pairingSecret(own.privateKey, r.pub, own.pub, r.pub);
  const keys = await P.importPairKey(secret.key);
  box.post({ t: 'pair-ok', mac: await P.sign(keys, 'pair-ext', own.pub, r.pub) });
  const done = await box.next();
  const ok = done.t === 'paired' && (await P.verify(keys, done.mac, 'pair-app', done.id, own.pub, r.pub));
  return { reply: done, ok, id: done.id, key: secret.key, code: secret.code };
}

// Authentification côté extension (comme Session.open de extension/lib/link.js)
async function authClient(box, id, key) {
  const keys = await P.importPairKey(key);
  const nc = P.randomB64(32);
  box.post({ t: 'auth', id, nc });
  const a = await box.next();
  if (a.t !== 'auth') return { reply: a };
  if (!(await P.verify(keys, a.mac, 'server', id, nc, a.ns))) return { impostor: true };
  const channel = await P.Channel.open(keys, nc, a.ns, 'client');
  box.post({ t: 'auth2', mac: await P.sign(keys, 'client', id, nc, a.ns) });
  const ready = await channel.open(await box.next());
  assert.equal(ready.t, 'ready');
  let seq = 0;
  const request = async (op, params = {}) => {
    const rid = ++seq;
    box.post(await channel.seal({ ...params, op, rid }));
    const m = await box.next();
    if (m.t === '__closed') throw new Error('closed');
    const reply = await channel.open(m);
    assert.equal(reply.rid, rid, 'la réponse reprend le numéro de la requête');
    return reply;
  };
  return { channel, request };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pimkey-bridge-'));
  const pipe = `\\\\.\\pipe\\pimkey-test-${process.pid}-${Date.now()}`;
  let bridge = null;
  try {
    // ---------- Protocole seul ----------
    {
      const ext = await P.pairingKeyPair();
      const app = await P.pairingKeyPair();
      const a = await P.pairingSecret(ext.privateKey, app.pub, ext.pub, app.pub);
      const b = await P.pairingSecret(app.privateKey, ext.pub, ext.pub, app.pub);
      assert.deepEqual(a, b);
      assert.match(a.code, /^\d{6}$/);
      // Intermédiaire : une clé à lui de chaque côté → deux secrets et deux codes différents
      const mitm = await P.pairingKeyPair();
      const extSide = await P.pairingSecret(ext.privateKey, mitm.pub, ext.pub, mitm.pub);
      const appSide = await P.pairingSecret(app.privateKey, mitm.pub, mitm.pub, app.pub);
      assert.notEqual(extSide.key, appSide.key);
      assert.notEqual(extSide.code, appSide.code);
      await assert.rejects(P.pairingSecret(ext.privateKey, P.toB64(new Uint8Array(65)), ext.pub, app.pub));
      step('appairage ECDH : même code des deux côtés, différent avec un intermédiaire');

      const keys = await P.importPairKey(a.key);
      const nc = P.randomB64(32);
      const ns = P.randomB64(32);
      const client = await P.Channel.open(keys, nc, ns, 'client');
      const server = await P.Channel.open(keys, nc, ns, 'server');
      const m1 = await client.seal({ hello: 1 });
      const m2 = await client.seal({ hello: 2 });
      assert.deepEqual(await server.open(m1), { hello: 1 });
      await assert.rejects(server.open(m1), /séquence/); // rejeu
      const bad = { ...m2, d: P.toB64(P.fromB64(m2.d).map((x, i) => (i === 3 ? x ^ 1 : x))) };
      await assert.rejects(server.open(bad), /altéré/);
      // Un message chiffré pour le serveur ne se relit pas comme une réponse du serveur (clés propres à chaque sens)
      const c2 = await P.Channel.open(keys, nc, ns, 'client');
      await assert.rejects(c2.open(await (await P.Channel.open(keys, nc, ns, 'client')).seal({ x: 1 })), /altéré/);
      // Autre session (autres nonces) : illisible
      const other = await P.Channel.open(keys, P.randomB64(32), ns, 'server');
      await assert.rejects(other.open(await (await P.Channel.open(keys, nc, ns, 'client')).seal({ x: 1 })), /altéré/);
      assert.equal(await P.verify(keys, await P.sign(keys, 'server', 'a', 'b'), 'server', 'ab', ''), false);
      step('canal chiffré : rejeu, altération, mauvais sens et autre session refusés');
    }

    // ---------- Sites ----------
    {
      const e = (url) => ({ fields: { url } });
      const page = pageOf('https://accounts.example.com/login?next=/');
      assert.ok(matchPage(e('https://example.com'), page));
      assert.equal(matchPage(e('example.com'), page).exact, false);
      assert.equal(matchPage(e('https://accounts.example.com/'), page).exact, true);
      assert.equal(matchPage(e('https://example.com.evil.net'), page), null);
      assert.equal(matchPage(e('https://evil-example.com'), page), null);
      assert.equal(matchPage(e('https://alice.github.io'), pageOf('https://bob.github.io/')), null, 'hébergement partagé');
      assert.ok(matchPage(e('https://alice.github.io/app'), pageOf('https://alice.github.io/login')));
      assert.ok(matchPage(e('https://impots.gouv.fr'), pageOf('https://cfspart.impots.gouv.fr/')));
      assert.equal(matchPage(e('https://ameli.fr'), pageOf('https://impots.gouv.fr/')), null);
      assert.ok(matchPage(e('android://x@com.instagram.android/'), pageOf('https://www.instagram.com/')));
      assert.equal(matchPage(e('https://example.com'), pageOf('http://example.com/')).insecure, true);
      assert.equal(matchPage(e('http://example.com'), pageOf('http://example.com/')).insecure, false);
      assert.equal(matchPage(e('https://192.168.1.1:8006'), pageOf('http://192.168.1.1/')).insecure, false, 'réseau local');
      assert.equal(pageOf('file:///C:/x.html'), null);
      assert.equal(pageOf('javascript:alert(1)'), null);
      step('correspondance des sites : domaine principal, hébergements partagés, http');
    }

    // ---------- Serveur réel ----------
    const vault = new Vault(dir);
    await vault.create(MASTER);
    const gh = vault.saveEntry({ type: 'login', title: 'GitHub', fields: { username: 'moi', password: 'Gh-S3cret!', url: 'https://github.com/login', totp: 'JBSWY3DPEHPK3PXP' } });
    vault.saveEntry({ type: 'login', title: 'GitHub pro', fields: { username: 'pro', password: 'Pr0-pass', url: 'github.com' } });
    const evil = vault.saveEntry({ type: 'login', title: 'Autre', fields: { username: 'x', password: 'Autre-pass', url: 'https://gitlab.com' } });
    const router = vault.saveEntry({ type: 'login', title: 'Routeur', fields: { username: 'admin', password: 'R0uteur', url: 'https://192.168.1.1' } });
    vault.lock();

    const events = { approve: true, codes: [], cancelled: 0, copied: [], changed: 0, shown: 0 };
    bridge = new Bridge({
      vault, pipe,
      hooks: {
        approvePair: async ({ code }) => { events.codes.push(code); await wait(30); return events.approve; },
        cancelPair: () => { events.cancelled++; },
        paired: () => {},
        show: () => { events.shown++; },
        copy: (v) => { events.copied.push(v); return 30; },
        changed: () => { events.changed++; },
      },
    });
    await bridge.start();
    await assert.rejects(new Bridge({ vault, pipe, hooks: {} }).start(), /déjà utilisé/);
    step('serveur sur un tube nommé (une seule instance)');

    // Coffre verrouillé : seulement « présent / verrouillé » et afficher Pimkey
    {
      const c = await connectPipe(pipe);
      c.post({ t: 'ping' });
      assert.deepEqual(await c.next(), { t: 'pong', v: P.VERSION, locked: true });
      c.post({ t: 'show' });
      assert.equal((await c.next()).t, 'shown');
      assert.equal(events.shown, 1);
      c.post({ t: 'auth', id: 'x', nc: P.randomB64(32) });
      assert.equal((await c.next()).t, 'locked');
      const p = await pairClient(c);
      assert.equal(p.reply.t, 'locked');
      c.close();
    }
    step('coffre verrouillé : ni authentification ni appairage');

    await vault.unlock(MASTER);

    // Appairage approuvé
    let device;
    {
      const c = await connectPipe(pipe);
      const p = await pairClient(c, { name: 'Chrome' });
      assert.ok(p.ok, 'appairage confirmé et signé par Pimkey');
      assert.equal(events.codes.at(-1), p.code, 'même code affiché dans Pimkey et dans l’extension');
      device = p;
      c.close();
      assert.deepEqual(vault.devices().map((d) => d.name), ['Chrome']);
      assert.equal(vault.devices()[0].key, undefined, 'la clé ne sort pas du coffre');
      assert.ok(!fs.readFileSync(path.join(dir, 'vault.pimkey'), 'utf8').includes(p.key), 'clé d’appairage chiffrée sur le disque');
    }
    step('appairage approuvé : code identique, clé rangée chiffrée dans le coffre');

    // Appairage refusé, engagement trahi, deux appairages à la fois
    {
      events.approve = false;
      const c = await connectPipe(pipe);
      const p = await pairClient(c);
      assert.equal(p.reply.t, 'pair-refused');
      c.close();
      events.approve = true;

      const c2 = await connectPipe(pipe);
      const own = await P.pairingKeyPair();
      c2.post({ t: 'pair', name: 'X', commit: await P.sha256B64(own.pub) });
      await c2.next();
      const other = await P.pairingKeyPair(); // clé choisie après avoir vu celle de Pimkey
      c2.post({ t: 'pair-key', pub: other.pub });
      assert.equal((await c2.next()).t, '__closed', 'engagement non respecté : connexion coupée');

      const c3 = await connectPipe(pipe);
      const c4 = await connectPipe(pipe);
      const own3 = await P.pairingKeyPair();
      c3.post({ t: 'pair', name: 'A', commit: await P.sha256B64(own3.pub) });
      await c3.next();
      c4.post({ t: 'pair', name: 'B', commit: P.randomB64(32) });
      assert.equal((await c4.next()).t, 'busy');
      c3.close();
      c4.close();
      await wait(50);
      assert.ok(events.cancelled >= 1, 'fenêtre d’approbation fermée quand l’extension abandonne');
      assert.equal(vault.devices().length, 1);
    }
    step('appairage refusé, clé changée en cours de route, deux demandes à la fois : rien d’enregistré');

    // Appairer à nouveau : l'ancien appairage est retiré, sa clé ne sert plus
    {
      const c = await connectPipe(pipe);
      const again = await pairClient(c, { name: 'Chrome', replaces: device.id });
      assert.ok(again.ok);
      c.close();
      assert.deepEqual(vault.devices().map((d) => d.id), [again.id]);
      const c2 = await connectPipe(pipe);
      c2.post({ t: 'auth', id: device.id, nc: P.randomB64(32) });
      assert.equal((await c2.next()).t, 'unknown');
      c2.close();
      device = again;
    }
    step('appairer à nouveau : l’ancien appairage est retiré');

    // Session authentifiée
    const c = await connectPipe(pipe);
    const s = await authClient(c, device.id, device.key);
    assert.ok(s.request);
    assert.ok(vault.devices()[0].usedAt);
    {
      const list = await s.request('list', { url: 'https://github.com/login' });
      assert.equal(list.ok, true);
      assert.deepEqual(list.entries.map((e) => e.title), ['GitHub', 'GitHub pro']);
      assert.equal(list.entries[0].totp, true);
      const raw = JSON.stringify(list);
      for (const secret of ['Gh-S3cret!', 'Pr0-pass', 'JBSWY3DPEHPK3PXP', 'Autre']) assert.ok(!raw.includes(secret), `« ${secret} » dans la liste`);
      assert.ok(!c.raw.some((m) => JSON.stringify(m).includes('GitHub')), 'rien en clair sur le canal');

      const fill = await s.request('fill', { id: gh, url: 'https://github.com/session' });
      assert.equal(fill.password, 'Gh-S3cret!');
      assert.match(fill.totp, /^\d{6}$/);
      const wrong = await s.request('fill', { id: evil, url: 'https://github.com/' });
      assert.equal(wrong.ok, false);
      assert.equal(wrong.code, 'mismatch');
      assert.equal((await s.request('fill', { id: gh, url: 'https://github.com.evil.net/' })).code, 'mismatch');
      assert.equal((await s.request('fill', { id: gh, url: 'file:///C:/github.com' })).code, 'page');

      const http = await s.request('list', { url: 'http://github.com/' });
      assert.equal(http.entries[0].insecure, true);
      assert.equal((await s.request('fill', { id: gh, url: 'http://github.com/' })).code, 'insecure');
      assert.equal((await s.request('fill', { id: gh, url: 'http://github.com/', allowInsecure: true })).password, 'Gh-S3cret!');
      assert.equal((await s.request('list', { url: 'http://192.168.1.1/' })).entries[0].insecure, false);
      assert.equal((await s.request('fill', { id: router, url: 'http://192.168.1.1/' })).password, 'R0uteur');

      assert.match((await s.request('totp', { id: gh, url: 'https://github.com/' })).code, /^\d{6}$/);
      assert.equal((await s.request('copy', { id: gh, url: 'https://github.com/', field: 'password' })).seconds, 30);
      assert.equal(events.copied.at(-1), 'Gh-S3cret!');
      assert.equal((await s.request('copy', { id: gh, url: 'https://gitlab.com/', field: 'password' })).code, 'mismatch');
    }
    step('session : liste sans secrets, remplissage seulement pour le site, http à confirmer');

    // Enregistrement d'un identifiant saisi
    {
      const url = 'https://login.example.org/signin';
      assert.equal((await s.request('check', { url, username: 'moi@example.org', password: 'N0uveau!' })).status, 'new');
      const saved = await s.request('save', { url, username: 'moi@example.org', password: 'N0uveau!' });
      assert.equal(saved.updated, false);
      const e = vault.find(saved.entryId);
      assert.deepEqual([e.title, e.fields.url, e.fields.username, e.fields.password], ['Example', 'https://login.example.org/', 'moi@example.org', 'N0uveau!']);
      assert.equal((await s.request('check', { url, username: 'moi@example.org', password: 'N0uveau!' })).status, 'known');
      const changed = await s.request('check', { url: 'https://example.org/', username: 'MOI@example.org', password: 'Autre!' });
      assert.equal(changed.status, 'changed');
      assert.equal(changed.entryId, saved.entryId);
      const up = await s.request('save', { url: 'https://example.org/', username: 'moi@example.org', password: 'Autre!', entryId: saved.entryId });
      assert.equal(up.updated, true);
      assert.equal(vault.getField(saved.entryId, 'password'), 'Autre!');
      assert.equal(vault.getHistory(saved.entryId, 'password')[0].value, 'N0uveau!');
      // Mise à jour d'un identifiant d'un autre site : refusée
      assert.equal((await s.request('save', { url: 'https://example.org/', password: 'x', entryId: gh })).code, 'mismatch');
      assert.equal(vault.getField(gh, 'password'), 'Gh-S3cret!');
      assert.equal(events.changed, 2);
    }
    step('enregistrement : nouvel identifiant, déjà connu, mot de passe changé (historique gardé)');

    // Rejeu d'un message chiffré déjà vu : connexion coupée
    {
      const c2 = await connectPipe(pipe);
      const keys = await P.importPairKey(device.key);
      const nc = P.randomB64(32);
      c2.post({ t: 'auth', id: device.id, nc });
      const a = await c2.next();
      const ch = await P.Channel.open(keys, nc, a.ns, 'client');
      c2.post({ t: 'auth2', mac: await P.sign(keys, 'client', device.id, nc, a.ns) });
      await ch.open(await c2.next());
      const m = await ch.seal({ rid: 1, op: 'list', url: 'https://github.com/' });
      c2.post(m);
      await c2.next();
      c2.post(m);
      assert.equal((await c2.next()).t, '__closed');
    }
    step('message rejoué : connexion coupée');

    // Mauvaise clé, appareil inconnu, faux Pimkey
    {
      const c3 = await connectPipe(pipe);
      const bad = await authClient(c3, device.id, P.randomB64(32));
      assert.equal(bad.impostor, true, 'le client refuse un serveur qui ne prouve pas la clé');
      c3.close();

      // Client sans la clé : sa preuve est refusée
      const c4 = await connectPipe(pipe);
      const nc = P.randomB64(32);
      c4.post({ t: 'auth', id: device.id, nc });
      const a = await c4.next();
      c4.post({ t: 'auth2', mac: await P.sign(await P.importPairKey(P.randomB64(32)), 'client', device.id, nc, a.ns) });
      assert.equal((await c4.next()).t, '__closed');

      const c5 = await connectPipe(pipe);
      c5.post({ t: 'auth', id: 'inconnu', nc: P.randomB64(32) });
      assert.equal((await c5.next()).t, 'unknown');
      c5.post({ t: 'list' });
      assert.equal((await c5.next()).t, '__closed', 'requête sans session : connexion coupée');
    }
    step('sans la clé d’appairage : ni d’un côté ni de l’autre');

    // Verrouillage : sessions coupées
    {
      vault.lock();
      bridge.dropSessions();
      assert.equal((await c.next()).t, '__closed');
      await assert.rejects(s.request('list', { url: 'https://github.com/' }));
      const c6 = await connectPipe(pipe);
      c6.post({ t: 'auth', id: device.id, nc: P.randomB64(32) });
      assert.equal((await c6.next()).t, 'locked');
      c6.close();
      await vault.unlock(MASTER);
    }
    step('verrouillage : sessions coupées, plus rien ne sort');

    // Par l'hôte natif (processus séparé, comme lancé par le navigateur)
    {
      const h = spawnHost(pipe);
      h.post({ t: 'ping' }); // envoyé avant même que l'hôte soit connecté au tube
      assert.equal((await h.next(5000)).t, 'pong');
      const hs = await authClient(h, device.id, device.key);
      const list = await hs.request('list', { url: 'https://github.com/' });
      assert.equal(list.entries.length, 2);
      assert.equal((await hs.request('fill', { id: gh, url: 'https://github.com/' })).password, 'Gh-S3cret!');
      assert.ok(!h.raw.some((m) => JSON.stringify(m).includes('Gh-S3cret!')), 'le relais ne voit que du chiffré');

      // Révocation : connexion coupée, l'hôte s'arrête, l'appareil n'est plus reconnu
      vault.removeDevice(device.id);
      bridge.dropDevice(device.id);
      assert.equal((await h.next(5000)).t, '__closed');
      const h2 = spawnHost(pipe);
      h2.post({ t: 'auth', id: device.id, nc: P.randomB64(32) });
      assert.equal((await h2.next(5000)).t, 'unknown');
      h2.close();
    }
    step('hôte natif : relais du tube, révocation immédiate');

    {
      const h = spawnHost(`${pipe}-absent`);
      h.post({ t: 'ping' });
      assert.equal((await h.next(5000)).t, 'absent');
      h.close();
    }
    step('hôte natif : Pimkey absent signalé');

    execFileSync(process.execPath, [path.join(__dirname, 'extension.cjs'), '--check'], { stdio: 'inherit' });
    step('copies de l’extension à jour (shared/ → extension/lib)');

    console.log('\nTous les tests de la liaison navigateur passent.');
  } finally {
    bridge?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
