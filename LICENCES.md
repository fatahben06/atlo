# Licences des données et composants tiers

Le code d'Atlo (dossiers `js/`, `css/`, `outils/`, `tests/`, `index.html`, `sw.js`) et les saisies éditoriales (`outils/sites.txt`, `outils/referentiels.py`, `data/phrases.js`) appartiennent au propriétaire de ce dépôt.

| Composant | Utilisation | Licence |
|---|---|---|
| [Natural Earth](https://www.naturalearthdata.com/) 5.x | régions, villes, contours (`data/pays/*.js`, `data/monde.js`) | domaine public |
| [mledoze/countries](https://github.com/mledoze/countries) | noms, capitales, langues, monnaies, indicatifs (`data/pays.js`) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) — `data/pays.js` est une base dérivée, diffusée sous la même licence |
| [countries-and-timezones](https://github.com/manuelmhtr/countries-and-timezones) | fuseaux horaires par pays (`data/pays.js`) | MIT — `vendor/LICENSE-countries-and-timezones.txt` |
| [MapLibre GL JS](https://maplibre.org/) 5.24 | carte interactive (`vendor/maplibre-gl.*`) | BSD-3 — `vendor/LICENSE-maplibre.txt` |
| [mapbox-gl-rtl-text](https://github.com/mapbox/mapbox-gl-rtl-text) 0.3 | écriture arabe et hébraïque sur la carte | BSD-2 — `vendor/LICENSE-rtl-text.md` |
| [Twemoji Country Flags](https://github.com/talkjs/country-flag-emoji-polyfill) | drapeaux sous Windows | MIT (code), CC BY 4.0 (dessins Twemoji) — `vendor/LICENSE-drapeaux.md` |

Services appelés depuis le navigateur de l'utilisateur, avec attribution affichée dans l'application :

| Service | Contenu | Conditions |
|---|---|---|
| [OpenFreeMap](https://openfreemap.org/) | fond de carte vectoriel (© OpenMapTiles, © contributeurs OpenStreetMap) | gratuit, sans clé ; données ODbL |
| [Open-Meteo](https://open-meteo.com/) | prévisions, climat (ERA5), recherche de villes (GeoNames) | gratuit pour un usage non commercial, CC BY 4.0 |
| [Wikipédia](https://www.wikipedia.org/) / [Wikimedia Commons](https://commons.wikimedia.org/) | résumés et photos | CC BY-SA ; images sous la licence de leur auteur |
| [ExchangeRate-API](https://www.exchangerate-api.com/) (open.er-api.com) | taux de change quotidiens | gratuit avec la mention « Rates By Exchange Rate API » |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) via [Overpass API](https://overpass-api.de/) | hôtels, auberges, maisons d'hôtes autour d'un lieu (« Où dormir ») | données ODbL, mention « © contributeurs OpenStreetMap » ; usage raisonnable du service public Overpass (une requête par lieu, résultat gardé 6 h) |
| [Wikimedia Commons](https://commons.wikimedia.org/) | photos des guides de ville | licence propre à chaque fichier (auteur et licence affichés sur la photo, lien vers la page du fichier) |

Plateformes de réservation (Booking.com, Google Hôtels, Expedia, Agoda, Airbnb, Tripadvisor) : simples liens de recherche ouverts dans un nouvel onglet ; aucun contenu n'est repris ni copié depuis ces sites. Identifiants d'affiliation éventuels : `data/partenaires.js`.

Guides de ville (`data/guides/*.js`) : textes rédigés pour Atlo à partir des sources listées dans chaque guide.

Pour un usage commercial d'Open-Meteo, prendre un abonnement (ou héberger son propre serveur Open-Meteo) et remplacer l'adresse dans `js/services.js`.
