/* Atlo · noyau : création d'éléments, préférences, données, formats, routeur, panneau carte. */
(function () {
  "use strict";
  const O = window.AtloOutils;
  const I = window.AtloI18n;
  const A = (window.Atlo = { O, I, S: window.AtloServices });

  // ---------------------------------------------------------------- éléments
  /** h("button", {class: "x", onclick}, "texte", enfant…) : jamais d'HTML injecté. */
  function h(tag, props, ...enfants) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "class") el.className = v;
        else if (k === "dataset") Object.assign(el.dataset, v);
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k === "html") throw new Error("html interdit");
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      }
    }
    ajouter(el, enfants);
    return el;
  }
  function ajouter(el, enfants) {
    for (const e of enfants) {
      if (e == null || e === false) continue;
      if (Array.isArray(e)) ajouter(el, e);
      else el.appendChild(e instanceof Node ? e : document.createTextNode(String(e)));
    }
    return el;
  }
  A.h = h;
  A.vider = (el, ...enfants) => { el.textContent = ""; return ajouter(el, enfants); };

  // ---------------------------------------------------------------- stockage
  A.stock = {
    lire(cle, defaut) {
      try {
        const v = localStorage.getItem("atlo." + cle);
        return v == null ? defaut : JSON.parse(v);
      } catch (e) { return defaut; }
    },
    ecrire(cle, valeur) {
      try { localStorage.setItem("atlo." + cle, JSON.stringify(valeur)); return true; } catch (e) { return false; }
    },
    effacer() {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith("atlo.")).forEach((k) => localStorage.removeItem(k));
      } catch (e) { /* rien */ }
    },
  };

  // ---------------------------------------------------------------- données
  // Noms des pays : référentiel Unicode CLDR du navigateur (Intl.DisplayNames), données en repli.
  // Les anciens noms restent dans « alt » pour la recherche.
  (() => {
    const COURTS = new Set(["HK", "MO", "PS"]);
    ["fr", "en", "es", "ar"].forEach((l, i) => {
      let long, court;
      try {
        long = new Intl.DisplayNames([l], { type: "region" });
        court = new Intl.DisplayNames([l], { type: "region", style: "short" });
      } catch (e) { return; }
      for (const p of window.ATLO_PAYS) {
        if (!p.alt) p.alt = p.n.slice();
        let nom = null;
        try { nom = (COURTS.has(p.c) ? court : long).of(p.c); } catch (e) { /* code inconnu */ }
        if (nom && nom !== p.c) p.n[i] = nom;
      }
    });
  })();
  A.PAYS = new Map(window.ATLO_PAYS.map((p) => [p.c, p]));
  A.SITES = window.ATLO_SITES.map((s) => ({
    id: s[0], pays: s[1].split(" "), cat: s[2], lat: s[3], lon: s[4], unesco: s[5],
    wfr: s[6], wen: s[7], fr: s[8], en: s[9], region: s[10], paysRegion: s[11],
  }));
  A.SITE = new Map(A.SITES.map((s) => [s.id, s]));
  A.SITES_PAR_PAYS = new Map();
  for (const s of A.SITES) for (const c of s.pays) {
    if (!A.SITES_PAR_PAYS.has(c)) A.SITES_PAR_PAYS.set(c, []);
    A.SITES_PAR_PAYS.get(c).push(s);
  }
  A.CATEGORIES = {
    H: { icone: "🏛️", cle: "catH" }, R: { icone: "🛐", cle: "catR" }, N: { icone: "🏞️", cle: "catN" },
    M: { icone: "🖼️", cle: "catM" }, V: { icone: "🏘️", cle: "catV" }, A: { icone: "🏙️", cle: "catA" },
    P: { icone: "🏝️", cle: "catP" },
  };
  A.CONTINENTS = ["af", "na", "sa", "as", "eu", "oc", "an"];

  const IDX = { fr: 0, en: 1, es: 2, ar: 3 };
  A.nomListe = (n) => (typeof n === "string" ? n : n[IDX[I.langue]] || n[1] || n[0]);
  A.nomPays = (code) => {
    const p = A.PAYS.get(code);
    return p ? A.nomListe(p.n) : I.nomRegionIntl(code);
  };
  A.drapeau = (code) =>
    code && /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "🏳️";
  A.nomSite = (s) => (I.langue === "fr" ? s.fr : s.en);
  A.capitale = (p) => p && p.cap && {
    nom: A.nomListe(p.cap.n), lat: p.cap.ll ? p.cap.ll[0] : null, lon: p.cap.ll ? p.cap.ll[1] : null, tz: p.cap.tz,
  };

  const chargements = new Map();
  const donnees = new Map();
  window.atloDonnees = (code, d) => {
    d.r = d.r.map(([n, lat, lon, bb, contours], i) => ({ i, n, lat, lon, bb, contours, _anneaux: null }));
    d.v = d.v.map(([n, lat, lon, pop, cls, region, tz]) => ({ n, lat, lon, pop, cls, region, tz }));
    donnees.set(code, d);
  };
  /** Régions et villes d'un pays (fichier data/pays/XX.js chargé une seule fois). */
  A.donneesPays = (code) => {
    if (donnees.has(code)) return Promise.resolve(donnees.get(code));
    if (!chargements.has(code)) {
      const promesse = chargerScript(`data/pays/${code}.js`).then(
        () => donnees.get(code) || { r: [], v: [] },
        (e) => {
          chargements.delete(code);
          // Petits territoires sans fichier : pas de régions ni de villes, ce n'est pas une erreur.
          if (A.PAYS.get(code) && !A.PAYS.get(code).r) return { r: [], v: [] };
          throw e;
        }
      );
      chargements.set(code, promesse);
    }
    return chargements.get(code);
  };
  A.anneauxRegion = (r) => (r._anneaux || (r._anneaux = O.anneaux(r.contours, 1000)));

  function chargerScript(src) {
    return new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => ok();
      s.onerror = () => { s.remove(); ko(new Error("chargement impossible : " + src)); };
      document.head.appendChild(s);
    });
  }
  A.chargerScript = chargerScript;

  /** Pays et région contenant un point (polygones Natural Earth simplifiés). */
  A.localiser = async (lat, lon) => {
    const candidats = window.ATLO_PAYS.filter((p) => {
      const boites = [p.bb, p.bx].filter(Boolean);
      return boites.some(([w, s, e, n]) => {
        const lo = lon < w - 0.5 && e > 180 ? lon + 360 : lon;
        return lat >= s - 0.5 && lat <= n + 0.5 && lo >= w - 0.5 && lo <= e + 0.5;
      });
    });
    let meilleur = null;
    for (const p of candidats.slice(0, 8)) {
      if (!p.r) continue;
      const d = await A.donneesPays(p.c).catch(() => null);
      if (!d) continue;
      for (const r of d.r) {
        const [w, s, e, n] = r.bb;
        if (lat < s - 0.05 || lat > n + 0.05) continue;
        const lo = lon < w - 0.05 && e > 180 ? lon + 360 : lon;
        if (lo < w - 0.05 || lo > e + 0.05) continue;
        if (O.pointDansAnneaux(lon, lat, A.anneauxRegion(r))) return { pays: p.c, region: r.i };
      }
      if (!meilleur) meilleur = { pays: p.c, region: -1 };
    }
    return meilleur;
  };

  // ---------------------------------------------------------------- préférences
  const regionNavigateur = (() => {
    for (const l of navigator.languages || [navigator.language || "fr"]) {
      try {
        const r = new Intl.Locale(l).maximize().region;
        if (r && A.PAYS.has(r)) return r;
      } catch (e) { /* rien */ }
    }
    return "FR";
  })();
  const residence = A.PAYS.has(regionNavigateur) ? regionNavigateur : "FR";
  A.prefs = Object.assign(
    {
      langue: I.langueNavigateur(),
      theme: "auto",
      unites: residence === "US" || residence === "LR" || residence === "MM" ? "imperial" : "metrique",
      residence,
      devise: (A.PAYS.get(residence).m || ["EUR"])[0],
    },
    A.stock.lire("prefs", {})
  );
  A.enregistrerPrefs = () => A.stock.ecrire("prefs", A.prefs);
  I.choisir(A.prefs.langue);

  A.sombre = () =>
    A.prefs.theme === "sombre" || (A.prefs.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  A.appliquerTheme = () => {
    const racine = document.documentElement;
    if (A.prefs.theme === "auto") racine.removeAttribute("data-theme");
    else racine.setAttribute("data-theme", A.prefs.theme === "sombre" ? "dark" : "light");
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      const sombre = A.prefs.theme === "auto" ? /dark/.test(m.media) : A.sombre();
      m.setAttribute("content", sombre ? "#0d0d0d" : "#f9f9f7");
    });
  };

  // ---------------------------------------------------------------- formats
  const t = I.t;
  A.t = t;
  A.fmt = {
    nombre: (n, d = 0) => new Intl.NumberFormat(I.locale(), { maximumFractionDigits: d }).format(n),
    argent: (n, devise) => {
      try {
        return new Intl.NumberFormat(I.locale(), { style: "currency", currency: devise, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
      } catch (e) {
        return A.fmt.nombre(n, 2) + " " + devise;
      }
    },
    distance: (km) => {
      if (A.prefs.unites === "imperial") {
        const mi = km * 0.621371;
        return mi < 0.2 ? A.fmt.nombre(mi * 5280) + " ft" : A.fmt.nombre(mi, mi < 10 ? 1 : 0) + " mi";
      }
      return km < 1 ? A.fmt.nombre(Math.round(km * 1000 / 10) * 10) + " m" : A.fmt.nombre(km, km < 10 ? 1 : 0) + " km";
    },
    temperature: (c) => (c == null || isNaN(c) ? "–" : A.prefs.unites === "imperial" ? Math.round(c * 9 / 5 + 32) + "°F" : Math.round(c) + "°C"),
    vitesse: (kmh) => (A.prefs.unites === "imperial" ? Math.round(kmh * 0.621371) + " mph" : Math.round(kmh) + " km/h"),
    duree: (min) => {
      min = Math.round(min);
      if (min < 60) return t("minutes", { n: min });
      const hh = Math.floor(min / 60), mm = min % 60;
      return mm ? t("heuresMinutes", { h: hh, m: String(mm).padStart(2, "0") }) : t("heures", { n: hh });
    },
    heure: (tz, date = new Date()) => {
      try {
        return new Intl.DateTimeFormat(I.locale(), { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(date);
      } catch (e) { return "–"; }
    },
    jour: (iso, options = { weekday: "short", day: "numeric" }) =>
      new Intl.DateTimeFormat(I.locale(), Object.assign({ timeZone: "UTC" }, options)).format(new Date(iso + "T12:00:00Z")),
    mois: (i, format = "short") => new Intl.DateTimeFormat(I.locale(), { month: format, timeZone: "UTC" }).format(new Date(Date.UTC(2021, i, 15))),
    decalage: (tz) => {
      try {
        const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date());
        return (p.find((x) => x.type === "timeZoneName") || {}).value.replace("GMT", "UTC") || "";
      } catch (e) { return ""; }
    },
  };
  /** Écart (en heures) entre un fuseau et l'heure de l'appareil. */
  A.ecartHeures = (tz) => {
    try {
      const d = new Date();
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).formatToParts(d).map((x) => [x.type, x.value]));
      const la = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
      const decalage = (la - Math.floor(d.getTime() / 1000) * 1000) / 60000; // minutes, fuseau visé
      return Math.round((decalage + d.getTimezoneOffset()) / 15) / 4;
    } catch (e) { return 0; }
  };

  // ---------------------------------------------------------------- messages
  A.toast = (message, { duree = 3200 } = {}) => {
    const zone = document.getElementById("toasts");
    const el = h("div", { class: "toast", role: "status" }, message);
    zone.appendChild(el);
    setTimeout(() => { el.classList.add("sortie"); setTimeout(() => el.remove(), 400); }, duree);
  };

  A.copier = async (texte) => {
    try {
      await navigator.clipboard.writeText(texte);
      A.toast(t("copie"));
    } catch (e) {
      A.toast(texte);
    }
  };

  A.partager = async ({ titre, texte, url }) => {
    if (navigator.share) {
      try { await navigator.share({ title: titre, text: texte, url }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    A.copier(url || texte);
  };

  A.telecharger = (nom, contenu, type) => {
    const url = URL.createObjectURL(new Blob([contenu], { type }));
    const a = h("a", { href: url, download: nom });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // ---------------------------------------------------------------- liens externes
  A.liens = {
    itineraire: (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${(+lat).toFixed(6)},${(+lon).toFixed(6)}`,
    osm: (lat, lon, z = 16) => `https://www.openstreetmap.org/?mlat=${(+lat).toFixed(6)}&mlon=${(+lon).toFixed(6)}#map=${z}/${(+lat).toFixed(5)}/${(+lon).toFixed(5)}`,
    geo: (lat, lon, nom) => `geo:${(+lat).toFixed(6)},${(+lon).toFixed(6)}?q=${(+lat).toFixed(6)},${(+lon).toFixed(6)}(${encodeURIComponent(nom || "")})`,
    photos: (q) => `https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(q)}&title=Special:MediaSearch&type=image`,
    videos: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
    unesco: (id) => `https://whc.unesco.org/${I.langue === "fr" ? "fr" : "en"}/list/${id}`,
    wikipedia: (titre, langue) => `https://${langue}.wikipedia.org/wiki/${encodeURIComponent(titre.replace(/ /g, "_"))}`,
  };
  A.lienExterne = (href, ...enfants) => h("a", { href, target: "_blank", rel: "noopener noreferrer", class: "lien-externe" }, ...enfants);

  // ---------------------------------------------------------------- routeur
  const routes = [];
  A.route = (motif, vue) => routes.push({ motif, vue });
  A.routesListe = () => routes;
  A.aller = (chemin) => {
    if (location.hash === "#" + chemin) A.rendre();
    else location.hash = chemin;
  };
  A.etat = { vue: null, scene: null, nettoyages: [] };
  A.surNettoyage = (f) => A.etat.nettoyages.push(f);

  A.rendre = async () => {
    // « #/outils?p=DZ#phrases » : la seconde ancre sert au défilement, pas au routage.
    const brut = location.hash.replace(/^#\/?/, "");
    let hash;
    try { hash = decodeURI(brut); } catch (e) { hash = brut; } // lien partagé mal encodé
    hash = hash.split("#")[0];
    const [chemin, requete] = hash.split("?");
    const params = new URLSearchParams(requete || "");
    let trouve = null, m = null;
    for (const r of routes) {
      m = chemin.match(r.motif);
      if (m) { trouve = r; break; }
    }
    if (!trouve) { trouve = routes[0]; m = [""]; }
    A.etat.nettoyages.splice(0).forEach((f) => { try { f(); } catch (e) { /* rien */ } });
    A.etat.scene = null;
    const conteneur = document.getElementById("vue");
    const changer = async () => {
      let resultat;
      try {
        resultat = await trouve.vue(m.slice(1), params);
      } catch (e) {
        console.error(e);
        resultat = { titre: t("erreur"), contenu: h("section", { class: "bloc vide" }, h("h1", null, t("erreur")), h("p", null, String(e.message || e))) };
      }
      if (!resultat) return;
      A.vider(conteneur, resultat.contenu);
      document.title = resultat.titre ? resultat.titre + " · Atlo" : "Atlo";
      document.body.dataset.vue = resultat.nom || "";
      A.afficherCarte(resultat.carte || null);
      document.querySelectorAll("[data-onglet]").forEach((a) => {
        const actif = a.dataset.onglet === (resultat.onglet || "explorer");
        a.classList.toggle("actif", actif);
        if (actif) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      });
      if (!resultat.garderDefilement) {
        conteneur.scrollTop = 0;
        window.scrollTo(0, 0);
      }
      const titre = conteneur.querySelector("h1");
      if (titre && A.etat.vue !== null) { titre.setAttribute("tabindex", "-1"); titre.focus({ preventScroll: true }); }
      A.etat.vue = chemin;
      if (resultat.apres) resultat.apres();
    };
    const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (document.startViewTransition && !reduit && A.etat.vue !== null) {
      document.startViewTransition(changer);
    } else {
      await changer();
    }
  };

  // ---------------------------------------------------------------- panneau carte
  let carte = null;
  /** scene = null (pas de carte), { monde: … } (SVG du monde) ou une scène MapLibre. */
  A.afficherCarte = (scene) => {
    const panneau = document.getElementById("panneau-carte");
    const zone = document.getElementById("carte");
    const monde = document.getElementById("monde");
    document.body.classList.toggle("avec-carte", !!scene);
    if (!scene) {
      document.body.classList.remove("carte-pleine");
      return;
    }
    panneau.dataset.mode = scene.monde ? "monde" : "carte";
    if (scene.monde) {
      monde.hidden = false;
      zone.hidden = true;
      scene.monde(monde);
      return;
    }
    monde.hidden = true;
    zone.hidden = false;
    if (!carte) {
      carte = new window.AtloCarte.CarteInteractive(zone, {
        langue: I.langue,
        sombre: A.sombre(),
        unites: A.prefs.unites,
        textes: { schema: t("carteSchema"), schemaNote: t("carteSchemaNote") },
        libelles: I.libellesCarte(),
        onPoint: (type, id, props) => A.surPointCarte && A.surPointCarte(type, id, props),
      });
      A.carteInteractive = carte;
    }
    carte.afficher(scene);
  };
  A.focaliserCarte = (lat, lon, zoom) => {
    if (carte) carte.focaliser(lat, lon, zoom);
  };
  A.redimensionnerCarte = () => carte && carte.redimensionner();
  A.changerThemeCarte = () => carte && carte.changerTheme(A.sombre());
  A.changerLangueCarte = () => carte && carte.changerLangue(I.langue);

  // ---------------------------------------------------------------- géolocalisation
  A.position = () =>
    new Promise((ok, ko) => {
      if (!navigator.geolocation) return ko(new Error(t("geolocIndispo")));
      navigator.geolocation.getCurrentPosition(
        (p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy }),
        (e) => ko(new Error(e.code === 1 ? t("geolocRefusee") : t("geolocEchec"))),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 120000 }
      );
    });

  /** Section chargée quand elle devient visible (économise réseau et batterie). */
  A.quandVisible = (el, f) => {
    if (!("IntersectionObserver" in window)) { f(); return; }
    const obs = new IntersectionObserver((entrees) => {
      if (entrees.some((e) => e.isIntersecting)) { obs.disconnect(); f(); }
    }, { rootMargin: "200px" });
    obs.observe(el);
    A.surNettoyage(() => obs.disconnect());
  };
})();
