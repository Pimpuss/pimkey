// Test du coffre sans Electron : création, verrouillage, secrets, pièces jointes, changement de mot de passe,
// sauvegarde et restauration, corbeille, dans un dossier temporaire.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Vault, TRASH_DAYS, OLD_DAYS } = require('../electron/vault.cjs');
const { readCsv } = require('../electron/importer.cjs');
const { trimIco } = require('../electron/favicon.cjs');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pimkey-test-'));
  const step = (s) => console.log('✓', s);
  try {
    const v = new Vault(dir);
    assert.equal(v.exists(), false);
    await assert.rejects(v.create('court'), /au moins 8/);
    await v.create('correct horse battery');
    step('coffre créé');

    const id = v.saveEntry({
      type: 'login', title: 'Gmail', favorite: true,
      fields: { username: 'moi@gmail.com', password: 'S3cr3t!', url: 'mail.google.com' },
    });
    const card = v.saveEntry({ type: 'card', title: 'Visa', fields: { holder: 'MOI', number: '4970 1234 5678 9012', cvv: '123' } });
    const pub = v.list();
    assert.equal(pub[0].fields.password, undefined, 'le mot de passe ne doit pas partir vers l’interface');
    assert.equal(pub[0].secrets.password, true);
    assert.equal(pub.find((e) => e.id === card).hints.number, '9012');
    step('les secrets restent dans le processus principal');

    const raw = fs.readFileSync(path.join(dir, 'vault.pimkey'), 'utf8');
    for (const s of ['Gmail', 'moi@gmail.com', 'S3cr3t!', '4970']) assert.ok(!raw.includes(s), `« ${s} » en clair sur le disque`);
    step('rien en clair sur le disque');

    // Modifier sans renvoyer le mot de passe le conserve
    v.saveEntry({ id, title: 'Gmail perso', fields: { username: 'moi@gmail.com', url: 'mail.google.com' } });
    assert.equal(v.getField(id, 'password'), 'S3cr3t!');
    v.saveEntry({ id, title: 'Gmail perso', fields: { username: 'moi@gmail.com', password: 'N0uveau', url: 'mail.google.com' } });
    assert.equal(v.getField(id, 'password'), 'N0uveau');
    step('édition : secret conservé ou remplacé');

    v.addAttachment(id, { name: 'scan.png', mime: 'image/png', buf: Buffer.from('PNGDATA') });
    const att = v.list().find((e) => e.id === id).attachments[0];
    assert.equal(v.readAttachment(id, att.id).buf.toString(), 'PNGDATA');
    assert.ok(!fs.readFileSync(path.join(dir, 'attachments', att.id + '.bin')).includes('PNGDATA'));
    step('pièce jointe chiffrée');

    // Icônes : site manquant détecté, icône rangée chiffrée, logo choisi prioritaire
    assert.deepEqual(v.sitesWithoutIcon(), [{ key: 'mail.google.com', root: 'https://mail.google.com/' }]);
    v.setSiteIcon('mail.google.com', 'data:image/png;base64,SUNPTg==');
    assert.equal(v.list().find((e) => e.id === id).icon, 'data:image/png;base64,SUNPTg==');
    assert.deepEqual(v.sitesWithoutIcon(), []);
    v.setEntryIcon(card, 'data:image/png;base64,TE9HTw==');
    assert.equal(v.list().find((e) => e.id === card).customIcon, true);
    assert.ok(!fs.readFileSync(path.join(dir, 'vault.pimkey'), 'utf8').includes('mail.google.com'));
    v.setEntryIcon(card, null);
    assert.equal(v.list().find((e) => e.id === card).icon, null);
    step('icônes de sites et logos chiffrés');

    assert.equal(await v.verify('mauvais'), false);
    assert.equal(await v.verify('correct horse battery'), true);
    v.lock();
    assert.throws(() => v.list(), /verrouillé/);
    await assert.rejects(v.unlock('mauvais'), /incorrect/);
    await v.unlock('correct horse battery');
    assert.equal(v.list().length, 2);
    step('verrouillage / déverrouillage');

    const backup = v.exportBackup();
    await v.changePassword('correct horse battery', 'autre mot de passe');
    v.lock();
    await assert.rejects(v.unlock('correct horse battery'), /incorrect/);
    await v.unlock('autre mot de passe');
    assert.equal(v.readAttachment(id, att.id).buf.toString(), 'PNGDATA');
    step('changement de mot de passe maître');

    v.deleteEntry(card);
    assert.equal(v.list().length, 1);
    await assert.rejects(Vault.readBackup(backup, 'autre mot de passe'), /incorrect/);
    const { count } = await Vault.readBackup(backup, 'correct horse battery');
    assert.equal(count, 2);
    await v.restoreBackup(backup, 'correct horse battery');
    assert.equal(v.unlocked, false);
    await v.unlock('correct horse battery');
    assert.equal(v.list().length, 2);
    assert.equal(v.readAttachment(id, att.id).buf.toString(), 'PNGDATA');
    assert.ok(fs.readdirSync(dir).some((d) => d.startsWith('avant-restauration-')));
    step('sauvegarde et restauration');

    // Corbeille : l'élément garde tout jusqu'à sa suppression définitive
    v.trashEntry(id);
    assert.ok(v.list().find((e) => e.id === id).deletedAt);
    assert.equal(v.readAttachment(id, att.id).buf.toString(), 'PNGDATA');
    v.lock();
    await v.unlock('correct horse battery');
    assert.ok(v.list().find((e) => e.id === id).deletedAt, 'la corbeille survit au verrouillage');
    v.restoreEntry(id);
    assert.equal(v.list().find((e) => e.id === id).deletedAt, null);
    v.trashEntry(id);
    v.trashEntry(card);
    v.find(card).deletedAt -= (TRASH_DAYS + 1) * 86400e3;
    v.purgeTrash();
    assert.deepEqual(v.list().map((e) => e.id), [id], 'purge après le délai de la corbeille');
    step('corbeille : restauration et purge après délai');

    v.emptyTrash();
    assert.equal(v.list().length, 0);
    assert.ok(!fs.existsSync(path.join(dir, 'attachments', att.id + '.bin')));
    step('corbeille vidée avec les pièces jointes');

    // Copie complète écrite d'un bloc, relisible comme une sauvegarde
    const copy = path.join(dir, 'copie.pimkey-backup');
    v.saveEntry({ type: 'note', title: 'Note', fields: { content: 'Bonjour' } });
    v.writeBackup(copy);
    assert.ok(!fs.existsSync(copy + '.tmp'));
    assert.equal((await Vault.readBackup(fs.readFileSync(copy, 'utf8'), 'correct horse battery')).count, 1);
    step('copie de sauvegarde écrite');

    // Étiquettes et champs personnalisés : un champ masqué ne part pas vers l'interface et survit à l'édition
    const box = v.saveEntry({
      type: 'login', title: 'Box', tags: ['Maison', ' maison ', 'Réseau'], fields: { username: 'admin', password: 'box-2020', url: '192.168.1.1' },
      custom: [{ label: 'IP', value: '192.168.1.1' }, { label: 'PIN WPS', value: '12345670', secret: true }],
    });
    let pubBox = v.list().find((e) => e.id === box);
    assert.deepEqual(pubBox.tags, ['Maison', 'Réseau']);
    assert.equal(pubBox.custom[0].value, '192.168.1.1');
    assert.equal(pubBox.custom[1].value, undefined);
    assert.equal(v.getField(box, `custom:${pubBox.custom[1].id}`), '12345670');
    v.saveEntry({ id: box, title: 'Box', fields: { username: 'admin', url: '192.168.1.1' }, custom: pubBox.custom.map(({ id, label, secret, value }) => ({ id, label, secret, value })) });
    assert.equal(v.getField(box, `custom:${pubBox.custom[1].id}`), '12345670');
    assert.deepEqual(v.list().find((e) => e.id === box).tags, ['Maison', 'Réseau'], 'étiquettes gardées sans tags dans la saisie');
    assert.ok(!fs.readFileSync(path.join(dir, 'vault.pimkey'), 'utf8').includes('Réseau'));
    step('étiquettes et champs personnalisés');

    // Historique : l'ancien mot de passe est gardé, seules les dates sont visibles par l'interface
    v.saveEntry({ id: box, title: 'Box', fields: { username: 'admin', password: 'Box-2026!longue-phrase', url: '192.168.1.1' } });
    pubBox = v.list().find((e) => e.id === box);
    assert.equal(pubBox.history.password.length, 1);
    assert.equal(typeof pubBox.history.password[0], 'number');
    assert.equal(v.getHistory(box, 'password')[0].value, 'box-2020');
    step('historique des mots de passe');

    // 2FA : clé validée à l'enregistrement, code calculé dans le processus principal
    await assert.rejects(async () => v.saveEntry({ id: box, title: 'Box', fields: { totp: 'pas une clé !' } }), /2FA invalide/);
    v.saveEntry({ id: box, title: 'Box', fields: { username: 'admin', url: '192.168.1.1', totp: 'otpauth://totp/Box?secret=JBSWY3DPEHPK3PXP' } });
    assert.match(v.totpCode(box).code, /^\d{6}$/);
    assert.equal(v.list().find((e) => e.id === box).fields.totp, undefined);
    step('codes 2FA');

    // Audit : réutilisé, faible, ancien, fuite
    const a1 = v.saveEntry({ type: 'login', title: 'A', fields: { username: 'a', password: 'azerty' } });
    const a2 = v.saveEntry({ type: 'login', title: 'B', fields: { username: 'b', password: 'azerty' } });
    v.find(a2).createdAt -= (OLD_DAYS + 1) * 86400e3;
    let flags = v.auditFlags();
    assert.ok(flags.get(a1).weak && flags.get(a1).reused && flags.get(a1).reused === flags.get(a2).reused);
    assert.ok(!flags.get(a1).old && flags.get(a2).old);
    assert.equal(flags.get(box).reused, 0);
    assert.equal(flags.get(box).pwned, null);
    v.setPwned([[a1, 120]]);
    assert.equal(v.list().find((e) => e.id === a1).audit.pwned, 120);
    v.saveEntry({ id: a1, title: 'A', fields: { username: 'a', password: 'Un-vrai-mot-de-passe-2026' } });
    flags = v.auditFlags();
    assert.equal(flags.get(a1).pwned, null, 'vérification périmée après changement');
    assert.equal(flags.get(a2).reused, 0);
    step('audit des mots de passe');

    // Import CSV : formats reconnus, dossiers en étiquettes, doublons ignorés
    const chrome = 'name,url,username,password,note\r\ngithub.com,https://github.com/login,moi,"p,a""ss",\r\nB,,b,azerty,\r\n';
    const imp = readCsv(chrome);
    assert.equal(imp.format.id, 'chrome');
    assert.equal(imp.entries[0].fields.password, 'p,a"ss');
    assert.equal(imp.entries[0].title, 'GitHub', 'nom tiré du site, pas de l’adresse');
    const bw = readCsv('folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nBanque,1,login,Ma banque,,"Client: 42",0,https://banque.fr,moi,s3cret,JBSWY3DPEHPK3PXP\n,,note,Wi-Fi,code: 1234,,0,,,,\n');
    assert.equal(bw.format.id, 'bitwarden');
    assert.deepEqual(bw.entries[0].tags, ['Banque']);
    assert.equal(bw.entries[0].custom[0].label, 'Client');
    assert.equal(bw.entries[1].type, 'note');
    assert.equal(readCsv('"Group","Title","Username","Password","URL","Notes","TOTP"\n"Root/Mails","Gmail","moi","x","mail.google.com","",""\n').entries[0].tags[0], 'Mails');
    assert.equal(readCsv('"url","username","password","httpRealm","formActionOrigin","guid"\n"https://www.amazon.fr","moi","x","","","{1}"\n').entries[0].title, 'Amazon');
    assert.throws(() => readCsv('a,b\n1,2\n'), /Format non reconnu/);
    assert.deepEqual(v.importEntries(imp.entries, { dryRun: true, skipDuplicates: false }), { added: 2, duplicates: 1, invalid: 0 });
    const before = v.list().length;
    assert.deepEqual(v.importEntries([...imp.entries, ...bw.entries]), { added: 3, duplicates: 1, invalid: 0 });
    assert.equal(v.list().length, before + 3);
    assert.match(v.totpCode(v.list().find((e) => e.title === 'Ma banque').id).code, /^\d{6}$/);
    step('import CSV (Chrome, Bitwarden, KeePassXC, Firefox)');

    // Noms qui ne sont qu'une adresse (anciens imports Chrome) : renommés ; un nom choisi à la main est gardé
    const epic = v.saveEntry({ type: 'login', title: 'accounts.epicgames.com', fields: { username: 'moi', url: 'https://accounts.epicgames.com/login' } });
    const nas = v.saveEntry({ type: 'login', title: 'nas.maison.lan', fields: { username: 'admin', url: 'https://autre.exemple.fr' } });
    const app = v.saveEntry({ type: 'login', title: 'com.epicgames.portal', fields: { username: 'moi', url: 'android://abc@com.epicgames.portal/' } });
    const dry = v.tidyTitles(true);
    assert.equal(dry.count, 2);
    assert.deepEqual(dry.examples[0], { from: 'accounts.epicgames.com', to: 'Epic Games' });
    assert.equal(v.find(epic).title, 'accounts.epicgames.com', 'dryRun ne change rien');
    v.tidyTitles();
    assert.equal(v.find(epic).title, 'Epic Games');
    assert.equal(v.find(app).title, 'Epic Games');
    assert.equal(v.find(nas).title, 'nas.maison.lan', 'adresse d’un autre site : nom gardé');
    assert.equal(v.tidyTitles(true).count, 0);
    step('noms tirés des adresses renommés');

    // Appli Android : même site que la version web (icône partagée, doublon reconnu à l'import)
    v.setSiteIcon('instagram.com', 'data:image/png;base64,SUc=');
    const insta = v.saveEntry({ type: 'login', title: 'com.instagram.android', fields: { username: 'moi', password: 'x', url: 'android://h@com.instagram.android/' } });
    assert.equal(v.list().find((e) => e.id === insta).icon, 'data:image/png;base64,SUc=');
    assert.equal(v.importEntries([{ type: 'login', title: 'Instagram', fields: { username: 'moi', password: 'x', url: 'https://www.instagram.com/' } }], { dryRun: true }).duplicates, 1);
    step('applis Android rattachées à leur site');

    // .ico à plusieurs tailles : seule l'image la plus proche de 128 px est gardée (PNG ici)
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
    const bmp = Buffer.alloc(60000);
    const ico = Buffer.alloc(6 + 32);
    ico.writeUInt16LE(1, 2);
    ico.writeUInt16LE(2, 4);
    ico[6] = 16; ico.writeUInt32LE(bmp.length, 14); ico.writeUInt32LE(38, 18);
    ico[22] = 128; ico.writeUInt32LE(png.length, 30); ico.writeUInt32LE(38 + bmp.length, 34);
    const trimmed = trimIco(Buffer.concat([ico, bmp, png]));
    assert.equal(trimmed.mime, 'image/png');
    assert.equal(trimmed.buf.length, png.length);
    step('icônes .ico allégées');

    // Dupliquer : copie complète, pièces jointes rechiffrées sous un nouvel identifiant, sans historique
    const orig = v.saveEntry({ type: 'login', title: 'Banque', tags: ['Argent'], fields: { username: 'moi', password: 'ancien' } });
    v.saveEntry({ id: orig, title: 'Banque', fields: { username: 'moi', password: 'nouveau' } });
    v.addAttachment(orig, { name: 'rib.pdf', mime: 'application/pdf', buf: Buffer.from('RIB') });
    const dup = v.duplicateEntry(orig);
    const pubDup = v.list().find((e) => e.id === dup);
    assert.equal(pubDup.title, 'Banque (copie)');
    assert.deepEqual(pubDup.tags, ['Argent']);
    assert.equal(v.getField(dup, 'password'), 'nouveau');
    assert.deepEqual(pubDup.history, {});
    assert.notEqual(pubDup.attachments[0].id, v.find(orig).attachments[0].id);
    assert.equal(v.readAttachment(dup, pubDup.attachments[0].id).buf.toString(), 'RIB');
    v.removeEntries([orig]);
    assert.equal(v.readAttachment(dup, pubDup.attachments[0].id).buf.toString(), 'RIB', 'la copie garde sa pièce jointe');
    step('dupliquer un élément');

    // Rappels d'expiration : une fois par palier, de nouveau si la date change
    const day = 86400e3;
    const iso = (d) => new Date(Date.now() + d * day).toISOString().slice(0, 10);
    const passport = v.saveEntry({ type: 'identity', title: 'Passeport', fields: { docType: 'Passeport', expiresAt: iso(20) } });
    assert.deepEqual(v.expiryNotices().map((x) => [x.title, x.days]), [['Passeport', 21]]);
    assert.equal(v.expiryNotices().length, 0, 'pas deux fois le même palier');
    assert.equal(v.expiryNotices(Date.now() + 15 * day).length, 1, 'palier « 1 semaine »');
    v.saveEntry({ id: passport, title: 'Passeport', fields: { docType: 'Passeport', expiresAt: iso(3000) } });
    assert.equal(v.expiryNotices().length, 0, 'document renouvelé : rien');
    step('rappels d’expiration');

    // Windows Hello (signature simulée) : ouvre le coffre, une autre signature non, le mot de passe reste valable
    const sig = Buffer.from('signature-rsa-du-tpm');
    v.enableHello('ZGVmaQ==', sig);
    assert.equal(v.helloChallenge(), 'ZGVmaQ==');
    v.lock();
    assert.throws(() => v.unlockWithHello(Buffer.from('autre')), /mot de passe maître/);
    v.unlockWithHello(sig);
    assert.ok(v.list().length > 0);
    // Coffre ouvert : Hello remplace le mot de passe maître pour afficher un secret
    assert.equal(v.verifyHello(sig), true);
    assert.throws(() => v.verifyHello(Buffer.from('autre')), /mot de passe maître/);
    await v.changePassword('correct horse battery', 'encore un autre');
    v.lock();
    v.unlockWithHello(sig);
    v.lock();
    await v.unlock('encore un autre');
    v.disableHello();
    assert.equal(v.helloChallenge(), null);
    assert.throws(() => v.unlockWithHello(sig), /pas activé/);
    step('déverrouillage Windows Hello');

    // Sélection multiple : un identifiant inconnu n'en touche aucun, sinon tout passe en une fois
    const [m1, m2] = v.list().filter((e) => !e.deletedAt).map((e) => e.id);
    assert.throws(() => v.trashEntries([m1, 'inconnu']), /introuvable/);
    assert.equal(v.list().find((e) => e.id === m1).deletedAt, null);
    v.trashEntries([m1, m2]);
    assert.ok(v.list().filter((e) => [m1, m2].includes(e.id)).every((e) => e.deletedAt));
    v.restoreEntries([m1]);
    assert.equal(v.list().find((e) => e.id === m1).deletedAt, null);
    const total = v.list().length;
    v.removeEntries([m1, m2]);
    assert.equal(v.list().length, total - 2);
    step('sélection multiple : corbeille, restauration, suppression');
    console.log('\nTous les tests du coffre passent.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
