/* Atlo · service worker : application disponible hors connexion.
   - coquille de l'application pré-enregistrée à l'installation et servie depuis le cache
     (HTML, scripts et données d'une même version : jamais de mélange entre versions) ;
     À CHAQUE MISE EN LIGNE, CHANGER « VERSION » : c'est ce qui déclenche la mise à jour ;
   - régions des pays, guides de ville et bibliothèques : cache d'abord, rafraîchi en arrière-plan,
     conservé d'une version à l'autre ;
   - tuiles, polices et icônes de carte : cache d'abord (limité) ;
   - météo, Wikipédia et Commons, taux, hébergements OpenStreetMap : réseau d'abord, copie de secours en cache. */
const VERSION = "atlo-2026-10-17-1";
const COQUILLE = VERSION + "-coquille";
const DONNEES = "atlo-donnees";
const TUILES = "atlo-tuiles";
const API = "atlo-api";
const IMAGES = "atlo-images";
const LIMITES = { [TUILES]: 3000, [API]: 400, [IMAGES]: 250 };

const FICHIERS = [
  "./", "index.html", "manifest.webmanifest", "css/atlo.css",
  "js/i18n.js", "js/outils.js", "js/services.js", "js/carte.js", "js/noyau.js", "js/vues.js",
  "js/itineraire.js", "js/outils-vue.js", "js/guide.js", "js/app.js",
  "data/pays.js", "data/sites.js", "data/monde.js", "data/phrases.js", "data/guides.js", "data/partenaires.js",
  "icons/icone.svg", "icons/icone-192.png", "vendor/TwemojiCountryFlags.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(COQUILLE).then((c) => c.addAll(FICHIERS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n.startsWith("atlo-2") && !n.startsWith(VERSION)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "activer") self.skipWaiting();
});

let ecritures = 0;
async function ranger(nomCache, requete, reponse) {
  const cache = await caches.open(nomCache);
  await cache.put(requete, reponse);
  if (LIMITES[nomCache] && ++ecritures % 25 === 0) {
    const cles = await cache.keys();
    const surplus = cles.length - LIMITES[nomCache];
    for (let i = 0; i < surplus; i++) await cache.delete(cles[i]);
  }
}

async function cacheDabord(requete, nomCache) {
  const deja = await caches.match(requete);
  if (deja) return deja;
  const reponse = await fetch(requete);
  if (reponse.ok || reponse.type === "opaque") ranger(nomCache, requete, reponse.clone());
  return reponse;
}

async function reseauDabord(requete, nomCache, delai = 8000) {
  try {
    const reponse = await Promise.race([
      fetch(requete),
      new Promise((_, ko) => setTimeout(() => ko(new Error("délai")), delai)),
    ]);
    if (reponse.ok) ranger(nomCache, requete, reponse.clone());
    return reponse;
  } catch (e) {
    const deja = await caches.match(requete);
    if (!deja) throw e;
    // Copie de secours : on signale sa date pour que l'application l'affiche (météo d'hier…).
    if (deja.type === "opaque") return deja;
    const entetes = new Headers(deja.headers);
    entetes.set("x-atlo-copie", String(Date.parse(deja.headers.get("date") || "") || Date.now()));
    return new Response(await deja.blob(), { status: deja.status, statusText: deja.statusText, headers: entetes });
  }
}

async function perimeEnRevalidant(requete, nomCache) {
  const deja = await caches.match(requete);
  const versionne = !!new URL(requete.url).search; // guides : data/guides/<id>.js?v=<empreinte>
  const frais = fetch(requete).then((r) => {
    if (r.ok) {
      const copie = r.clone();
      ranger(nomCache, requete, copie).then(async () => {
        if (!versionne) return;
        // Nouvelle version bien enregistrée : les anciennes sont supprimées (jamais avant).
        const c = await caches.open(nomCache);
        for (const k of await c.keys(requete, { ignoreSearch: true })) if (k.url !== requete.url) await c.delete(k);
      }).catch(() => { /* cache plein ou indisponible : on garde ce qui existe */ });
    }
    return r;
  // Hors ligne après une mise à jour : l'ancienne version du guide vaut mieux que rien.
  }).catch(() => deja || (versionne ? caches.match(requete, { cacheName: nomCache, ignoreSearch: true }) : undefined));
  return deja || frais;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") {
      e.respondWith(caches.match("index.html", { cacheName: COQUILLE }).then((r) => r || fetch(req)));
    } else if (/\/(data\/(pays|guides)|vendor)\//.test(url.pathname)) {
      e.respondWith(perimeEnRevalidant(req, DONNEES));
    } else {
      e.respondWith(caches.match(req, { cacheName: COQUILLE, ignoreSearch: true }).then((r) => r || cacheDabord(req, COQUILLE)));
    }
    return;
  }

  if (url.hostname === "tiles.openfreemap.org") {
    // Les tuiles, glyphes et pictogrammes ne changent pas ; le style et la description des tuiles, si.
    const fixe = /\.(pbf|png|jpg|webp|json)$/.test(url.pathname) && !/\/styles\//.test(url.pathname) && /\/(fonts|sprites|planet\/\d|natural_earth)/.test(url.pathname);
    e.respondWith(fixe ? cacheDabord(req, TUILES) : reseauDabord(req, TUILES, 6000));
    return;
  }

  if (/(^|\.)open-meteo\.com$|(^|\.)wikipedia\.org$|^commons\.wikimedia\.org$|^open\.er-api\.com$/.test(url.hostname)) {
    e.respondWith(reseauDabord(req, API, url.hostname.startsWith("archive") ? 15000 : 8000));
    return;
  }

  if (/^overpass(-api\.de|\.kumi\.systems)$/.test(url.hostname)) {
    e.respondWith(reseauDabord(req, API, 26000));
    return;
  }

  if (url.hostname === "upload.wikimedia.org") {
    e.respondWith(cacheDabord(req, IMAGES));
  }
});
