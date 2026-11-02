// Nom lisible d'un site à partir de son adresse (« accounts.epicgames.com » → « Epic Games »), et domaine principal
// (« auth.uber.com » → « uber.com »). Partagé par l'interface (éditeur), le coffre (import) et les icônes.

// Marques dont le nom ne se déduit pas du domaine (casse, espaces, accents)
const BRANDS = {
  epicgames: 'Epic Games', paypal: 'PayPal', github: 'GitHub', gitlab: 'GitLab', linkedin: 'LinkedIn', youtube: 'YouTube',
  facebook: 'Facebook', instagram: 'Instagram', twitter: 'Twitter', x: 'X', tiktok: 'TikTok', whatsapp: 'WhatsApp',
  playstation: 'PlayStation', steampowered: 'Steam', steamcommunity: 'Steam', ea: 'EA', ubisoft: 'Ubisoft', battle: 'Battle.net',
  blizzard: 'Blizzard', nintendo: 'Nintendo', xbox: 'Xbox', live: 'Microsoft', microsoftonline: 'Microsoft', office: 'Microsoft 365',
  icloud: 'iCloud', appleid: 'Apple ID', openai: 'OpenAI', chatgpt: 'ChatGPT', anthropic: 'Anthropic', claude: 'Claude',
  dropbox: 'Dropbox', wetransfer: 'WeTransfer', ovh: 'OVH', ovhcloud: 'OVHcloud', ionos: 'IONOS', godaddy: 'GoDaddy',
  digitalocean: 'DigitalOcean', cloudflare: 'Cloudflare', aws: 'AWS', ebay: 'eBay', aliexpress: 'AliExpress', vinted: 'Vinted',
  leboncoin: 'Leboncoin', laposte: 'La Poste', sncf: 'SNCF', 'sncf-connect': 'SNCF Connect', ratp: 'RATP', impots: 'Impôts',
  ameli: 'Ameli', caf: 'CAF', 'france-travail': 'France Travail', franceconnect: 'FranceConnect', ants: 'ANTS', urssaf: 'Urssaf',
  edf: 'EDF', engie: 'Engie', totalenergies: 'TotalEnergies', sfr: 'SFR', bouyguestelecom: 'Bouygues Telecom', free: 'Free',
  orange: 'Orange', boursorama: 'Boursorama', boursobank: 'BoursoBank', creditagricole: 'Crédit Agricole', 'credit-agricole': 'Crédit Agricole',
  societegenerale: 'Société Générale', bnpparibas: 'BNP Paribas', labanquepostale: 'La Banque Postale', lcl: 'LCL', cic: 'CIC',
  creditmutuel: 'Crédit Mutuel', 'caisse-epargne': "Caisse d'Épargne", hellobank: 'Hello bank!', fortuneo: 'Fortuneo', revolut: 'Revolut',
  lydia: 'Lydia', doctolib: 'Doctolib', fnac: 'Fnac', cdiscount: 'Cdiscount', darty: 'Darty', ikea: 'IKEA', bricodepot: 'Brico Dépôt',
  leroymerlin: 'Leroy Merlin', canalplus: 'Canal+', mycanal: 'Canal+', primevideo: 'Prime Video', disneyplus: 'Disney+',
  netflix: 'Netflix', deezer: 'Deezer', spotify: 'Spotify', twitch: 'Twitch', discord: 'Discord', reddit: 'Reddit',
  ui: 'UniFi', synology: 'Synology', quickconnect: 'Synology', proxmox: 'Proxmox', freebox: 'Freebox', mafreebox: 'Freebox',
};

// Adresses précises plus parlantes que leur domaine
const HOSTS = {
  'mail.google.com': 'Gmail', 'drive.google.com': 'Google Drive', 'docs.google.com': 'Google Docs', 'outlook.live.com': 'Outlook',
  'outlook.office.com': 'Outlook', 'teams.microsoft.com': 'Teams', 'music.youtube.com': 'YouTube Music', 'aws.amazon.com': 'AWS',
  'console.aws.amazon.com': 'AWS', 'signin.aws.amazon.com': 'AWS', 'store.steampowered.com': 'Steam', 'cfspart.impots.gouv.fr': 'Impôts',
};

// Suffixes en deux parties (co.uk, com.br, gouv.fr…) : le domaine principal a alors trois parties
const TWO_LEVEL = /^(co|com|org|net|gov|gouv|ac|edu|ne|or|go|gob|ltd|plc|asso|nom|mil)\.[a-z]{2}$/;

// Hébergements partagés : chaque sous-domaine appartient à quelqu'un d'autre (alice.github.io ≠ bob.github.io).
// Le domaine principal y garde donc une partie de plus ; l'extension navigateur ne mélange pas leurs identifiants.
const SHARED = new Set([
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'azurewebsites.net',
  'cloudfront.net', 'web.app', 'firebaseapp.com', 'appspot.com', 'onrender.com', 'fly.dev', 'glitch.me', 'blogspot.com',
  'wordpress.com', 'wixsite.com', 'myshopify.com', 'ngrok.io', 'ngrok-free.app', 'duckdns.org', 'ddns.net', 'no-ip.org',
  'synology.me', 'myfritz.net', 'myqnapcloud.com', 'freeboxos.fr', 'sharepoint.com',
]);

const isIp = (h) => /^[\d.]+$/.test(h) || h.includes(':');

function hostOf(url) {
  if (!url) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// « auth.uber.com » → « uber.com », « impots.gouv.fr » → « impots.gouv.fr » ; IP et noms locaux inchangés
export function baseDomain(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!h.includes('.') || isIp(h)) return h;
  const parts = h.split('.');
  const last2 = parts.slice(-2).join('.');
  const n = SHARED.has(last2) || TWO_LEVEL.test(last2) ? 3 : 2;
  return parts.slice(-n).join('.');
}

// Appli Android enregistrée par Chrome (« android://…@com.instagram.android/ ») : site de la marque, d'après le nom
// de paquet à l'envers (« instagram.com ») ; '' si ce n'est pas une appli Android
export function androidSite(url) {
  const m = /^android:\/\/(?:[^@/]*@)?([a-z0-9_.]+)/i.exec(url || '');
  const [tld, brand] = m ? m[1].toLowerCase().split('.') : [];
  return tld && brand && /^[a-z0-9-]+$/.test(brand) && /^[a-z]{2,}$/.test(tld) ? `${brand}.${tld}` : '';
}

const words = (label) => label.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// Nom d'un site d'après son adresse ; '' si l'adresse est illisible. Applications Android (android://…@com.marque.appli)
// exportées par Chrome : la marque est le 2e élément du nom de paquet.
export function siteName(url) {
  if (/^android:/i.test(url || '')) {
    const pkg = String(url).replace(/^android:\/\/([^@]*@)?/i, '').split('/')[0].split('.');
    const brand = pkg[1] || pkg[0] || '';
    return BRANDS[brand] || words(brand);
  }
  const host = hostOf(url);
  if (!host) return '';
  if (HOSTS[host]) return HOSTS[host];
  if (!host.includes('.') || isIp(host)) return host;
  const label = baseDomain(host).split('.')[0];
  return BRANDS[label] || words(label);
}

// Sites probables d'après un nom d'élément, pour y chercher un logo quand il n'y a pas de lien :
// « Epic Games » → epicgames.com, epicgames.fr ; « La Poste » → laposte.fr, laposte.com
export function guessDomains(name) {
  const text = String(name || '').trim();
  if (!text || looksLikeHost(text)) return text ? [baseDomain(text.replace(/^https?:\/\//i, '').split('/')[0])] : [];
  const known = Object.keys(BRANDS).find((k) => BRANDS[k].toLowerCase() === text.toLowerCase());
  const slug = (known || text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '');
  if (!slug) return [];
  const french = /[àâçéèêëîïôûùüÿœ]/i.test(text);
  return french ? [`${slug}.fr`, `${slug}.com`] : [`${slug}.com`, `${slug}.fr`];
}

// Le nom ressemble-t-il à une adresse (« accounts.epicgames.com », « com.epicgames.portal ») plutôt qu'à un vrai nom ?
export function looksLikeHost(title) {
  return /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/i.test(String(title || '').trim()) && !/^[\d.]+$/.test(title.trim());
}
