# 🌍 Atlo — Explorez le monde

Guide de voyage pour le monde entier : **choisissez un pays, puis une région**, découvrez ses sites emblématiques, la météo, la meilleure période pour partir, et construisez votre itinéraire jour par jour. Application web installable (PWA), en français, anglais, espagnol et arabe, qui fonctionne aussi hors connexion.

## Ce que fait l'application

| Écran | Contenu |
|---|---|
| **Explorer** | 250 pays et territoires, 1 106 sites emblématiques, recherche (pays, sites, villes du monde entier), filtre par continent, carte du monde colorée selon le nombre de sites. |
| **Pays** | Heure locale et décalage, monnaie et taux du jour, langues, indicatif, sens de circulation, prises et tension (compatibilité avec vos prises), numéros d'urgence cliquables ; régions (3 383 dans le monde) et grandes villes ; sites par catégorie ; météo à 7 jours ; « Quand partir ? » (climat moyen des 3 dernières années). |
| **Région** | Contour sur la carte, sites, villes, lieux à découvrir autour (articles Wikipédia géolocalisés), météo et climat. |
| **Fiche d'un site** | Photo et résumé Wikipédia dans votre langue, météo et heure sur place, « Y aller », photos (Wikimedia Commons), vidéos (YouTube), fiche UNESCO, partage. |
| **Autour de moi** | Pays et région détectés **sur l'appareil** (sans service tiers), sites proches avec distances, découvertes, météo. |
| **Itinéraire** | Étapes réparties en journées (heures d'arrivée et de départ), durée de visite par étape, mode de déplacement, optimisation de l'ordre (plus proche voisin + 2-opt), distances et temps estimés, alertes de long trajet ; navigation Google Maps par jour, export GPX et agenda (.ics), partage par lien, impression. |
| **Outils** | Convertisseur de devises (≈ 160 monnaies, derniers taux gardés hors ligne), 14 phrases utiles en 20 langues avec lecture à voix haute et affichage en grand, urgences et ambassade, heures et décalages, conversions d'unités, check-list de départ. |
| **Aide** | Préférences (langue, thème, unités, pays de résidence, devise), installation, mode hors connexion, dépannage, sources et licences, effacement des données. |

## Ouvrir l'application

L'application est un site statique : aucun serveur applicatif, aucune base de données, aucune clé d'API.

- **En ligne** : **https://fatahben06.github.io/atlo/** (GitHub Pages, publié depuis la branche `main`, dossier racine). Chaque envoi sur `main` met le site à jour en une ou deux minutes.
- **Sur votre ordinateur** : `npx serve .` (ou `python3 -m http.server`), puis ouvrez l'adresse affichée. Ouvrir `index.html` directement fonctionne aussi, mais sans installation ni mode hors connexion.

### Installer sur un téléphone

- **Android** (Chrome, Edge, Samsung) : menu ⋮ → *Installer l'application*.
- **iPhone / iPad** (Safari) : bouton Partager → *Sur l'écran d'accueil*.
- **Ordinateur** (Chrome, Edge) : icône d'installation dans la barre d'adresse.

## Hors connexion

Après une première visite en ligne, l'application, les pays, les sites, les phrases, l'itinéraire et la check-list restent disponibles sans réseau. Les régions et villes d'un pays sont gardées dès qu'on l'a ouvert ; *Aide → Télécharger les données de tous les pays* les prépare toutes (≈ 3 Mo). Les zones de carte consultées, les derniers taux de change et les dernières réponses météo et Wikipédia sont aussi conservés. Sans carte (pas de réseau ni de WebGL), Atlo affiche des **positions schématiques** cliquables.

## Techniques employées

- **Aucun framework** : JavaScript moderne sans étape de compilation, DOM construit sans `innerHTML` (aucune injection possible), politique de sécurité du contenu (CSP) stricte.
- **Performance** : environ 170 ko compressés au premier chargement (tous les pays et sites compris) ; carte (MapLibre, ≈ 270 ko compressés) chargée seulement quand elle sert ; régions et villes chargées pays par pays ; sections météo, climat et découvertes chargées quand elles deviennent visibles ; `content-visibility` sur les longues listes.
- **Carte** : MapLibre GL JS (tuiles vectorielles OpenFreeMap, noms dans la langue choisie, arabe et hébreu correctement affichés), regroupement des points, contours des régions ; carte du monde en SVG (projection Equal Earth) dessinée instantanément.
- **PWA** : manifeste, icônes adaptatives, raccourcis, service worker (coquille en cache, données en cache d'abord, services en réseau d'abord avec copie de secours, caches bornés).
- **International** : `Intl` pour les noms de pays, langues et monnaies, les nombres, dates, heures et fuseaux, les pluriels (y compris l'arabe) ; mise en page en propriétés logiques pour l'écriture de droite à gauche.
- **Accessibilité** : navigation au clavier (y compris pour réordonner l'itinéraire), titres et repères, liens d'évitement, contrastes vérifiés (≥ 4,5:1 pour le texte dans les deux thèmes), graphiques avec tableau équivalent, mouvement réduit respecté.
- **Graphiques** : jamais deux axes (températures et pluie sont deux petits graphiques), rampe séquentielle à une teinte pour la carte du monde, trois couleurs au plus sur la carte interactive (sites, découvertes, étapes).

## Organisation des fichiers

```
atlo/
├── index.html, manifest.webmanifest, sw.js
├── css/atlo.css
├── js/
│   ├── i18n.js        textes de l'interface (fr, en, es, ar) et noms localisés
│   ├── outils.js      fonctions pures : géométrie, itinéraire, exports, climat
│   ├── services.js    Open-Meteo, Wikipédia, taux de change (délais, cache)
│   ├── carte.js       MapLibre, carte du monde SVG, repli schématique
│   ├── noyau.js       éléments, préférences, données, formats, routeur
│   ├── vues.js        accueil, pays, région, lieu, autour de moi, fiches
│   ├── itineraire.js  état et écran de l'itinéraire
│   ├── outils-vue.js  outils et aide
│   └── app.js         démarrage (thème, installation, service worker)
├── data/              pays.js, sites.js, monde.js, phrases.js, pays/XX.js
├── outils/            construire_donnees.py, referentiels.py, sites.txt
├── tests/             test_outils.mjs, test_navigateur.mjs
└── vendor/            MapLibre, extension RTL, police des drapeaux (+ licences)
```

## Publier une nouvelle version

À chaque mise en ligne d'une version modifiée, changez `VERSION` en tête de `sw.js` (par exemple `atlo-2026-10-09-3`). C'est ce changement qui déclenche la mise à jour chez les utilisateurs : l'application leur propose alors « Recharger ».

## Mettre à jour les données

Les fichiers de `data/` sont générés ; ne les modifiez pas à la main.

```bash
pip install shapely
python3 outils/construire_donnees.py --cache /tmp/atlo-cache   # depuis la racine du dépôt
```

Le script télécharge les sources (Natural Earth, mledoze/countries, countries-and-timezones), regroupe les unités trop fines (départements → régions en France, provinces → régions en Italie et en Espagne, nations et régions au Royaume-Uni…), simplifie les contours, rattache chaque ville et chaque site à sa région et **vérifie que chaque site tombe bien dans son pays** (les écarts sont listés).

- **Ajouter un site** : une ligne dans `outils/sites.txt` (`pays|catégorie|latitude|longitude|n° UNESCO|titre Wikipédia FR|titre Wikipédia EN|nom FR|nom EN`), puis relancer le script.
- **Numéros d'urgence, prises, sens de circulation, regroupements** : `outils/referentiels.py`. Un pays absent affiche « non renseigné » plutôt qu'une valeur approximative.

## Tests

```bash
node --test tests/test_outils.mjs      # 14 tests : distances, polygones, optimisation, planning, exports, climat, données
node tests/test_navigateur.mjs [dossier-captures]   # parcours complet dans Chromium (Playwright), services simulés
```

Le parcours navigateur vérifie l'accueil, la recherche, les fiches, l'Algérie (48 wilayas, 18 sites, météo, climat), Ghardaïa, la France (13 régions), « Autour de moi », l'itinéraire (optimisation, GPX, agenda, partage), les outils, les quatre langues dont l'arabe, l'affichage mobile en thème sombre et le mode hors connexion.

## Limites connues

- Temps et distances de l'itinéraire : **estimations** à partir du vol d'oiseau (détour et vitesse moyenne par mode). Pour la navigation, Atlo ouvre Google Maps ou l'application de votre choix.
- Découpage régional de Natural Earth : certaines réformes récentes n'y figurent pas encore (Algérie : 48 wilayas au lieu de 58 ; Maroc : 16 régions au lieu de 12).
- Services en ligne gratuits : Open-Meteo est gratuit pour un usage non commercial (voir `LICENCES.md`).

## Vie privée

Pas de compte, pas de serveur, pas de traceur. Préférences, itinéraire et check-list restent dans le navigateur. La position n'est utilisée que sur l'appareil ; seules des coordonnées arrondies sont envoyées aux services météo et Wikipédia pour chercher autour de vous.

Sources et licences détaillées : [`LICENCES.md`](LICENCES.md).
