// Mots français courants pour les phrases de passe : sans accents ni majuscules, faciles à taper sur tout clavier.
// Doublons retirés au chargement ; chaque mot apporte log2(nombre de mots) bits d'entropie.
const LIST = `
abeille abri abricot absent accord acier action adulte affaire agent aigle aimant album alerte algue allure alpage
amande ami amour ampoule ananas ancre angle animal annonce anorak antenne antilope appel aquarium arbre arcade archipel
ardoise argent argile armoire arome arrosoir artichaut artiste ascenseur asperge aspect aspirateur atelier atlas atome
atout aube aubergine audace auteur autruche avance avenir avenue averse avion avocat azur
badge bagage baguette bague baie balai baleine balcon balle ballon bambou banane banc bandeau banjo banque barbe barque
barrage bassin bassine bateau batterie bazar beignet belette berceau berger besoin betterave beurre biche bijou billet
biscuit bison blague blaireau bloc blouse bobine bocal boisson bolide bonbon bonheur bonnet bordure bosquet bouchon
boucle boudin bougie bouilloire boulon bouquet bouquetin bourgeon boussole bouteille bouton bracelet branche bravo
brebis brioche brique brise brocoli brosse brouette brouillard bruine bruit brume buffet buisson bulle bureau buste
cabane cabinet cacao cactus cadeau cadenas cadre cahier caillou caisse calcul calendrier calme camion canal canard
canif canne cannelle canon canot canyon caramel caravane caribou carnet carotte carpe cartable carte carton cascade
casque casserole cassis castor caverne ceinture cerf cerise cerveau chacal chaise chalet chameau champ chance chanson
chapeau charbon chariot chasse chaton chausson chemin chemise chenille cheval cheveu chien chiffre chocolat chou
chouette ciboule cidre ciel cigale cirque ciseaux citron citrouille clafoutis clairon classe clavier clef cloche clou
clown cobalt cobra cocon code coffre colibri colline colombe compas comptoir concert concombre condor conte copain
coquille corail corbeau corde cornet costume coton couleur coupe courage courbe courgette couronne courrier cousin
couscous coussin couteau couverture coyote crabe crapaud crayon crevette cristal crochet crocodile croissant croquette
cube cuivre culture cycle cygne
dahlia dalle danse datte dauphin delta dentelle dentifrice dessin diamant dindon domino donjon dragon drapeau dune
effort encre endive enfant ensemble entonnoir enveloppe envol escalier espace espoir essai estuaire exemple
fable facteur faisan falaise famille fanfare farine faucon fauteuil fenouil ferme festin feuille ficelle figue filet
fjord flacon flamant flamme flanc fleur fleuve flocon foin folie fontaine forage forme fossile fouine foulard four
fourchette fourmi fraise framboise frelon frisson fromage fruit furet
gadget galet galette galop gamme gant garage gardien gaufre gazelle gazon gecko gerbille geyser gilet gingembre girafe
givre glace glacier gland glissade globe gobelet golfe gomme gorille goutte graine grange granit grappe gratin grenier
grenouille griffe grille grotte groupe guirlande guitare
hamac hameau hamster haricot harpe hasard hautbois herbe hibou hiver homard horizon horloge hublot huile humour hutte
igloo iguane image indice insecte iris ivoire
jacinthe jaguar jambon jardin jasmin jeton jockey joker jongleur journal joyau judo jumelles jungle jupe
kaki kangourou kayak kiosque kiwi koala
lagon lagune laine laitue lama lampadaire lampe lanterne lapin laser laurier lavande lentille lettre levier libellule
licorne lierre lilas limace limonade lion liquide livre loupe louve lucarne lueur lune lutin lynx
macaron machine madeleine magasin magie maillot maison manche manchot mandarine mangue manteau marais marche marmotte
marron marteau masque matelas matin melon menthe meringue merle meuble micro miel mirage miroir mission mitaine mobile
moineau montagne montre moquette morceau morse mortier moto mouchoir mouette moulin mousse moustache moustique moutarde
mouton muffin muguet mulot muscade musique myrtille
nacelle nageoire napperon narcisse navet navire nectar neige nid noisette noix nomade nougat nuage nuit
oasis objet ocre oignon olive ombre omelette oncle onde opale orage orange orchestre oreiller orgue orque ortie otarie
ourson outil ouvrage
pagaie paille palais palmier pamplemousse panais panda panier panneau paon papier papillon paquet parapluie parasol parc
parfum passoire pastel patate patin pavot paysage peigne pelle pelote pelouse pendule perceuse perle perroquet persil
phare phoque piano pieuvre pigeon pilote piment pinceau pingouin pirate piscine piste pivoine pizza placard plage
plaine planche plateau pluie plume poche poireau poivre poivron pomme pompier poney pont portail potager potiron
poubelle poulpe poussin prairie praline prisme projet prune puits puma puzzle pyjama
quai quartz question quiche quille quinoa
rabot racine radeau radis rafale raisin rameau rampe rapide raquette rasoir raton rayon refuge regard renard renne
requin ressort rideau rivage robinet robot rocher roseau rouleau route ruban ruche ruisseau
sable sablier sabot sacoche safran saison salade salami salon samba sandale sanglier sapin sardine satin sauge saumon
savane savon science scorpion seau secret semaine sentier serpent serviette sifflet signal silence singe sirop soleil
sommet sonnette sorbet source souris spirale stade statue steppe stylo sucre surprise suricate sushi
table tableau tablier tabouret tambour tamis tandem tapir tapis tartine tasse taupe taureau temple tempo tenaille
tennis terrain tigre timbre tiroir tissu tomate tonneau tonnerre torche tornade torrent tortue toucan toundra toupie
tournesol tournevis train tribu tricot trompette tronc tropique trottinette truffe truite tuile tulipe tunnel turban
univers usine
vague vallon valise vanille vapeur vautour velours ventilateur verger vernis verre verrou victoire village violon
virage vitrail voile volcan voyage
wagon wapiti xylophone yack yaourt zeste zigzag zinc zodiaque
`;

export const WORDS = [...new Set(LIST.split(/\s+/).filter(Boolean))];
