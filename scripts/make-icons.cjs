// Génère les icônes de l'app depuis build/logo.svg : icon.png (fenêtre) et icon.ico (Windows, installateur).
const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');
const pngToIco = require('png-to-ico');

const dir = path.join(__dirname, '..', 'build');
const svg = fs.readFileSync(path.join(dir, 'logo.svg'));
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

(async () => {
  fs.writeFileSync(path.join(dir, 'icon.png'), render(512));
  const ico = await (pngToIco.default || pngToIco)([16, 24, 32, 48, 64, 128, 256].map(render));
  fs.writeFileSync(path.join(dir, 'icon.ico'), ico);
  console.log('build/icon.png et build/icon.ico générés');
})();
