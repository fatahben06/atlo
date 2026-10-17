/* Atlo · tests unitaires des fonctions pures (node --test tests/). */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const O = require("../js/outils.js");
globalThis.self = globalThis;
require("../data/pays.js");
require("../data/sites.js");
require("../data/monde.js");
require("../data/phrases.js");

test("normaliser : accents, apostrophes et arabe", () => {
  assert.equal(O.normaliser("Aït-ben-Haddou"), "ait ben haddou");
  assert.equal(O.normaliser("L’Anse aux Meadows"), "l anse aux meadows");
  assert.equal(O.normaliser("إسطنبول"), O.normaliser("اسطنبول"));
  assert.ok(O.score("petra", O.normaliser("Pétra")) > 0);
});

test("distanceKm : Paris → Alger ≈ 1 345 km", () => {
  const d = O.distanceKm(48.8566, 2.3522, 36.7538, 3.0588);
  assert.ok(Math.abs(d - 1345) < 10, d);
  assert.equal(O.distanceKm(10, 10, 10, 10), 0);
});

test("polylignes : encodage Google relu à l'identique", () => {
  // Exemple de la documentation Google : (38.5,-120.2), (40.7,-120.95), (43.252,-126.453)
  const pts = O.decoderPolyligne("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 1e5);
  assert.deepEqual(pts.map(([lon, lat]) => [+lat.toFixed(3), +lon.toFixed(3)]), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test("point dans un polygone avec trou (règle pair-impair)", () => {
  const exterieur = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const trou = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.equal(O.pointDansAnneaux(2, 2, [exterieur, trou]), true);
  assert.equal(O.pointDansAnneaux(5, 5, [exterieur, trou]), false);
  assert.equal(O.pointDansAnneaux(12, 5, [exterieur, trou]), false);
  const mp = O.multiPolygone([trou, exterieur]);
  assert.equal(mp.length, 1);
  assert.equal(mp[0].length, 2);
  assert.ok(O.aireSignee(mp[0][0]) > 0, "extérieur antihoraire");
  assert.ok(O.aireSignee(mp[0][1]) < 0, "trou horaire");
});

test("Equal Earth : bornes de la projection", () => {
  const [x, y] = O.equalEarth(180, 0);
  assert.ok(Math.abs(x - 2.7066) < 1e-3);
  assert.equal(y, 0);
  assert.ok(Math.abs(O.equalEarth(0, 90)[1] - 1.3173) < 1e-3);
});

test("optimiser : l'ordre trouvé n'est jamais plus long et garde le départ", () => {
  const villes = [
    { nom: "Alger", lat: 36.75, lon: 3.06 }, { nom: "Oran", lat: 35.7, lon: -0.63 }, { nom: "Constantine", lat: 36.36, lon: 6.61 },
    { nom: "Tlemcen", lat: 34.88, lon: -1.32 }, { nom: "Béjaïa", lat: 36.75, lon: 5.08 }, { nom: "Sétif", lat: 36.19, lon: 5.41 },
  ];
  const brouille = [villes[0], villes[2], villes[1], villes[4], villes[3], villes[5]];
  const avant = O.longueur(brouille, brouille.map((_, i) => i));
  const opt = O.optimiser(brouille);
  const apres = O.longueur(opt, opt.map((_, i) => i));
  assert.equal(opt[0].nom, "Alger");
  assert.equal(opt.length, brouille.length);
  assert.ok(apres <= avant + 1e-9, `${apres} > ${avant}`);
  // Comparaison avec l'optimum exact (toutes les permutations, départ fixé).
  const permutations = (l) => (l.length <= 1 ? [l] : l.flatMap((x, i) => permutations([...l.slice(0, i), ...l.slice(i + 1)]).map((p) => [x, ...p])));
  const optimum = Math.min(...permutations(brouille.slice(1)).map((p) => { const o = [brouille[0], ...p]; return O.longueur(o, o.map((_, i) => i)); }));
  assert.ok(Math.abs(apres - optimum) < 1e-6, `optimiseur ${apres.toFixed(1)} km, optimum ${optimum.toFixed(1)} km`);
});

test("planifier : découpage en journées selon le budget horaire", () => {
  const etapes = [
    { id: "a", lat: 36.75, lon: 3.06, duree: 240 },
    { id: "b", lat: 36.76, lon: 3.07, duree: 180 },
    { id: "c", lat: 36.77, lon: 3.08, duree: 120 },
    { id: "d", lat: 36.78, lon: 3.09, duree: 60, nouveauJour: true },
  ];
  const plan = O.planifier(etapes, { mode: "pied", minutesParJour: 480 });
  assert.deepEqual(plan.jours.map((j) => j.etapes.map((p) => p.etape.id)), [["a", "b"], ["c"], ["d"]]);
  assert.equal(plan.jours[0].etapes[0].arrivee, 540, "début à 9 h");
  assert.ok(plan.totalTrajet > 0 && plan.totalVisite === 600);
});

test("dureeTrajet : estimations plausibles", () => {
  assert.equal(O.dureeTrajet(0, "voiture"), 0);
  const algerOran = O.dureeTrajet(O.distanceKm(36.75, 3.06, 35.7, -0.63), "voiture");
  assert.ok(algerOran > 4 * 60 && algerOran < 7 * 60, algerOran);
  assert.ok(O.dureeTrajet(2, "pied") > 25);
});

test("partage d'itinéraire : aller-retour sans perte et entrées bornées", () => {
  const it = { titre: "Tour du Maghreb ✈️", debut: "2026-11-02", mode: "voiture", heuresParJour: 9,
    etapes: [{ ref: "s:timgad", nom: "Timgad", lat: 35.4844, lon: 6.4683, duree: 90, pays: "DZ" }, { ref: "", nom: "Café <x>", lat: 36.8, lon: 10.18, duree: 30, pays: "TN", nouveauJour: true }] };
  const relu = O.decoderItineraire(O.encoderItineraire(it));
  assert.equal(relu.titre, it.titre);
  assert.equal(relu.etapes.length, 2);
  assert.equal(relu.etapes[1].nom, "Café <x>");
  assert.equal(relu.etapes[1].nouveauJour, true);
  const piege = O.decoderItineraire(O.base64url(JSON.stringify({ m: "fusée", h: 99, d: "demain", e: [["", "x", 999, -999, 99999, "ABC"]] })));
  assert.equal(piege.mode, "voiture");
  assert.equal(piege.heuresParJour, 14);
  assert.equal(piege.debut, "");
  assert.deepEqual([piege.etapes[0].lat, piege.etapes[0].lon, piege.etapes[0].duree, piege.etapes[0].pays], [90, -180, 1440, "AB"]);
  assert.throws(() => O.decoderItineraire("pas-du-json"));
});

test("exports GPX et iCalendar", () => {
  const it = { titre: "A & B", debut: "2026-11-02", mode: "voiture", heuresParJour: 8,
    etapes: [{ id: "1", nom: "Casbah <d'Alger>", lat: 36.785, lon: 3.06, duree: 120 }, { id: "2", nom: "Tipaza", lat: 36.592, lon: 2.447, duree: 90 }] };
  const g = O.gpx(it);
  assert.match(g, /<name>Casbah &lt;d&apos;Alger&gt;<\/name>/);
  assert.match(g, /<rtept lat="36.592" lon="2.447">/);
  const plan = O.planifier(it.etapes, { mode: "voiture", minutesParJour: 480 });
  const cal = O.ics(it, plan, new Date("2026-10-09T10:00:00Z"));
  assert.match(cal, /DTSTART:20261102T090000/);
  assert.equal((cal.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(cal, /\r\n/);
  assert.equal(O.ics({ ...it, debut: "" }, plan), "");
});

test("lien Google Maps : départ, arrivée et étapes intermédiaires", () => {
  const e = (lat, lon) => ({ lat, lon });
  const url = new URL(O.lienGoogleItineraire([e(1, 2), e(3, 4), e(5, 6)], "pied"));
  assert.equal(url.searchParams.get("origin"), "1.000000,2.000000");
  assert.equal(url.searchParams.get("destination"), "5.000000,6.000000");
  assert.equal(url.searchParams.get("waypoints"), "3.000000,4.000000");
  assert.equal(url.searchParams.get("travelmode"), "walking");
});

test("climat : moyennes mensuelles et meilleures périodes", () => {
  const dates = [], tmax = [], tmin = [], pluie = [];
  for (const an of [2023, 2024]) for (let m = 1; m <= 12; m++) for (let j = 1; j <= 28; j++) {
    dates.push(`${an}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`);
    const chaud = m >= 5 && m <= 9;
    tmax.push(chaud ? 26 : 12); tmin.push(chaud ? 17 : 4); pluie.push(chaud ? 0.5 : 3);
  }
  const mensuel = O.climatMensuel(dates, tmax, tmin, pluie);
  assert.equal(mensuel[6].max, 26);
  assert.equal(mensuel[0].pluie, 3 * 28);
  const meilleurs = O.meilleursMois(mensuel);
  assert.deepEqual(meilleurs.slice().sort((a, b) => a - b), [4, 5, 6, 7, 8]);
  assert.deepEqual(O.plagesMois(meilleurs), [[4, 8]]);
  assert.deepEqual(O.plagesMois([11, 0, 1, 6]), [[6, 6], [11, 1]]);
});

test("données : cohérence des pays, sites et phrases", () => {
  const codes = new Set(self.ATLO_PAYS.map((p) => p.c));
  assert.equal(codes.size, 250);
  const dz = self.ATLO_PAYS.find((p) => p.c === "DZ");
  assert.equal(dz.t, "+213");
  assert.deepEqual(dz.m, ["DZD"]);
  const ids = new Set();
  for (const s of self.ATLO_SITES) {
    const [id, pays, cat, lat, lon] = s;
    assert.ok(!ids.has(id), "identifiant unique : " + id);
    ids.add(id);
    assert.ok(pays.split(" ").every((c) => codes.has(c)), "pays connu : " + id);
    assert.ok("HRNMVAP".includes(cat), "catégorie : " + id);
    assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, "coordonnées : " + id);
  }
  assert.ok(self.ATLO_SITES.length > 1000);
  assert.ok(Object.keys(self.ATLO_MONDE).length > 170);
  const P = self.ATLO_PHRASES;
  for (const [l, lignes] of Object.entries(P.langues)) {
    assert.equal(lignes.length, P.cles.length, "phrases complètes : " + l);
    assert.ok(P.voix[l], "voix : " + l);
  }
});

test("météo : codes WMO reconnus", () => {
  assert.deepEqual(O.meteoWmo(0, true), ["clair", "☀️"]);
  assert.equal(O.meteoWmo(95)[0], "orage");
  assert.equal(O.meteoWmo(1234)[0], "inconnu");
});

test("séjour : nuits et décalage de dates", () => {
  assert.equal(O.nuits("2026-11-02", "2026-11-05"), 3);
  assert.equal(O.nuits("2026-11-05", "2026-11-02"), 0, "départ avant l'arrivée");
  assert.equal(O.nuits("2026-11-02", ""), 0);
  assert.equal(O.nuits("2026-03-28", "2026-03-30"), 2, "changement d'heure sans effet");
  assert.equal(O.decalerDate("2026-12-31", 1), "2027-01-01");
  assert.equal(O.decalerDate("2026-03-01", -1), "2026-02-28");
});

test("réservation : liens pré-remplis (dates, voyageurs, fiche, affiliation)", () => {
  const sejour = { arrivee: "2026-11-02", depart: "2026-11-05", adultes: 3, chambres: 2 };
  const ville = { requete: "Béjaïa, Algérie", lieu: "Béjaïa, Algérie", expedia: "590", tripadvisor: "1903178", airbnb: "Béjaïa--Algeria" };
  const par = (l) => Object.fromEntries(l.map((x) => [x.id, new URL(x.url)]));
  const v = par(O.liensReservation(ville, sejour, {}, "fr"));
  assert.equal(v.booking.searchParams.get("ss"), "Béjaïa, Algérie");
  assert.equal(v.booking.searchParams.get("checkin"), "2026-11-02");
  assert.equal(v.booking.searchParams.get("checkout"), "2026-11-05");
  assert.equal(v.booking.searchParams.get("group_adults"), "3");
  assert.equal(v.booking.searchParams.get("no_rooms"), "2");
  assert.equal(v.booking.searchParams.get("aid"), null, "aucun identifiant d'affiliation par défaut");
  assert.equal(v.expedia.searchParams.get("regionId"), "590");
  assert.equal(v.expedia.searchParams.get("startDate"), "2026-11-02");
  assert.equal(v.agoda.searchParams.get("checkOut"), "2026-11-05");
  assert.equal(v.airbnb.pathname, "/s/B%C3%A9ja%C3%AFa--Algeria/homes");
  assert.equal(v.airbnb.searchParams.get("adults"), "3");
  assert.equal(v.google.searchParams.get("q"), "Béjaïa, Algérie");
  assert.equal(v.tripadvisor.searchParams.get("geo"), "1903178");

  // Établissement : page Booking connue, pas de région Expedia (recherche par nom).
  const hotel = par(O.liensReservation({ requete: "Hôtel X, Béjaïa", lieu: "Béjaïa, Algérie", expedia: "590",
    ficheBooking: "https://www.booking.com/hotel/dz/hotel-x.fr.html?aid=999" }, sejour, { booking: "123" }, "en"));
  assert.equal(hotel.booking.pathname, "/hotel/dz/hotel-x.fr.html");
  assert.equal(hotel.booking.searchParams.get("ss"), null);
  assert.equal(hotel.booking.searchParams.get("aid"), "123", "identifiant d'affiliation repris, l'ancien est retiré");
  assert.equal(hotel.expedia.searchParams.get("regionId"), null);

  // Dates invalides : liens sans dates. Fiche Booking douteuse : ignorée.
  const sans = par(O.liensReservation({ requete: "X", ficheBooking: "https://evil.example/hotel/" }, { arrivee: "2026-11-05", depart: "2026-11-02" }));
  assert.equal(sans.booking.searchParams.get("checkin"), null);
  assert.equal(sans.booking.hostname, "www.booking.com");
  assert.equal(sans.booking.pathname, "/searchresults.html");

  // Enveloppe de suivi (ex. Travelpayouts) : adresse d'origine encodée en fin de lien.
  const env = O.liensReservation(ville, sejour, { enveloppes: { agoda: "https://tp.media/r?marker=1&u=" } }).find((l) => l.id === "agoda");
  assert.ok(env.url.startsWith("https://tp.media/r?marker=1&u=https%3A%2F%2Fwww.agoda.com%2Fsearch"));
});

test("OpenStreetMap : hébergements lus depuis Overpass", () => {
  const l = O.depuisOverpass({ elements: [
    { type: "node", id: 1, lat: 36.75, lon: 5.08, tags: { tourism: "hotel", name: "Hôtel A", stars: "4", website: "a.example", "contact:facebook": "hotela" } },
    { type: "way", id: 2, center: { lat: 36.7, lon: 5.1 }, tags: { tourism: "guest_house", "name:fr": "Maison B", name: "دار ب", "addr:city": "Tichy" } },
    { type: "node", id: 3, lat: 36.7, lon: 5.1, tags: { tourism: "hotel" } },
    { type: "node", id: 4, lat: 36.7, lon: 5.1, tags: { tourism: "museum", name: "Musée" } },
    { type: "relation", id: 5, tags: { tourism: "camp_site", name: "Camping C" } },
  ] });
  assert.equal(l.length, 2, "sans nom, hors hébergement ou sans position : ignorés");
  assert.deepEqual([l[0].id, l[0].type, l[0].etoiles, l[0].site, l[0].fb], ["osm:n1", "hotel", 4, "https://a.example", "https://www.facebook.com/hotela"]);
  assert.deepEqual([l[1].id, l[1].n, l[1].nomLocal, l[1].lieu, l[1].ll], ["osm:w2", "Maison B", "دار ب", "Tichy", [36.7, 5.1]]);
});

test("hébergements : fusion de la sélection et d'OpenStreetMap sans doublon", () => {
  assert.ok(O.ressemblanceNoms("Hôtel de l'Étoile", "Hotel de l Etoile") > 0.9);
  assert.ok(O.ressemblanceNoms("Hôtel Royal", "Hôtel Zéphyr") === 0);
  assert.ok(O.ressemblanceNoms("Atlantis Béjaïa Aéroport", "Hotel Atlantis") >= 0.6);
  const selection = [
    { id: "etoile", n: "Hôtel de l'Étoile", type: "hotel", lieu: "Béjaïa" },
    { id: "lac", n: "Hôtel du Lac", type: "hotel", ll: [36.75, 5.07] },
  ];
  const osm = [
    { id: "osm:n1", n: "Hotel de l'Etoile", type: "hotel", ll: [36.7536, 5.0871], tel: "+213 1", source: "osm" },
    { id: "osm:n2", n: "Hôtel du Lac", type: "hotel", ll: [36.1, 4.5], source: "osm" },
    { id: "osm:n3", n: "Hôtel Zéphyr", type: "hotel", ll: [36.74, 5.06], source: "osm" },
  ];
  const f = O.fusionnerHebergements(selection, osm);
  assert.deepEqual(f.map((x) => x.id), ["etoile", "lac", "osm:n2", "osm:n3"], "homonyme à 70 km : établissement distinct");
  assert.deepEqual(f[0].ll, [36.7536, 5.0871]);
  assert.equal(f[0].llSource, "osm");
  assert.equal(f[0].tel, "+213 1");
  assert.equal(selection[0].ll, undefined, "la sélection d'origine n'est pas modifiée");
});

test("hébergements : sans position, pas de rapprochement sur un seul mot ni sur le nom du lieu", () => {
  const selection = [
    { id: "nord", n: "Hôtel du Nord", type: "hotel", lieu: "Béjaïa" },
    { id: "raya", n: "Raya Tichy", type: "hotel", lieu: "Tichy" },
    { id: "ham", n: "Les Hammadites", type: "hotel", lieu: "Tichy" },
  ];
  const osm = [
    { id: "osm:n1", n: "Résidence Nord Plage", type: "hotel", ll: [36.63, 5.25], lieu: "Aokas", source: "osm" },
    { id: "osm:n2", n: "Hôtel Tichy", type: "hotel", ll: [36.667, 5.16], source: "osm" },
    { id: "osm:n5", n: "Hôtel Les Hammadites", type: "hotel", ll: [36.66, 5.15], source: "osm" },
    { id: "osm:n3", n: "Hôtel X", type: "hotel", ll: [36.7, 5.1], source: "osm" },
    { id: "osm:w4", n: "Hôtel X", type: "hotel", ll: [36.7001, 5.1001], tel: "+213 2", source: "osm" },
  ];
  const f = O.fusionnerHebergements(selection, osm);
  assert.equal(f.find((x) => x.id === "nord").osm, undefined, "« Nord Plage » à Aokas n'est pas l'Hôtel du Nord");
  assert.equal(f.find((x) => x.id === "raya").osm, undefined, "« Tichy » est le lieu, pas le nom");
  assert.equal(f.find((x) => x.id === "ham").osm, "osm:n5", "mêmes mots distinctifs");
  const x = f.filter((y) => y.n === "Hôtel X");
  assert.deepEqual(x.map((y) => y.id), ["osm:w4"], "point et bâtiment du même hôtel : un seul, le plus renseigné");
});

test("OpenStreetMap : Facebook et téléphones multiples", () => {
  const [a] = O.depuisOverpass({ elements: [{ type: "node", id: 1, lat: 1, lon: 2, tags: {
    tourism: "hotel", name: "A", "contact:facebook": "www.facebook.com/HotelA", phone: "+213 34 11 22 33;+213 555 12 34 56" } }] });
  assert.equal(a.fb, "https://www.facebook.com/HotelA");
  assert.equal(a.tel, "+213 34 11 22 33");
});

test("guides : données valides et index à jour", async () => {
  const G = await import("../outils/construire_guides.mjs");
  const guides = G.lireGuides();
  assert.ok(guides.length >= 1);
  for (const g of guides) {
    const { erreurs } = G.verifierGuide(g);
    assert.deepEqual(erreurs, [], "guide " + g.id);
  }
  const fs = await import("node:fs");
  const actuel = fs.readFileSync(new URL("../data/guides.js", import.meta.url), "utf8");
  assert.equal(actuel, G.genererIndex(guides), "data/guides.js à régénérer : node outils/construire_guides.mjs");
  const bejaia = guides.find((g) => g.id === "bejaia");
  assert.equal(bejaia.sites.length, 20, "top 20");
  assert.ok(bejaia.itineraires.every((it) => it.jours.every((j) => j.e.length)));
  const index = G.entreeIndex(bejaia);
  assert.match(index.v, /^[0-9a-f]{10}$/, "empreinte du fichier dans l'index");
  assert.equal(index.sites[0].length, 5, "noms fr, en, es, ar pour la recherche");
  assert.equal(index.sites[0][3], bejaia.sites[0].n.es);
  const long = { ...bejaia, itineraires: [{ id: "x", t: bejaia.itineraires[0].t, r: bejaia.itineraires[0].r,
    jours: [{ e: bejaia.sites.map((s) => s.id) }] }] };
  assert.ok(G.verifierGuide(long).erreurs.some((e) => /12 h au plus/.test(e)), "journée trop longue refusée");
});
