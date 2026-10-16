/* Atlo · vérifie les guides de ville (data/guides/<id>.js) et en tire l'index data/guides.js.
   Usage : node outils/construire_guides.mjs [--verifier]
     --verifier : contrôle seulement que l'index est à jour (code de sortie 1 sinon).
   Un guide qui contient « brouillon » est signalé : il reste visible, avec un bandeau d'avertissement. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const O = require(path.join(RACINE, "js/outils.js"));

const LANGUES = ["fr", "en", "es", "ar"];
const CATEGORIES = new Set(["H", "R", "N", "M", "V", "A", "P", "B"]);
const TYPES = new Set(["hotel", "motel", "hostel", "guest_house", "apartment", "resort", "camping", "other"]);

/** Charge un fichier de données « self.xxx && xxx({...}) » dans un bac à sable. */
function charger(fichier, fonction) {
  let capture = null;
  const bac = { self: null };
  bac.self = bac;
  bac[fonction] = (...args) => { capture = args; };
  vm.runInNewContext(fs.readFileSync(fichier, "utf8"), bac, { filename: fichier });
  return capture;
}

/** Régions du pays (contours) pour contrôler les positions. */
function regionsPays(code) {
  const r = charger(path.join(RACINE, "data/pays", code + ".js"), "atloDonnees");
  return r ? r[1].r : [];
}

/** Liste des problèmes d'un guide (vide = valide). Les avertissements ne bloquent pas. */
export function verifierGuide(g) {
  const erreurs = [], avertissements = [];
  const texte = (v, ou, { toutes = true } = {}) => {
    if (!v || typeof v !== "object") { erreurs.push(`${ou} : texte manquant`); return; }
    for (const l of toutes ? LANGUES : ["fr", "en"]) if (!v[l] || !String(v[l]).trim()) erreurs.push(`${ou} : langue « ${l} » manquante`);
  };
  const position = (ll, ou) => {
    if (!Array.isArray(ll) || ll.length !== 2 || !ll.every(Number.isFinite) || Math.abs(ll[0]) > 90 || Math.abs(ll[1]) > 180) {
      erreurs.push(`${ou} : position invalide`);
      return false;
    }
    return true;
  };
  for (const k of ["id", "pays", "fuseau", "maj"]) if (!g[k]) erreurs.push(`champ « ${k} » manquant`);
  if (!/^[a-z0-9-]+$/.test(g.id || "")) erreurs.push("id invalide");
  texte(g.nom, "nom"); texte(g.accroche, "accroche"); texte(g.intro, "intro");
  position(g.centre, "centre");
  if (!Array.isArray(g.sites) || !g.sites.length) erreurs.push("aucun site");
  if (!Array.isArray(g.hebergements)) erreurs.push("hébergements manquants");
  if (!Array.isArray(g.itineraires)) erreurs.push("itinéraires manquants");
  if (g.erreurs) return { erreurs: erreurs.concat(g.erreurs), avertissements };

  const regions = g.region != null ? regionsPays(g.pays) : [];
  const region = regions[g.region];
  const anneaux = region ? O.anneaux(region[4], 1000) : null;
  const bb = region ? region[3] : null;
  const ids = new Set();
  g.sites.forEach((s, i) => {
    const ou = `site ${i + 1} (${s.id})`;
    if (!/^[a-z0-9-]+$/.test(s.id || "")) erreurs.push(`${ou} : id invalide`);
    if (ids.has(s.id)) erreurs.push(`${ou} : id en double`);
    ids.add(s.id);
    if (!CATEGORIES.has(s.cat)) erreurs.push(`${ou} : catégorie « ${s.cat} » inconnue`);
    texte(s.n, ou + " nom"); texte(s.d, ou + " description");
    for (const k of ["conseil", "moment", "entree", "alerte"]) if (s[k]) texte(s[k], `${ou} ${k}`);
    if (!s.lieu) erreurs.push(`${ou} : lieu manquant`);
    if (!(s.duree > 0 && s.duree <= 600)) erreurs.push(`${ou} : durée de visite invalide`);
    if (position(s.ll, ou) && anneaux) {
      const [lat, lon] = s.ll;
      const dedans = O.pointDansAnneaux(lon, lat, anneaux);
      const marge = 0.03; // ≈ 3 km : contours simplifiés, sites sur le littoral
      const proche = lat >= bb[1] - marge && lat <= bb[3] + marge && lon >= bb[0] - marge && lon <= bb[2] + marge;
      if (!proche) erreurs.push(`${ou} : hors de la région (${lat}, ${lon})`);
      else if (!dedans) avertissements.push(`${ou} : en limite de la région (littoral ?)`);
    }
    if (s.aVerifier) avertissements.push(`${ou} : à vérifier`);
  });
  const idsH = new Set();
  g.hebergements.forEach((x, i) => {
    const ou = `hébergement ${i + 1} (${x.id})`;
    if (!/^[a-z0-9-]+$/.test(x.id || "")) erreurs.push(`${ou} : id invalide`);
    if (idsH.has(x.id)) erreurs.push(`${ou} : id en double`);
    idsH.add(x.id);
    if (!x.n) erreurs.push(`${ou} : nom manquant`);
    if (!TYPES.has(x.type)) erreurs.push(`${ou} : type « ${x.type} » inconnu`);
    if (x.etoiles != null && !(Number.isInteger(x.etoiles) && x.etoiles >= 1 && x.etoiles <= 5)) erreurs.push(`${ou} : étoiles invalides`);
    if (x.ll) position(x.ll, ou);
    for (const k of ["site", "fb", "booking"]) if (x[k] && !/^https?:\/\/[^\s]+$/.test(x[k])) erreurs.push(`${ou} : adresse « ${k} » invalide`);
    if (x.booking && !/^https:\/\/www\.booking\.com\/hotel\//.test(x.booking)) erreurs.push(`${ou} : lien Booking.com inattendu`);
    if (x.tel && !/^\+?[\d ()-]{6,}$/.test(x.tel)) erreurs.push(`${ou} : téléphone invalide`);
    if (x.note) texte(x.note, ou + " note");
    if (x.aVerifier) avertissements.push(`${ou} : à vérifier`);
  });
  g.itineraires.forEach((it, i) => {
    const ou = `itinéraire ${i + 1} (${it.id})`;
    texte(it.t, ou + " titre"); texte(it.r, ou + " résumé");
    if (!it.jours || !it.jours.length) erreurs.push(`${ou} : aucun jour`);
    (it.jours || []).forEach((j, k) => {
      if (j.t) texte(j.t, `${ou} jour ${k + 1}`);
      if (!j.e || !j.e.length) erreurs.push(`${ou} jour ${k + 1} : aucune étape`);
      for (const id of j.e || []) if (!ids.has(id)) erreurs.push(`${ou} jour ${k + 1} : site « ${id} » inconnu`);
    });
  });
  const p = g.pratique || {};
  for (const cle of ["venir", "bouger", "conseils", "cuisine", "evenements"]) {
    (p[cle] || []).forEach((x, i) => { texte(x.t || x.d, `pratique.${cle} ${i + 1}`); if (x.n) texte(x.n, `pratique.${cle} ${i + 1} nom`); });
  }
  (p.lieux || []).forEach((l, i) => {
    texte(l.n, `pratique.lieux ${i + 1}`);
    if (l.ll) position(l.ll, `pratique.lieux ${i + 1}`);
    if (l.aVerifier) avertissements.push(`pratique.lieux ${i + 1} (${l.id}) : à vérifier`);
  });
  if (g.histoire) texte(g.histoire, "histoire");
  if (g.brouillon) avertissements.unshift("BROUILLON : " + g.brouillon);
  return { erreurs, avertissements };
}

/** Entrée d'index (chargée au démarrage : nom, chiffres, noms des sites pour la recherche). */
export function entreeIndex(g) {
  const e = {
    id: g.id, pays: g.pays, region: g.region ?? null, nom: g.nom, alt: g.alt || [], accroche: g.accroche,
    ll: g.centre, image: g.image || null,
    nb: { sites: g.sites.length, hebergements: g.hebergements.length, itineraires: g.itineraires.length },
    sites: g.sites.map((s) => [s.id, s.n.fr, s.n.en, s.n.ar]),
  };
  if (g.brouillon) e.brouillon = true;
  return e;
}

export function lireGuides() {
  const dossier = path.join(RACINE, "data/guides");
  return fs.readdirSync(dossier).filter((f) => f.endsWith(".js")).sort().map((f) => {
    const r = charger(path.join(dossier, f), "atloGuide");
    if (!r) return { id: f.replace(/\.js$/, ""), erreurs: ["fichier sans appel atloGuide(...)"] };
    return r[0];
  });
}

export function genererIndex(guides) {
  return "/* Atlo · index des guides de ville. Fichier généré par outils/construire_guides.mjs : ne pas modifier. */\n" +
    "self.ATLO_GUIDES = " + JSON.stringify(guides.map(entreeIndex)) + ";\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const guides = lireGuides();
  let ko = false;
  for (const g of guides) {
    const { erreurs, avertissements } = verifierGuide(g);
    console.log(`\n== ${g.id} : ${g.sites ? g.sites.length : 0} sites, ${g.hebergements ? g.hebergements.length : 0} hébergements`);
    erreurs.forEach((e) => console.log("  ✗ " + e));
    if (avertissements.length) console.log(`  ⚠ ${avertissements.length} avertissement(s)` + (process.argv.includes("--detail") ? "" : " (--detail pour la liste)"));
    if (process.argv.includes("--detail")) avertissements.forEach((a) => console.log("  ⚠ " + a));
    if (erreurs.length) ko = true;
  }
  if (ko) { console.log("\nIndex non écrit : corrigez les erreurs."); process.exit(1); }
  const sortie = path.join(RACINE, "data/guides.js");
  const contenu = genererIndex(guides);
  if (process.argv.includes("--verifier")) {
    const actuel = fs.existsSync(sortie) ? fs.readFileSync(sortie, "utf8") : "";
    if (actuel !== contenu) { console.log("\ndata/guides.js n'est pas à jour : lancez node outils/construire_guides.mjs"); process.exit(1); }
    console.log("\nIndex à jour.");
  } else {
    fs.writeFileSync(sortie, contenu);
    console.log(`\nÉcrit : data/guides.js (${contenu.length} octets)`);
  }
}
