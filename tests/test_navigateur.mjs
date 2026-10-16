/* Atlo · parcours complet dans Chromium, services en ligne simulés (aucun accès réseau requis).
   Usage : node tests/test_navigateur.mjs [dossier-captures]
   Prérequis : Playwright (npm i -g playwright) et un Chromium installé. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch (e) {
  playwright = await import(process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright/index.mjs");
}
const { chromium } = playwright;

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURES = process.argv[2] || null;
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

// ------------------------------------------------------------ serveur statique
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const serveur = http.createServer((req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const fichier = path.join(RACINE, chemin.endsWith("/") ? chemin + "index.html" : chemin);
  if (!fichier.startsWith(RACINE) || !fs.existsSync(fichier) || fs.statSync(fichier).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(fichier)] || "application/octet-stream" });
  fs.createReadStream(fichier).pipe(res);
});
await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${serveur.address().port}/`;

// ------------------------------------------------------------ services simulés
const CORS = { "Access-Control-Allow-Origin": "*" };
const PNG = fs.readFileSync(path.join(RACINE, "icons/icone-192.png"));
function jours(n, debut = "2026-10-09") {
  const d0 = new Date(debut + "T00:00:00Z");
  return Array.from({ length: n }, (_, i) => new Date(d0.getTime() + i * 864e5).toISOString().slice(0, 10));
}
function meteo() {
  const t = jours(7);
  return {
    timezone: "Africa/Algiers", utc_offset_seconds: 3600,
    current: { temperature_2m: 24.3, apparent_temperature: 25.1, relative_humidity_2m: 61, weather_code: 1, wind_speed_10m: 14, is_day: 1 },
    daily: {
      time: t, weather_code: [1, 2, 3, 61, 0, 0, 95], temperature_2m_max: [27, 26, 25, 22, 24, 26, 28], temperature_2m_min: [18, 17, 17, 15, 16, 17, 19],
      precipitation_probability_max: [5, 10, 20, 70, 0, 0, 40], uv_index_max: [6.2, 5, 4, 3, 6, 6.5, 7],
      sunrise: t.map((d) => d + "T06:52"), sunset: t.map((d) => d + "T18:31"),
    },
  };
}
function archive() {
  const t = [];
  for (let d = new Date(Date.UTC(2023, 0, 1)); d < new Date(Date.UTC(2026, 0, 1)); d = new Date(d.getTime() + 864e5)) t.push(d.toISOString().slice(0, 10));
  const saison = (d) => Math.cos(((Number(d.slice(5, 7)) - 7.5) / 12) * 2 * Math.PI);
  return {
    daily: {
      time: t,
      temperature_2m_max: t.map((d) => 23 + 9 * saison(d)),
      temperature_2m_min: t.map((d) => 14 + 7 * saison(d)),
      precipitation_sum: t.map((d) => Math.max(0, 2.6 - 2.5 * saison(d))),
    },
  };
}
const TAUX = { result: "success", time_last_update_unix: 1760000000, rates: { USD: 1, EUR: 0.86, DZD: 130.2, MAD: 9.1, TND: 2.92, JPY: 150.1, GBP: 0.75, JOD: 0.709, CAD: 1.37, CHF: 0.8 } };

async function simuler(contexte) {
  await contexte.route("https://api.open-meteo.com/**", (r) => r.fulfill({ headers: CORS, json: meteo() }));
  await contexte.route("https://archive-api.open-meteo.com/**", (r) => r.fulfill({ headers: CORS, json: archive() }));
  await contexte.route("https://geocoding-api.open-meteo.com/**", (r) => r.fulfill({
    headers: CORS, json: { results: [{ name: "Oran", latitude: 35.6969, longitude: -0.6331, country_code: "DZ", admin1: "Oran", population: 645984, timezone: "Africa/Algiers" }] },
  }));
  await contexte.route("https://open.er-api.com/**", (r) => r.fulfill({ headers: CORS, json: TAUX }));
  await contexte.route(/https:\/\/\w+\.wikipedia\.org\/api\/rest_v1\/page\/summary\/.*/, (r) => {
    const titre = decodeURIComponent(r.request().url().split("/summary/")[1]).replace(/_/g, " ");
    r.fulfill({ headers: CORS, json: {
      type: "standard", title: titre, extract: `${titre} : résumé de démonstration fourni par le test (Wikipédia simulée).`,
      thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Test.jpg/320px-Test.jpg" },
      content_urls: { desktop: { page: "https://fr.wikipedia.org/wiki/" + encodeURIComponent(titre) } },
    } });
  });
  await contexte.route(/https:\/\/\w+\.wikipedia\.org\/w\/api\.php.*/, (r) => {
    const u = new URL(r.request().url());
    if (u.searchParams.get("prop") === "langlinks") return r.fulfill({ headers: CORS, json: { query: { pages: [{ title: "x", langlinks: [{ lang: "ar", title: "عنوان" }] }] } } });
    if (u.searchParams.get("generator") === "geosearch") {
      const [lat, lon] = u.searchParams.get("ggscoord").split("|").map(Number);
      return r.fulfill({ headers: CORS, json: { query: { pages: [
        { title: "Lieu illustré", description: "monument", coordinates: [{ lat: lat + 0.004, lon: lon + 0.003 }], thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/A.jpg/240px-A.jpg" } },
        { title: "Lieu sans image", coordinates: [{ lat: lat - 0.01, lon }] },
      ] } } });
    }
    return r.fulfill({ headers: CORS, json: { query: { search: [] } } });
  });
  await contexte.route("https://upload.wikimedia.org/**", (r) => r.fulfill({ headers: CORS, body: PNG, contentType: "image/png" }));
  await contexte.route("https://commons.wikimedia.org/w/api.php**", (r) => {
    const titres = (new URL(r.request().url()).searchParams.get("titles") || "").split("|").filter(Boolean);
    r.fulfill({ headers: CORS, json: { query: { pages: titres.map((ti, i) => ({
      title: ti, imageinfo: [{ thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/a${i}/T${i}.jpg/960px-T${i}.jpg`, descriptionurl: "https://commons.wikimedia.org/wiki/" + encodeURIComponent(ti),
        extmetadata: { Artist: { value: "<a href='x'>Auteur Test</a>" }, LicenseShortName: { value: "CC BY-SA 4.0" } } }],
    })) } } });
  });
  // Hébergements OpenStreetMap simulés : un établissement connu (sans position dans la sélection), deux nouveaux, un sans nom.
  await contexte.route(/https:\/\/overpass(-api\.de|\.kumi\.systems)\/api\/interpreter.*/, (r) => r.fulfill({ headers: CORS, json: { elements: [
    { type: "node", id: 1, lat: 36.7536, lon: 5.0871, tags: { tourism: "hotel", name: "Hotel de l'Etoile", stars: "3", phone: "+213 34 00 00 00" } },
    { type: "way", id: 2, center: { lat: 36.7489, lon: 5.07 }, tags: { tourism: "hotel", name: "Hôtel Zéphyr", website: "zephyr.example" } },
    { type: "node", id: 3, lat: 36.66, lon: 5.16, tags: { tourism: "guest_house", name: "Maison d'hôtes Test", "addr:city": "Tichy" } },
    { type: "node", id: 4, lat: 36.7, lon: 5.05, tags: { tourism: "hostel" } },
  ] } }));
  // Fond de carte minimal à la place d'OpenFreeMap (pas de réseau ici).
  await contexte.route("https://tiles.openfreemap.org/styles/**", (r) => r.fulfill({ headers: CORS, json: {
    version: 8, sources: {}, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    layers: [{ id: "fond", type: "background", paint: { "background-color": "#dce8f3" } }],
  } }));
  await contexte.route("https://tiles.openfreemap.org/fonts/**", (r) => r.fulfill({ headers: CORS, status: 404, body: "" }));
}

// ------------------------------------------------------------ vérifications
let echecs = 0;
const verifier = (condition, message) => {
  console.log((condition ? "  ✓ " : "  ✗ ") + message);
  if (!condition) echecs++;
};

const navigateur = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

async function parcours(nom, options) {
  console.log(`\n== ${nom}`);
  const contexte = await navigateur.newContext(Object.assign({
    locale: "fr-DZ", timezoneId: "Africa/Algiers", geolocation: { latitude: 36.7538, longitude: 3.0588, accuracy: 25 },
    permissions: ["geolocation"], acceptDownloads: true, serviceWorkers: "block",
  }, options));
  await simuler(contexte);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const texte = m.text();
    // Glyphes absents du fond simulé : attendu dans ce test.
    if (/fonts|glyph|Failed to load resource: the server responded with a status of 404/i.test(texte)) return;
    erreurs.push("console: " + texte);
  });
  const capture = async (fichier) => CAPTURES && page.screenshot({ path: path.join(CAPTURES, `${nom}-${fichier}.png`) });
  return { contexte, page, erreurs, capture };
}

// ------------------------------------------------------------ bureau
{
  const { contexte, page, erreurs, capture } = await parcours("bureau", { viewport: { width: 1366, height: 860 } });
  await page.goto(BASE + "#/");
  await page.waitForSelector(".grille-pays li");
  verifier((await page.textContent("h1")).includes("Atlo"), "accueil : titre Atlo");
  const stats = await page.$$eval(".stats dd", (els) => els.map((e) => e.textContent));
  verifier(stats[0] === "250" && /1\s?106/.test(stats[1]), `accueil : statistiques (${stats.join(" / ")})`);
  verifier((await page.$$(".monde-pays")).length > 150, "accueil : carte du monde SVG dessinée");
  verifier((await page.$$(".grille-pays li:not([hidden])")).length === 250, "accueil : 250 pays listés");
  await page.click('.puces button:has-text("Afrique")');
  const afrique = await page.$$(".grille-pays li:not([hidden])");
  verifier(afrique.length > 50 && afrique.length < 70, `accueil : filtre Afrique (${afrique.length})`);
  await page.click('.puces button:has-text("Tous")');
  await capture("accueil");

  await page.fill("#recherche", "petra");
  await page.waitForSelector(".resultats .site");
  verifier((await page.textContent(".resultats")).includes("Pétra"), "recherche : « petra » trouve Pétra");
  await page.waitForSelector('.resultats a.lieu', { timeout: 4000 }).catch(() => null);
  verifier(!!(await page.$(".resultats a.lieu")), "recherche : villes du monde (géocodage simulé)");
  await page.click('.resultats .site-ouvrir:has-text("Pétra")');
  await page.waitForSelector("#fiche[open] .fiche-resume p");
  verifier((await page.textContent("#fiche .fiche-resume")).includes("résumé de démonstration"), "fiche : résumé Wikipédia affiché");
  verifier(!!(await page.$("#fiche img")), "fiche : photo affichée");
  await page.click('#fiche .bouton-etape');
  verifier((await page.getAttribute("#fiche .bouton-etape", "aria-pressed")) === "true", "fiche : ajout à l'itinéraire");
  await capture("fiche");
  await page.keyboard.press("Escape");

  await page.goto(BASE + "#/pays/DZ");
  await page.waitForSelector(".regions li");
  verifier((await page.$$(".regions li")).length === 48, "Algérie : 48 wilayas");
  const nbSites = (await page.$$("#titre-sites ~ .liste-sites .site")).length;
  verifier(nbSites >= 15, `Algérie : ${nbSites} sites emblématiques`);
  verifier((await page.textContent(".tuiles")).includes("+213"), "Algérie : indicatif +213");
  verifier((await page.textContent(".tuiles")).includes("Dinar algérien") || (await page.textContent(".tuiles")).includes("DZD"), "Algérie : monnaie");
  await page.waitForSelector(".carte-gl canvas, .schema", { timeout: 15000 });
  verifier(!!(await page.$(".carte-gl canvas")), "Algérie : carte MapLibre (WebGL) affichée");
  await page.locator(".meteo").scrollIntoViewIfNeeded();
  await page.waitForSelector(".meteo-temp");
  verifier((await page.textContent(".meteo-temp")).includes("24"), "Algérie : météo de la capitale");
  await page.locator(".climat").scrollIntoViewIfNeeded();
  await page.waitForSelector(".climat .graphique");
  verifier((await page.$$(".climat .graphique")).length === 2, "Algérie : deux graphiques climatiques");
  verifier((await page.textContent(".meilleure-periode")).length > 10, "Algérie : meilleure période calculée");
  await page.locator(".page-pays").evaluate((e) => e.closest(".vue").scrollTo(0, 0));
  await page.waitForTimeout(1500);
  await capture("algerie");

  await page.fill('input[placeholder*="région"]', "ghar");
  await page.click('.regions a:has-text("Ghardaïa")');
  await page.waitForSelector(".page-region h1");
  verifier((await page.textContent(".page-region h1")).includes("Ghardaïa"), "région : Ghardaïa");
  verifier((await page.textContent(".page-region")).includes("M'Zab"), "région : vallée du M'Zab listée");
  await page.locator(".autour").scrollIntoViewIfNeeded();
  await page.waitForSelector(".decouverte");
  verifier((await page.$$(".decouverte")).length === 2, "région : découvertes Wikipédia");

  await page.goto(BASE + "#/pays/FR");
  await page.waitForSelector(".regions li");
  verifier((await page.$$(".regions li")).length === 13, "France : 13 régions métropolitaines");

  await page.goto(BASE + "#/autour");
  await page.waitForSelector(".page-lieu h1", { timeout: 15000 });
  verifier((await page.textContent(".page-lieu h1")).includes("Alger"), "autour de moi : Alger trouvée hors ligne");
  verifier((await page.textContent(".page-lieu .sous-titre")).includes("Algérie"), "autour de moi : pays et région");

  // Itinéraire : ajout de plusieurs sites, optimisation, exports.
  for (const id of ["casbah-of-algiers", "timgad", "tipasa", "djemila"]) {
    await page.evaluate((i) => { const s = Atlo.SITE.get(i); Atlo.itineraire.ajouter(Atlo.etapeDeSite(s), { silencieux: true }); }, id);
  }
  await page.goto(BASE + "#/itineraire");
  await page.waitForSelector(".etape");
  verifier((await page.$$(".etape")).length === 5, "itinéraire : 5 étapes");
  await page.click('button:has-text("Optimiser")');
  const ordre = await page.$$eval(".etape .etape-nom", (els) => els.map((e) => e.textContent));
  verifier(ordre.length === 5, "itinéraire : ordre optimisé " + ordre.join(" → "));
  await page.fill("#date-debut", "2026-11-02");
  await page.dispatchEvent("#date-debut", "change");
  await page.click('summary:has-text("Exporter")');
  const [gpx] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("GPX")')]);
  const contenuGpx = fs.readFileSync(await gpx.path(), "utf8");
  verifier(contenuGpx.includes("<rtept") && contenuGpx.includes("Timgad"), "itinéraire : export GPX");
  await page.click('summary:has-text("Exporter")').catch(() => {});
  await page.click('summary:has-text("Exporter")');
  const [ics] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Agenda")')]);
  verifier(fs.readFileSync(await ics.path(), "utf8").includes("BEGIN:VEVENT"), "itinéraire : export agenda .ics");
  const lien = await page.evaluate(() => location.origin + location.pathname + "#/itineraire?i=" + AtloOutils.encoderItineraire(Atlo.itineraire.etat()));
  await page.waitForTimeout(600);
  await capture("itineraire");

  // Partage : ouverture du lien dans un autre navigateur (stockage vide).
  const autre = await navigateur.newContext({ locale: "fr-FR", viewport: { width: 1200, height: 800 }, serviceWorkers: "block" });
  await simuler(autre);
  const p2 = await autre.newPage();
  await p2.goto(lien);
  await p2.waitForSelector(".banniere");
  await p2.click('button:has-text("Remplacer le mien")');
  await p2.waitForSelector(".etape");
  verifier((await p2.$$(".etape")).length === 5, "partage : itinéraire importé depuis le lien");
  await autre.close();

  await page.goto(BASE + "#/outils?p=JP");
  await page.waitForSelector(".resultat-conversion");
  await page.waitForFunction(() => /¥|JPY/.test(document.querySelector(".resultat-conversion").textContent));
  verifier((await page.textContent(".resultat-conversion")).length > 5, "outils : conversion DZD → JPY (" + (await page.textContent(".resultat-conversion")) + ")");
  verifier((await page.textContent(".phrases")).includes("ありがとうございます"), "outils : phrases en japonais");
  verifier((await page.textContent("#urgences")).includes("110"), "outils : urgences Japon");
  await capture("outils");

  await page.goto(BASE + "#/aide");
  await page.selectOption(".page-aide select >> nth=0", "en");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  verifier((await page.textContent(".nav-principale")).includes("Explore"), "langue : interface en anglais");
  await page.goto(BASE + "#/pays/JO");
  await page.waitForSelector(".page-pays h1");
  verifier((await page.textContent(".page-pays h1")).includes("Jordan"), "langue : nom du pays en anglais");
  await page.goto(BASE + "#/aide");
  await page.selectOption(".page-aide select >> nth=0", "ar");
  await page.waitForFunction(() => document.documentElement.dir === "rtl");
  verifier(true, "langue : arabe, sens droite → gauche");
  await page.goto(BASE + "#/pays/MA");
  await page.waitForSelector(".page-pays h1");
  verifier((await page.textContent(".page-pays h1")).includes("المغرب"), "langue : nom du pays en arabe");
  await page.waitForTimeout(800);
  await capture("arabe");
  await page.evaluate(() => { Atlo.prefs.langue = "fr"; Atlo.enregistrerPrefs(); });

  verifier(erreurs.length === 0, "aucune erreur JavaScript" + (erreurs.length ? " :\n    " + erreurs.join("\n    ") : ""));
  await contexte.close();
}

// ------------------------------------------------------------ guide de Béjaïa
{
  const { contexte, page, erreurs, capture } = await parcours("bejaia", { viewport: { width: 1366, height: 860 } });
  const dans = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  await page.goto(BASE + "#/");
  await page.waitForSelector(".carte-guide");
  verifier((await page.textContent(".carte-guide")).includes("Béjaïa"), "accueil : guide de Béjaïa à la une");
  await page.fill("#recherche", "cap carbon");
  await page.waitForSelector('.resultats a[href="#/guide/bejaia/site/cap-carbon"]');
  verifier(true, "recherche : « cap carbon » mène à la fiche du guide");
  await page.fill("#recherche", "");
  await page.click(".carte-guide");
  await page.waitForSelector(".carte-site");
  verifier((await page.$$(".carte-site")).length === 20, "guide : 20 incontournables");
  verifier((await page.textContent(".carte-site >> nth=0")).includes("Cap Carbon"), "guide : n° 1 en tête");
  verifier(!(await page.$(".bandeau-brouillon")), "guide : données vérifiées (pas de bandeau brouillon)");
  await page.waitForSelector(".carte-site .vignette img", { timeout: 5000 }).catch(() => null);
  verifier((await page.$$(".carte-site .vignette img")).length >= 5, "guide : photos Wikimedia Commons");
  await page.click('.puces button:has-text("Plage")');
  const plages = (await page.$$(".carte-site")).length;
  verifier(plages > 1 && plages < 20, `guide : filtre plages (${plages})`);
  await page.click('.puces button:has-text("Tout")');
  await page.waitForSelector(".carte-gl canvas, .schema", { timeout: 15000 });
  await page.waitForTimeout(1200);
  await capture("guide");
  await page.click(".carte-site-ouvrir >> nth=0");
  await page.waitForSelector("#fiche[open] .rang-fiche");
  verifier((await page.textContent("#fiche .rang-fiche")).includes("1"), "fiche : rang affiché");
  verifier((await page.$$("#fiche .faits div")).length >= 3, "fiche : durée, moment, distance");
  await page.waitForSelector("#fiche .proche", { timeout: 5000 }).catch(() => null);
  verifier((await page.textContent("#fiche")).includes("Dormir à proximité"), "fiche : hébergements à proximité (OpenStreetMap)");
  await page.click("#fiche .favori");
  verifier((await page.getAttribute("#fiche .favori", "aria-pressed")) === "true", "fiche : ajout aux favoris");
  await capture("fiche-site");
  await page.keyboard.press("Escape");
  verifier((await page.textContent('.puces button:has-text("Favoris")')).includes("1"), "guide : compteur de favoris");

  await page.click('.onglet-guide:has-text("Où dormir")');
  await page.waitForSelector(".carte-heb");
  await page.waitForFunction(() => document.querySelectorAll(".carte-heb").length >= 26, null, { timeout: 8000 }).catch(() => null);
  const nbHeb = (await page.$$(".carte-heb")).length;
  verifier(nbHeb === 26, `dormir : 24 vérifiés + 2 OpenStreetMap, sans doublon (${nbHeb})`);
  await page.fill("#sejour-arrivee", dans(30));
  await page.dispatchEvent("#sejour-arrivee", "change");
  verifier((await page.inputValue("#sejour-depart")) === dans(31), "dormir : départ proposé le lendemain");
  const lienBooking = await page.getAttribute(".sejour-liens a >> nth=0", "href");
  verifier(lienBooking.includes("checkin=" + dans(30)) && lienBooking.includes("group_adults=2"), "dormir : recherche Booking avec dates et voyageurs");
  await page.click('.sejour .compteur-champ >> nth=0 >> button[aria-label^="Plus"]');
  verifier((await page.getAttribute(".sejour-liens a >> nth=0", "href")).includes("group_adults=3"), "dormir : nombre de voyageurs repris");
  await page.click('.carte-heb-ouvrir:has-text("Étoile")');
  await page.waitForSelector("#fiche[open] .plateformes a");
  const plateformes = await page.$$eval("#fiche .plateformes a", (as) => as.map((a) => a.href));
  verifier(plateformes.length >= 5 && plateformes[0].includes("booking.com") && plateformes[0].includes("checkin="), `fiche hôtel : ${plateformes.length} plateformes, dates incluses`);
  verifier((await page.textContent("#fiche")).includes("+213 34 00 00 00"), "fiche hôtel : téléphone complété par OpenStreetMap");
  await page.waitForTimeout(500);
  await capture("fiche-hotel");
  await page.keyboard.press("Escape");
  await page.click('.puces button:has-text("Auberges")');
  verifier((await page.$$(".carte-heb")).length === 1, "dormir : filtre auberges");
  await page.click('.puces button:has-text("Tout") >> nth=0');
  await page.selectOption(".titre-ligne select", "site:cap-carbon");
  verifier((await page.textContent(".carte-heb >> nth=0")).includes("de Cap Carbon"), "dormir : tri par proximité d'un site");
  await page.waitForTimeout(800);
  await capture("dormir");

  await page.click('.onglet-guide:has-text("Itinéraires")');
  await page.waitForSelector(".itineraire-pret");
  verifier((await page.$$(".itineraire-pret")).length === 3, "itinéraires : 3 parcours prêts");
  await capture("itineraires");
  await page.click('.itineraire-pret >> nth=0 >> button:has-text("Utiliser")');
  await page.waitForSelector(".page-itineraire .etape");
  verifier((await page.$$(".etape")).length === 7, "itinéraires : parcours d'un jour chargé (7 étapes)");
  await page.click(".etape-nom >> nth=0");
  await page.waitForSelector("#fiche[open] .rang-fiche");
  verifier(true, "itinéraire : étape du guide ouvre sa fiche");
  await page.keyboard.press("Escape");

  await page.goto(BASE + "#/guide/bejaia/pratique");
  await page.waitForSelector("#pr-venir");
  await page.locator(".meteo").scrollIntoViewIfNeeded();
  await page.waitForSelector(".meteo-temp");
  verifier(true, "pratique : venir, météo et climat");

  await page.goto(BASE + "#/pays/DZ/r/6");
  await page.waitForSelector(".page-region .carte-guide");
  verifier(true, "région Béjaïa : lien vers le guide");
  await page.locator("#titre-dormir").scrollIntoViewIfNeeded();
  await page.waitForSelector(".page-region .carte-heb", { timeout: 8000 }).catch(() => null);
  verifier((await page.$$(".page-region .carte-heb")).length === 3, "région : « Où dormir » (OpenStreetMap)");

  await page.goto(BASE + "#/guide/bejaia/site/bordj-moussa");
  await page.waitForSelector("#fiche[open] .fiche-titre");
  const yAller = await page.getAttribute('#fiche a:has-text("Y aller")', "href");
  verifier(yAller.includes("destination=Bordj%20Moussa") && (await page.textContent("#fiche")).includes("Position approximative"), "position approximative : itinéraire par le nom");
  verifier((await page.textContent("#fiche")).includes("15 mois"), "Bordj Moussa : avertissement travaux");
  await page.keyboard.press("Escape");
  await page.goto(BASE + "#/guide/bejaia/site/pic-des-singes");
  await page.waitForSelector("#fiche[open] .fiche-titre");
  verifier((await page.textContent("#fiche .fiche-titre")).includes("Pic des Singes"), "lien direct vers la fiche d'un site");
  await page.keyboard.press("Escape");
  verifier(erreurs.length === 0, "aucune erreur JavaScript" + (erreurs.length ? " :\n    " + erreurs.join("\n    ") : ""));
  await contexte.close();
}
{
  const { contexte, page, erreurs, capture } = await parcours("bejaia-mobile", {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark",
  });
  await page.goto(BASE + "#/guide/bejaia");
  await page.waitForSelector(".carte-site");
  await page.waitForTimeout(1200);
  const largeur = await page.evaluate(() => document.documentElement.scrollWidth);
  verifier(largeur <= 390, `guide mobile : pas de défilement horizontal (${largeur}px)`);
  await capture("guide");
  await page.goto(BASE + "#/guide/bejaia/dormir");
  await page.waitForSelector(".carte-heb");
  await page.waitForTimeout(800);
  const largeur2 = await page.evaluate(() => document.documentElement.scrollWidth);
  verifier(largeur2 <= 390, `dormir mobile : pas de défilement horizontal (${largeur2}px)`);
  await capture("dormir");
  await page.evaluate(() => { Atlo.prefs.langue = "ar"; Atlo.enregistrerPrefs(); });
  await page.goto(BASE + "#/guide/bejaia");
  await page.reload();
  await page.waitForSelector(".carte-site");
  verifier((await page.textContent(".guide-hero h1")).includes("بجاية"), "guide en arabe");
  await page.waitForTimeout(600);
  await capture("guide-arabe");
  verifier(erreurs.length === 0, "aucune erreur JavaScript" + (erreurs.length ? " :\n    " + erreurs.join("\n    ") : ""));
  await contexte.close();
}

// ------------------------------------------------------------ mobile, thème sombre, hors connexion
{
  const { contexte, page, erreurs, capture } = await parcours("mobile", {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark",
  });
  await page.goto(BASE + "#/");
  await page.waitForSelector(".grille-pays li");
  verifier(await page.isVisible(".onglets"), "mobile : onglets en bas d'écran");
  verifier(!(await page.isVisible(".nav-principale")), "mobile : navigation du haut masquée");
  const largeur = await page.evaluate(() => document.documentElement.scrollWidth);
  verifier(largeur <= 390, `mobile : pas de défilement horizontal (${largeur}px)`);
  await capture("accueil");
  await page.goto(BASE + "#/pays/MA");
  await page.waitForSelector(".regions li");
  await page.waitForTimeout(1500);
  await capture("maroc");
  await page.click('.site-ouvrir:has-text("Chefchaouen")');
  await page.waitForSelector("#fiche[open] .fiche-resume p");
  await page.waitForTimeout(400);
  await capture("fiche");
  await page.keyboard.press("Escape");

  await page.goto(BASE + "#/outils?p=MA");
  await page.waitForSelector(".phrases li");
  verifier((await page.$$(".phrases li")).length === 14, "outils : 14 phrases (arabe pour le Maroc)");
  const largeur2 = await page.evaluate(() => document.documentElement.scrollWidth);
  verifier(largeur2 <= 390, `mobile (outils) : pas de défilement horizontal (${largeur2}px)`);
  await capture("outils");
  verifier(erreurs.length === 0, "aucune erreur JavaScript" + (erreurs.length ? " :\n    " + erreurs.join("\n    ") : ""));
  await contexte.close();
}

// ------------------------------------------------------------ service worker : hors connexion
{
  console.log("\n== hors connexion (service worker)");
  const contexte = await navigateur.newContext({ locale: "fr-FR", viewport: { width: 1200, height: 800 } });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  // Première visite : le Maroc est chargé avant que le service worker ne prenne la main.
  await page.goto(BASE + "#/pays/MA");
  await page.waitForSelector(".regions li");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => (location.hash = "#/pays/TN"));
  await page.waitForSelector(".page-pays h1:has-text('Tunisie')");
  await page.waitForTimeout(500);
  await contexte.setOffline(true);
  await page.reload();
  await page.waitForSelector(".regions li", { timeout: 10000 }).catch(() => null);
  verifier((await page.$$(".regions li")).length === 23, "hors connexion : page Tunisie rechargée depuis le cache");
  await page.evaluate(() => (location.hash = "#/pays/MA"));
  await page.waitForSelector(".page-pays h1:has-text('Maroc')", { timeout: 10000 }).catch(() => null);
  await page.waitForSelector(".regions li", { timeout: 5000 }).catch(() => null);
  const nbMaroc = (await page.$$(".regions li")).length;
  verifier(nbMaroc === 16, `hors connexion : Maroc (vu avant l'activation) disponible (${nbMaroc} régions)`);
  verifier(await page.isVisible("#bandeau-hors-ligne"), "hors connexion : bandeau affiché");
  await page.evaluate(() => (location.hash = "#/outils?p=MA"));
  await page.waitForSelector(".phrases li", { timeout: 10000 }).catch(() => null);
  verifier((await page.$$(".phrases li")).length === 14, "hors connexion : phrases disponibles");
  await page.evaluate(() => (location.hash = "#/autour"));
  await page.evaluate(() => (location.hash = "#/itineraire"));
  await page.waitForSelector(".page-itineraire h1");
  verifier(true, "hors connexion : itinéraire accessible");
  verifier(erreurs.length === 0, "aucune erreur JavaScript" + (erreurs.length ? " : " + erreurs.join(" | ") : ""));
  await contexte.close();
}

await navigateur.close();
serveur.close();
console.log(echecs ? `\n${echecs} vérification(s) en échec` : "\nToutes les vérifications passent.");
process.exit(echecs ? 1 : 0);
