// Récupère l'icône de quelques sites réels (nécessite Internet) : node scripts/test-favicon.cjs [site…]
const { fetchSiteIcon } = require('../electron/favicon.cjs');

const sites = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['https://github.com/', 'https://mail.google.com/', 'https://www.impots.gouv.fr/', 'https://www.netflix.com/', 'https://www.boursorama.com/'];

(async () => {
  for (const site of sites) {
    const t = Date.now();
    const icon = await fetchSiteIcon(site, fetch);
    console.log(icon ? '✓' : '✗', site.padEnd(34), icon ? `${icon.mime} ${icon.buf.length} o` : 'aucune icône', `${Date.now() - t} ms`);
  }
})();
