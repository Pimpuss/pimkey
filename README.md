# Pimkey

Coffre-fort **100 % local** pour Windows : identifiants et mots de passe, documents d'identité (avec scans),
cartes bancaires et notes sécurisées, protégés par un mot de passe maître.
Même stack que [Pimplay](../pimplay) : Electron + React + Vite, installateur NSIS.

## Lancer

```bash
npm install
npm run dev        # Vite + Electron avec rechargement à chaud
npm run build      # build de l'interface (dist/)
npm start          # lance l'app sur le build
npm run dist       # installateur Windows (release/Pimkey-Setup-X.Y.Z.exe)
npm run release    # installateur publié dans une release GitHub (Pimpuss/pimkey) : GH_TOKEN requis
npm run icons      # régénère build/icon.png et build/icon.ico depuis build/logo.svg
npm run test:vault # teste le chiffrement du coffre sans Electron
npm run test:bridge # teste la liaison avec l'extension navigateur (appairage, canal chiffré, hôte natif)
npm run extension  # recopie shared/bridge.mjs et shared/sitename.mjs dans extension/lib, icônes de l'extension
```

En développement, `PIMKEY_DATA_DIR=dossier` fait travailler Pimkey sur un autre dossier de données (coffre de test),
sans toucher au vrai coffre ; ignoré par l'app installée.

`npx vite` seul ouvre l'interface dans un navigateur avec une API factice (mot de passe maître `demo1234`,
`?setup` dans l'adresse pour l'écran de création).

## Fonctionnalités

- **Mot de passe maître** à la création du coffre ; jamais enregistré. Oublié = coffre irrécupérable.
- **Éléments** : identifiants (identifiant / e-mail, mot de passe, lien du site), documents d'identité (type, nom,
  numéro, dates, autorité…), cartes bancaires (numéro, expiration, CVV, PIN) et notes. Ajout, modification, suppression, favoris.
- **Champs personnalisés** sur tout élément (nom, valeur, masquée ou non) et **étiquettes** (plusieurs par élément,
  listées dans la barre latérale ; la recherche les couvre).
- **Codes 2FA (TOTP)** : clé secrète ou lien `otpauth://` sur un identifiant ; le code à 6 chiffres défile dans la fiche
  et se copie en un clic. Calculé localement ([electron/totp.cjs](electron/totp.cjs)), la clé reste secrète.
- **Historique des mots de passe** : les 10 dernières valeurs remplacées, consultables après le mot de passe maître.
- **Afficher / masquer** un mot de passe (ou numéro de carte, CVV, PIN) : le mot de passe maître (ou Windows Hello, s'il
  est activé : l'invite s'ouvre d'emblée) est demandé, puis plus pendant un délai de grâce réglable (1 min par défaut,
  jusqu'à 4 h, ou à chaque fois) ; la valeur se masque d'elle-même après 30 s.
- **Copier** identifiant ou mot de passe en un clic ; le presse-papiers est vidé après 30 s (réglable) s'il contient encore la valeur.
- **Lien** : ouvre le site ou service dans le navigateur par défaut.
- **Pièces jointes** chiffrées (scan recto / verso, PDF…), ajoutées par la boîte de dialogue ou en glissant les fichiers
  sur la fiche ; aperçu des images, export d'une copie.
- **Logos** : l'icône de chaque site est récupérée automatiquement, y compris sur le réseau local (Proxmox, NAS,
  routeur… en HTTPS auto-signé), avec repli sur le domaine principal quand la page de connexion n'en a pas
  (auth.uber.com → uber.com). Dans l'éditeur, « Chercher le logo » le trouve sur le site du lien, ou d'après le nom
  sans lien (« Epic Games » → epicgames.com), et l'applique à l'enregistrement. Clic sur le logo dans la fiche pour le changer : image du disque, image collée,
  ou une autre adresse (un site, comme `proxmox.com`, ou directement une image).
- **Expirations** : documents et cartes expirés ou expirant dans les 3 mois signalés, et notification Windows à 3 mois,
  1 mois, 1 semaine et le jour de l'expiration (une fois par étape, coffre ouvert ; désactivable).
- **Générateur** de mots de passe (8 à 64 caractères) ou de phrases de passe (3 à 10 mots français sans accents,
  séparateur, majuscules, chiffre ; ≈ 9,6 bits par mot), et jauge de robustesse.
- **Liste** : tri par nom, date de modification, date d'ajout ou catégorie ; **dupliquer** un élément (pièces jointes
  comprises) ; navigation au clavier (↑ ↓, lettre pour aller au nom, Entrée modifier, Suppr, Ctrl + C mot de passe,
  Ctrl + B identifiant, Ctrl + N nouvel élément ; liste complète dans Paramètres).
- **Santé des mots de passe** : mots de passe réutilisés, faibles, inchangés depuis plus d'un an ; vérification des
  fuites (Have I Been Pwned) à la demande.
- **Import** des exports CSV de Chrome, Edge, Firefox, Bitwarden, KeePass et KeePassXC ([electron/importer.cjs](electron/importer.cjs)) :
  dossiers et groupes en étiquettes, clés 2FA et champs personnalisés repris, doublons ignorés (même site, identifiant et mot de passe).
  Un nom qui n'est qu'une adresse (Chrome, Edge : « accounts.epicgames.com ») devient le nom du site (« Epic Games »,
  [shared/sitename.mjs](shared/sitename.mjs)) ; les éléments déjà importés ainsi se renomment depuis les Paramètres.
- **Verrouillage** : manuel (bouton ou Ctrl + L), après inactivité (5 min par défaut), avec Windows (Win + L, veille),
  à la réduction de la fenêtre (option).
- **Windows Hello** (option) : déverrouillage par visage, empreinte ou PIN Windows. Une clé RSA « Pimkey » créée dans le
  TPM signe un défi propre au coffre ; SHA-256 de cette signature chiffre la clé des données (`hello` dans
  `vault.pimkey`). Sans le geste Hello, pas de signature, donc pas de clé. Coffre ouvert, le geste Hello remplace aussi
  le mot de passe maître pour afficher un secret (la clé obtenue doit être celle du coffre). Le mot de passe maître reste valable (et
  seul utilisable sur un autre PC). API WinRT `KeyCredentialManager` appelée par Windows PowerShell ([electron/hello.cjs](electron/hello.cjs)).
- **Zone de notification** : fermer la fenêtre (✕) verrouille le coffre et garde Pimkey près de l'horloge (option) ;
  clic pour rouvrir, clic droit pour Verrouiller ou Quitter.
- **Mises à jour automatiques** (app installée) : vérification au démarrage puis toutes les 6 h sur les releases GitHub
  `Pimpuss/pimkey`, téléchargement en arrière-plan, installation au redémarrage (bouton dans la barre latérale).
- **Corbeille** : un élément supprimé y reste 30 jours avec ses pièces jointes, restaurable ; ensuite il est effacé
  à l'ouverture du coffre. Suppression définitive ou corbeille vidée à la demande.
- **Sélection multiple** : cases à cocher dans la liste (ou Ctrl + clic, Maj + clic pour une plage, Ctrl + A pour tout),
  puis mise à la corbeille groupée ; dans la corbeille, restauration ou suppression définitive groupées.
- **Sauvegarde** : export en un fichier `.pimkey-backup` toujours chiffré, restauration (l'ancien coffre est mis de côté).
- **Copies automatiques** : une copie `.pimkey-backup` par jour quand le coffre a changé (à l'ouverture, puis toutes
  les heures s'il reste ouvert), les 10 dernières gardées (réglable, ou désactivé). Dossier au choix (OneDrive, disque externe…).
  Après un changement de mot de passe maître, une copie est faite tout de suite ; les précédentes gardent l'ancien.
- Fenêtre masquée dans les captures et partages d'écran (option), recherche (Ctrl + F), couleur d'accent.
- **Extension Chrome et Edge** (option, Paramètres › Navigateur) : remplit identifiant et mot de passe sur la page de
  connexion d'un site du coffre, en deux clics (icône Pimkey dans le champ ou dans la barre du navigateur, puis
  l'identifiant) ; code 2FA rempli dans le champ du code, ou copié ; propose d'enregistrer un identifiant saisi
  (bandeau « Enregistrer dans Pimkey ? », ou « Mettre à jour » si le mot de passe a changé). Voir ci-dessous.

## Extension navigateur

### Installer

1. Pimkey › Paramètres › Navigateur : activer « Extension Chrome et Edge ». Pimkey déclare alors son hôte natif à
   Chrome et Edge (`HKCU\Software\Google\Chrome\NativeMessagingHosts\fr.yalma.pimkey` et
   `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\fr.yalma.pimkey`, qui pointent vers
   `%APPDATA%\Pimkey\native-host\fr.yalma.pimkey.json`) et ouvre son canal. Désactiver efface tout cela, la
   désinstallation aussi ([build/installer.nsh](build/installer.nsh)). Pimkey réinscrit l'hôte à chaque démarrage
   (son emplacement peut changer avec une mise à jour).
2. `chrome://extensions` ou `edge://extensions` : activer le mode développeur, « Charger l'extension non empaquetée »,
   choisir le dossier `extension` (bouton « Ouvrir le dossier » dans les Paramètres : `resources\extension` de l'app
   installée, `extension/` du dépôt en développement). L'ID est fixé par la clé du manifeste,
   `ngnafaoidpbokhboecpdjjgcopioaill`, le même dans Chrome et Edge.
3. Cliquer sur l'icône de l'extension, puis « Appairer » : un code à 6 chiffres s'affiche dans l'onglet d'appairage et
   dans Pimkey (déverrouillé) ; s'il est identique, confirmer des deux côtés. Une fois par navigateur.

Une version publiée sur le Chrome Web Store ou Edge Add-ons aurait un autre ID : l'ajouter à `EXTENSION_IDS`
([electron/bridge.cjs](electron/bridge.cjs)). Brave, Vivaldi, Opera… lisent d'autres clés de registre : non pris en charge.

### Fonctionnement

```
page (script de contenu) ⇄ service worker ⇄ hôte natif (stdin/stdout) ⇄ tube nommé ⇄ Pimkey (processus principal)
```

- **Hôte natif** ([electron/native-host.cjs](electron/native-host.cjs)) : lancé par le navigateur via `pimkey-host.cmd`,
  c'est Pimkey.exe en mode Node (`ELECTRON_RUN_AS_NODE`) : aucun programme en plus, mais le fusible Electron RunAsNode
  doit rester actif. Il relaie les messages vers le tube nommé de Pimkey (propre au compte Windows) sans les comprendre.
  Pimkey fermé : l'extension propose « Ouvrir Pimkey », et l'hôte le lance.
- **Appairage** (une fois par navigateur) : clés éphémères ECDH P-256, avec engagement de l'extension (empreinte de sa
  clé envoyée avant de voir celle de Pimkey). Les deux côtés tirent du secret commun une clé d'appairage de 256 bits
  et un code à 6 chiffres. Un programme intercalé obtiendrait deux secrets, donc deux codes différents, sans pouvoir
  choisir ses clés après coup pour les faire coïncider. L'utilisateur confirme dans l'extension et dans Pimkey.
  « Appairer à nouveau » remplace l'appairage précédent de cette extension.
- **Connexion** (à chaque fois) : défi-réponse HMAC-SHA-256 dans les deux sens avec la clé d'appairage et des nonces
  des deux côtés, puis messages chiffrés en AES-256-GCM, une clé par sens (HKDF) et un compteur : un message rejoué,
  altéré ou déplacé coupe la connexion. Protocole complet en tête de [shared/bridge.mjs](shared/bridge.mjs).
- **Clés** : côté Pimkey, dans le coffre chiffré (Paramètres › Navigateur : liste, dernière utilisation, « Révoquer »
  coupe aussitôt l'accès) ; côté extension, en `CryptoKey` non extractible dans l'IndexedDB de l'extension,
  inaccessible aux scripts de contenu et aux pages.

### Modèle de sécurité

- **Coffre verrouillé, rien ne sort** : les clés des navigateurs sont dans le coffre chiffré, aucune extension ne peut
  s'authentifier. Sans authentification, on ne peut que demander si Pimkey est là (et verrouillé) et l'afficher.
  Verrouiller coupe aussi les sessions ouvertes.
- **Seulement le bon site** : l'adresse d'une page est celle que donne le navigateur (`sender.url`, cadres de
  l'onglet), jamais une adresse fournie par la page. Pimkey ne propose que les identifiants dont le lien a le même
  domaine principal que la page (`accounts.exemple.fr` ↔ `exemple.fr`, appli Android ↔ site de sa marque) et le
  revérifie au moment de donner le mot de passe. Les hébergements partagés (`github.io`, `netlify.app`, `vercel.app`…)
  comptent comme des domaines principaux : `alice.github.io` ne reçoit pas les identifiants de `bob.github.io`.
- **Jamais de remplissage silencieux** : la liste (titres, identifiants, logos, sans mot de passe ni code) ne s'affiche
  qu'après un clic sur l'icône, dans un shadow DOM fermé ; le mot de passe ne part vers la page qu'après un vrai clic
  (`isTrusted`) sur un identifiant, ou depuis le popup de l'extension.
- **Cadres** : depuis le popup, seuls les cadres du même site que l'onglet sont remplis (et pas un cadre http dans une
  page https) ; l'icône dans le cadre d'un autre site propose les identifiants de ce cadre, pas ceux de la page.
- **HTTPS** : sur une page en http, un mot de passe enregistré pour https n'est rempli qu'après confirmation (« Page
  non chiffrée »), sauf pour une adresse du réseau local (routeur, NAS…).
- **Enregistrement** : à l'envoi d'un formulaire, identifiant et mot de passe saisis restent 2 minutes dans
  `chrome.storage.session` (en mémoire, réservé à l'extension) ; le bandeau de la page ne reçoit que le site et
  l'identifiant. C'est Pimkey qui crée ou met à jour l'élément (ancien mot de passe dans l'historique), et seulement un
  identifiant du même site. « Jamais pour ce site » est retenu par l'extension.
- **Limites** : un programme malveillant qui tourne sous le même compte Windows peut lire le profil du navigateur
  (donc la clé d'appairage), espionner le clavier ou la page ; aucun gestionnaire de mots de passe ne protège contre
  cela. Une page piégée du bon site (faille XSS) reçoit ce que l'utilisateur y remplit, comme avec tout gestionnaire.
  Un site qui recouvrirait l'interface de Pimkey pour faire cliquer l'utilisateur (« clickjacking ») ne pourrait
  obtenir que les identifiants de son propre site, ou ceux d'un cadre que l'utilisateur a lui-même cliqué.

## Sécurité

Tout est dans `%APPDATA%/Pimkey/` :

```
vault.pimkey      coffre chiffré (JSON : paramètres scrypt, clé enveloppée, données)
attachments/      pièces jointes chiffrées (une par fichier)
copies/           copies automatiques (Pimkey-auto-AAAA-MM-JJ-HHMMSS.pimkey-backup), sauf autre dossier choisi
settings.json     réglages, en clair (rien de secret)
```

- Une **clé de données** aléatoire (256 bits) chiffre éléments et pièces jointes en **AES-256-GCM** (chiffrement authentifié).
- Cette clé est elle-même chiffrée par une clé dérivée du mot de passe maître avec **scrypt** (N = 2¹⁷, r = 8, p = 1, sel aléatoire).
  Changer de mot de passe maître ne rechiffre donc que cette clé.
- Les secrets ne quittent le processus principal que pour être affichés après confirmation du mot de passe maître ;
  la copie passe directement par le presse-papiers. L'interface ne reçoit jamais les mots de passe dans la liste.
- Écritures atomiques (fichier temporaire forcé sur le disque par `fsync`, puis renommage) : pas de coffre vide ou
  corrompu en cas de plantage ou de coupure de courant.
- Requêtes réseau : l'icône des sites ([electron/favicon.cjs](electron/favicon.cjs)), demandée au site lui-même
  (aucun service tiers ne voit la liste des comptes), dans une session sans cookies ni cache disque, puis rangée
  chiffrée dans le coffre. Un certificat invalide n'est accepté, pour ces seules icônes, que pour une adresse du
  réseau local (IP privée, `.local`, `.lan`, nom sans point). Désactivable dans Paramètres (les icônes déjà récupérées sont alors effacées).
  `node scripts/test-favicon.cjs` teste la récupération sur quelques sites. Et, seulement sur le bouton
  « Vérifier maintenant », Have I Been Pwned : par k-anonymat, seuls les 5 premiers caractères de l'empreinte SHA-1
  de chaque mot de passe partent ; la comparaison se fait sur l'ordinateur. Pas de synchronisation.

- Ce qui est copié est exclu de l'historique du presse-papiers de Windows (Win + V) et de sa synchronisation cloud :
  le texte est posé avec les formats `ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory = 0`
  et `CanUploadToCloudClipboard = 0` ([electron/clipboard-win.cjs](electron/clipboard-win.cjs), via koffi). Un gestionnaire
  de presse-papiers tiers peut ne pas respecter ces formats.

## Structure

```
electron/
  main.cjs        fenêtre, IPC, verrouillage automatique, presse-papiers
  preload.cjs     API exposée au rendu (window.pimkey)
  vault.cjs       chiffrement, éléments, pièces jointes, corbeille, audit, sauvegarde
  totp.cjs        codes 2FA (RFC 6238)
  importer.cjs    lecture des exports CSV d'autres gestionnaires
  settings.cjs    réglages
  bridge.cjs      extension navigateur : tube nommé, appairage, requêtes, inscription de l'hôte (HKCU)
  native-host.cjs hôte natif lancé par Chrome et Edge (relais entre stdin/stdout et le tube)
shared/types.json types d'éléments et leurs champs (lu par le coffre et par l'interface)
shared/sitename.mjs nom lisible d'un site et domaine principal (import, éditeur, icônes, extension)
shared/bridge.mjs protocole de l'extension : appairage, authentification, canal chiffré (WebCrypto)
extension/        extension Chrome et Edge (Manifest V3, sans framework) : service worker, script de contenu,
                  popup, appairage ; lib/bridge.mjs et lib/sitename.mjs sont des copies (npm run extension)
shared/strength.mjs robustesse d'un mot de passe (jauge de l'interface et audit du coffre)
src/              interface React (verrouillage, coffre, éditeur, santé des mots de passe, paramètres)
scripts/          icônes, tests du coffre et de la liaison navigateur, préparation de l'extension
```

Ajouter un type d'élément (permis de chasse, licence logicielle…) : une entrée dans `shared/types.json`
et une icône dans `src/lib/types.js`.
