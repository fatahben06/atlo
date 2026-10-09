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
