// Prépare l'extension navigateur (extension/) : copie des modules partagés avec l'app (protocole, nom des sites),
// que l'extension ne peut pas lire hors de son dossier, et icônes depuis build/logo.svg.
// --check : vérifie seulement que les copies sont à jour (tests).
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ext = path.join(root, 'extension');
const SHARED = ['bridge.mjs', 'sitename.mjs'];

const stale = SHARED.filter((f) => {
  const dst = path.join(ext, 'lib', f);
  return !fs.existsSync(dst) || !fs.readFileSync(path.join(root, 'shared', f)).equals(fs.readFileSync(dst));
});

if (process.argv.includes('--check')) {
  if (stale.length) {
    console.error(`Copies de l'extension périmées : ${stale.join(', ')} (npm run extension)`);
    process.exit(1);
  }
  return;
}

for (const f of SHARED) fs.copyFileSync(path.join(root, 'shared', f), path.join(ext, 'lib', f));

const { Resvg } = require('@resvg/resvg-js');
const svg = fs.readFileSync(path.join(root, 'build', 'logo.svg'));
fs.mkdirSync(path.join(ext, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(ext, 'icons', `${size}.png`), new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
}
console.log('extension/ prête (modules partagés et icônes)');
