/* Atlo · fonctions pures (géométrie, itinéraire, formats, exports).
   Aucune dépendance au DOM : testées dans tests/test_outils.mjs. */
(function (racine) {
  "use strict";

  const RAYON_TERRE = 6371.0088;
  const rad = (d) => (d * Math.PI) / 180;

  /** Texte comparable : minuscules, sans accents, sans signes diacritiques arabes. */
  function normaliser(texte) {
    return String(texte || "")
      .normalize("NFD")
      .replace(/[̀-ًͯ-ٰٟ]/g, "")
      .replace(/[إأآٱ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .toLowerCase()
      .replace(/[’'`´\-_.,/()]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Score de correspondance (0 = aucune) entre une requête et un libellé normalisé. */
  function score(requete, cible) {
    if (!requete || !cible) return 0;
    if (cible === requete) return 100;
    if (cible.startsWith(requete)) return 80;
    if (cible.includes(" " + requete)) return 60;
    if (cible.includes(requete)) return 40;
    const mots = requete.split(" ");
    return mots.length > 1 && mots.every((m) => cible.includes(m)) ? 30 : 0;
  }

  /** Distance orthodromique en km. */
  function distanceKm(lat1, lon1, lat2, lon2) {
    const a =
      Math.sin(rad(lat2 - lat1) / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    return 2 * RAYON_TERRE * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Cap initial (degrés, 0 = nord) pour une boussole simple. */
  function cap(lat1, lon1, lat2, lon2) {
    const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
    const x =
      Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
      Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  /** Décode une polyligne (algorithme Google) en [[lon, lat], ...]. */
  function decoderPolyligne(texte, facteur) {
    const points = [];
    let i = 0, lat = 0, lon = 0;
    while (i < texte.length) {
      for (const champ of [0, 1]) {
        let resultat = 0, decalage = 0, octet;
        do {
          octet = texte.charCodeAt(i++) - 63;
          resultat |= (octet & 0x1f) << decalage;
          decalage += 5;
        } while (octet >= 0x20);
        const delta = resultat & 1 ? ~(resultat >> 1) : resultat >> 1;
        if (champ === 0) lat += delta; else lon += delta;
      }
      points.push([lon / facteur, lat / facteur]);
    }
    return points;
  }

  function anneaux(texte, facteur) {
    return texte ? texte.split(" ").filter(Boolean).map((t) => decoderPolyligne(t, facteur)) : [];
  }

  /** Point dans un ensemble d'anneaux (règle pair-impair : gère trous et îles). */
  function pointDansAnneaux(lon, lat, liste) {
    let dedans = false;
    for (const anneau of liste) {
      for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
        const [xi, yi] = anneau[i], [xj, yj] = anneau[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dedans = !dedans;
      }
    }
    return dedans;
  }

  function aireSignee(anneau) {
    let s = 0;
    for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
      s += (anneau[j][0] - anneau[i][0]) * (anneau[j][1] + anneau[i][1]);
    }
    return s / 2; // > 0 : sens antihoraire
  }

  /** Regroupe des anneaux en MultiPolygon GeoJSON : un anneau qui tombe dans le précédent est un trou. */
  function multiPolygone(liste) {
    const polygones = [];
    const tries = liste.slice().sort((a, b) => Math.abs(aireSignee(b)) - Math.abs(aireSignee(a)));
    for (const anneau of tries) {
      const parent = polygones.find((p) => pointDansAnneaux(anneau[0][0], anneau[0][1], [p[0]]));
      if (parent) parent.push(anneau);
      else polygones.push([anneau]);
    }
    // Sens imposé par GeoJSON (et par MapLibre pour reconnaître les trous) :
    // contour extérieur antihoraire, trous horaires.
    return polygones.map((p) => p.map((a, i) => ((aireSignee(a) > 0) === (i === 0) ? a : a.slice().reverse())));
  }

  /** Projection Equal Earth (x ∈ ±2.7066, y ∈ ±1.3173). */
  function equalEarth(lon, lat) {
    const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
    const l = Math.asin(M * Math.sin(rad(lat)));
    const l2 = l * l, l6 = l2 * l2 * l2;
    const x = (rad(lon) * Math.cos(l)) / (M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2)));
    const y = l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2));
    return [x, y];
  }

  // ------------------------------------------------------------ itinéraire
  /** Paramètres de trajet par mode : vitesse moyenne (km/h) et détour par rapport au vol d'oiseau. */
  const MODES = {
    voiture: { vitesse: 70, urbain: 30, detour: 1.3 },
    transport: { vitesse: 45, urbain: 20, detour: 1.35 },
    velo: { vitesse: 15, urbain: 14, detour: 1.25 },
    pied: { vitesse: 4.5, urbain: 4.5, detour: 1.25 },
  };

  /** Estimation (minutes) d'un trajet entre deux points, par la route. */
  function dureeTrajet(km, mode) {
    const m = MODES[mode] || MODES.voiture;
    const route = km * m.detour;
    if (route <= 0.05) return 0;
    // Les premiers 15 km se font à vitesse urbaine (sorties de ville, bouchons).
    const urbain = Math.min(route, 15);
    const reste = route - urbain;
    return Math.round((urbain / m.urbain + reste / m.vitesse) * 60);
  }

  /** Longueur totale (km, à vol d'oiseau) d'un ordre de visite. */
  function longueur(etapes, ordre) {
    let total = 0;
    for (let i = 1; i < ordre.length; i++) {
      const a = etapes[ordre[i - 1]], b = etapes[ordre[i]];
      total += distanceKm(a.lat, a.lon, b.lat, b.lon);
    }
    return total;
  }

  /**
   * Ordre de visite le plus court : plus proche voisin depuis la première étape,
   * puis amélioration 2-opt. La première étape reste en tête (point de départ).
   */
  function optimiser(etapes, { garderFin = false } = {}) {
    const n = etapes.length;
    if (n < 3) return etapes.slice();
    const reste = new Set(etapes.map((_, i) => i));
    const ordre = [0];
    reste.delete(0);
    const fin = garderFin ? n - 1 : -1;
    if (garderFin) reste.delete(fin);
    while (reste.size) {
      const d = etapes[ordre[ordre.length - 1]];
      let meilleur = -1, dmin = Infinity;
      for (const i of reste) {
        const k = distanceKm(d.lat, d.lon, etapes[i].lat, etapes[i].lon);
        if (k < dmin) { dmin = k; meilleur = i; }
      }
      ordre.push(meilleur);
      reste.delete(meilleur);
    }
    if (garderFin) ordre.push(fin);
    const dist = (i, j) => distanceKm(etapes[ordre[i]].lat, etapes[ordre[i]].lon, etapes[ordre[j]].lat, etapes[ordre[j]].lon);
    const derniere = garderFin ? n - 2 : n - 1;
    let ameliore = true, tours = 0;
    while (ameliore && tours++ < 60) {
      ameliore = false;
      for (let i = 1; i < derniere; i++) {
        for (let j = i + 1; j <= derniere; j++) {
          const avant = dist(i - 1, i) + (j + 1 < n ? dist(j, j + 1) : 0);
          const apres = dist(i - 1, j) + (j + 1 < n ? dist(i, j + 1) : 0);
          if (apres + 1e-9 < avant) {
            ordre.splice(i, j - i + 1, ...ordre.slice(i, j + 1).reverse());
            ameliore = true;
          }
        }
      }
    }
    return ordre.map((i) => etapes[i]);
  }

  /**
   * Répartit les étapes en journées : trajets estimés + durées de visite,
   * sans dépasser le budget quotidien (une étape seule peut le dépasser).
   */
  function planifier(etapes, { mode = "voiture", minutesParJour = 480, debutJour = 540 } = {}) {
    const jours = [];
    let jour = null, precedente = null;
    let totalKm = 0, totalTrajet = 0, totalVisite = 0;
    for (const etape of etapes) {
      const km = precedente ? distanceKm(precedente.lat, precedente.lon, etape.lat, etape.lon) : 0;
      const trajet = precedente ? dureeTrajet(km, mode) : 0;
      const visite = Math.max(0, Number(etape.duree) || 0);
      const nouvelleJournee =
        !jour || etape.nouveauJour || (jour.etapes.length && jour.minutes + trajet + visite > minutesParJour);
      if (nouvelleJournee) {
        jour = { numero: jours.length + 1, etapes: [], minutes: 0, km: 0 };
        jours.push(jour);
      }
      const arrivee = debutJour + jour.minutes + (jour.etapes.length ? trajet : 0);
      jour.etapes.push({ etape, km, trajet, arrivee, depart: arrivee + visite, long: trajet > minutesParJour * 0.6 });
      jour.minutes += (jour.etapes.length > 1 ? trajet : 0) + visite;
      jour.km += jour.etapes.length > 1 ? km : 0;
      totalKm += km;
      totalTrajet += trajet;
      totalVisite += visite;
      precedente = etape;
    }
    return { jours, totalKm, totalTrajet, totalVisite };
  }

  // ------------------------------------------------------------ formats
  function heureMinutes(minutes) {
    const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  }

  function base64url(texte) {
    const octets = new TextEncoder().encode(texte);
    let binaire = "";
    octets.forEach((o) => (binaire += String.fromCharCode(o)));
    return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function depuisBase64url(texte) {
    const b = texte.replace(/-/g, "+").replace(/_/g, "/");
    const binaire = atob(b + "===".slice((b.length + 3) % 4));
    return new TextDecoder().decode(Uint8Array.from(binaire, (c) => c.charCodeAt(0)));
  }

  /** Itinéraire → texte compact pour une URL de partage. */
  function encoderItineraire(it) {
    const compact = {
      t: it.titre || "",
      d: it.debut || "",
      m: it.mode,
      h: it.heuresParJour,
      e: it.etapes.map((e) => [e.ref || "", e.nom, +(+e.lat).toFixed(5), +(+e.lon).toFixed(5), e.duree, e.pays || "", e.nouveauJour ? 1 : 0]),
    };
    return base64url(JSON.stringify(compact));
  }

  function decoderItineraire(texte) {
    const c = JSON.parse(depuisBase64url(texte));
    if (!c || !Array.isArray(c.e)) throw new Error("itinéraire illisible");
    return {
      titre: String(c.t || "").slice(0, 120),
      debut: /^\d{4}-\d{2}-\d{2}$/.test(c.d) ? c.d : "",
      mode: MODES[c.m] ? c.m : "voiture",
      heuresParJour: Math.min(14, Math.max(2, Number(c.h) || 8)),
      etapes: c.e.slice(0, 200).map((e, i) => ({
        id: "p" + i + "-" + Math.random().toString(36).slice(2, 7),
        ref: String(e[0] || ""),
        nom: String(e[1] || "").slice(0, 160),
        lat: Math.max(-90, Math.min(90, Number(e[2]) || 0)),
        lon: Math.max(-180, Math.min(180, Number(e[3]) || 0)),
        duree: Math.max(0, Math.min(1440, Number(e[4]) || 0)),
        pays: String(e[5] || "").slice(0, 2),
        nouveauJour: !!e[6],
      })),
    };
  }

  function echapperXml(t) {
    return String(t).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
  }

  /** Fichier GPX (points de passage + route) lisible par Organic Maps, OsmAnd, Garmin… */
  function gpx(it) {
    const pts = it.etapes
      .map((e) => `  <wpt lat="${e.lat}" lon="${e.lon}"><name>${echapperXml(e.nom)}</name></wpt>`)
      .join("\n");
    const rte = it.etapes
      .map((e) => `    <rtept lat="${e.lat}" lon="${e.lon}"><name>${echapperXml(e.nom)}</name></rtept>`)
      .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Atlo" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${echapperXml(it.titre || "Atlo")}</name></metadata>
${pts}
  <rte><name>${echapperXml(it.titre || "Atlo")}</name>
${rte}
  </rte>
</gpx>
`;
  }

  /** Agenda iCalendar : un événement par étape, aux heures estimées. */
  function ics(it, plan, maintenant = new Date()) {
    if (!it.debut) return "";
    const [a, m, j] = it.debut.split("-").map(Number);
    const ligne = (t) => t.replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
    const date = (jour, minutes) => {
      const d = new Date(Date.UTC(a, m - 1, j + jour - 1, 0, 0));
      d.setUTCMinutes(minutes);
      return d.toISOString().slice(0, 16).replace(/[-:]/g, "") + "00";
    };
    const stamp = maintenant.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const evts = [];
    plan.jours.forEach((jour) =>
      jour.etapes.forEach((p, k) => {
        evts.push(
          [
            "BEGIN:VEVENT",
            `UID:atlo-${jour.numero}-${k}-${p.etape.id}@atlo`,
            `DTSTAMP:${stamp}`,
            `DTSTART:${date(jour.numero, p.arrivee)}`,
            `DTEND:${date(jour.numero, Math.max(p.depart, p.arrivee + 15))}`,
            `SUMMARY:${ligne(p.etape.nom)}`,
            `GEO:${p.etape.lat};${p.etape.lon}`,
            `LOCATION:${p.etape.lat}\\, ${p.etape.lon}`,
            "END:VEVENT",
          ].join("\r\n")
        );
      })
    );
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Atlo//FR", "CALSCALE:GREGORIAN", ...evts, "END:VCALENDAR", ""].join("\r\n");
  }

  /** Lien Google Maps (itinéraire avec au plus 9 étapes intermédiaires). */
  function lienGoogleItineraire(etapes, mode) {
    if (!etapes.length) return "";
    const ll = (e) => `${(+e.lat).toFixed(6)},${(+e.lon).toFixed(6)}`;
    const modes = { voiture: "driving", transport: "transit", velo: "bicycling", pied: "walking" };
    const p = new URLSearchParams({ api: "1", travelmode: modes[mode] || "driving" });
    if (etapes.length === 1) {
      p.set("destination", ll(etapes[0]));
    } else {
      p.set("origin", ll(etapes[0]));
      p.set("destination", ll(etapes[etapes.length - 1]));
      const milieu = etapes.slice(1, -1).slice(0, 9);
      if (milieu.length) p.set("waypoints", milieu.map(ll).join("|"));
    }
    return "https://www.google.com/maps/dir/?" + p.toString();
  }

  // ------------------------------------------------------------ climat
  /** Moyennes mensuelles à partir de séries journalières (plusieurs années). */
  function climatMensuel(dates, tmax, tmin, pluie) {
    const mois = Array.from({ length: 12 }, () => ({ max: 0, min: 0, pluie: 0, n: 0, annees: new Set() }));
    dates.forEach((d, i) => {
      if (tmax[i] == null || tmin[i] == null) return;
      const m = Number(d.slice(5, 7)) - 1;
      const o = mois[m];
      o.max += tmax[i];
      o.min += tmin[i];
      o.pluie += pluie[i] || 0;
      o.n++;
      o.annees.add(d.slice(0, 4));
    });
    return mois.map((o) =>
      o.n
        ? {
            max: o.max / o.n,
            min: o.min / o.n,
            pluie: o.pluie / o.annees.size, // cumul mensuel moyen (mm)
          }
        : null
    );
  }

  /**
   * Mois les plus agréables pour un visiteur : maximales entre 18 et 30 °C
   * et peu de pluie. Renvoie les indices (0 = janvier), du meilleur au moins bon.
   */
  function meilleursMois(mensuel) {
    const notes = mensuel.map((m, i) => {
      if (!m) return { i, note: -Infinity };
      const ideal = 24;
      const chaleur = Math.max(0, Math.abs(m.max - ideal) - 4);
      const froidNuit = Math.max(0, 8 - m.min);
      const pluie = Math.max(0, m.pluie - 40) / 12;
      return { i, note: 10 - chaleur * 0.9 - froidNuit * 0.35 - pluie };
    });
    const max = Math.max(...notes.map((n) => n.note));
    return notes.filter((n) => n.note >= max - 1.5 && n.note > 4).sort((a, b) => b.note - a.note).map((n) => n.i);
  }

  /** Regroupe des mois (indices) en plages consécutives, en tenant compte de décembre → janvier. */
  function plagesMois(indices) {
    const set = new Set(indices);
    if (!set.size) return [];
    if (set.size === 12) return [[0, 11]];
    let depart = 0;
    while (set.has(depart) && set.has((depart + 11) % 12)) depart = (depart + 1) % 12;
    const plages = [];
    for (let k = 0; k < 12; k++) {
      const m = (depart + k) % 12;
      if (!set.has(m)) continue;
      const derniere = plages[plages.length - 1];
      if (derniere && (derniere[1] + 1) % 12 === m) derniere[1] = m;
      else plages.push([m, m]);
    }
    return plages;
  }

  /** Code météo WMO → [clé de libellé, icône]. */
  function meteoWmo(code, jour = true) {
    const t = [
      [[0], "clair", jour ? "☀️" : "🌙"],
      [[1], "peuNuageux", jour ? "🌤️" : "🌙"],
      [[2], "partiel", "⛅"],
      [[3], "couvert", "☁️"],
      [[45, 48], "brouillard", "🌫️"],
      [[51, 53, 55, 56, 57], "bruine", "🌦️"],
      [[61, 63, 65, 66, 67, 80, 81, 82], "pluie", "🌧️"],
      [[71, 73, 75, 77, 85, 86], "neige", "🌨️"],
      [[95, 96, 99], "orage", "⛈️"],
    ];
    const r = t.find(([codes]) => codes.includes(code));
    return r ? [r[1], r[2]] : ["inconnu", "🌡️"];
  }

  const API = {
    normaliser, score, distanceKm, cap, decoderPolyligne, anneaux, pointDansAnneaux, aireSignee,
    multiPolygone, equalEarth, MODES, dureeTrajet, longueur, optimiser, planifier, heureMinutes,
    base64url, depuisBase64url, encoderItineraire, decoderItineraire, gpx, ics, lienGoogleItineraire,
    climatMensuel, meilleursMois, plagesMois, meteoWmo,
  };
  racine.AtloOutils = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof self !== "undefined" ? self : globalThis);
