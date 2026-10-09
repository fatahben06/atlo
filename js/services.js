/* Atlo · services en ligne (sans clé d'API) avec délai maximal, cache mémoire
   et copie locale des données utiles hors connexion.
   - Open-Meteo : prévisions, climat (archives ERA5), recherche de villes ;
   - Wikipédia : résumés, articles géolocalisés autour d'un point ;
   - ExchangeRate-API (open.er-api.com) : taux de change quotidiens. */
(function () {
  "use strict";
  const memoire = new Map();

  function lireLocal(cle) {
    try { return JSON.parse(localStorage.getItem("atlo.cache." + cle)); } catch (e) { return null; }
  }
  function ecrireLocal(cle, valeur) {
    try { localStorage.setItem("atlo.cache." + cle, JSON.stringify(valeur)); } catch (e) { /* stockage plein ou bloqué */ }
  }

  async function json(url, { delai = 9000, duree = 10 * 60e3 } = {}) {
    const deja = memoire.get(url);
    if (deja && Date.now() - deja.t < duree) return deja.v;
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), delai);
    try {
      const rep = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!rep.ok) {
        const err = new Error("HTTP " + rep.status);
        err.status = rep.status;
        throw err;
      }
      const v = await rep.json();
      const copie = rep.headers.get("x-atlo-copie");
      if (copie && v && typeof v === "object") Object.defineProperty(v, "copieDu", { value: Number(copie) });
      memoire.set(url, { t: Date.now(), v });
      if (memoire.size > 200) memoire.delete(memoire.keys().next().value);
      return v;
    } finally {
      clearTimeout(minuteur);
    }
  }

  const arrondi = (x, n = 3) => Number(x).toFixed(n);

  // ---------------------------------------------------------------- météo
  async function meteo(lat, lon) {
    const p = new URLSearchParams({
      latitude: arrondi(lat), longitude: arrondi(lon), timezone: "auto", forecast_days: "7",
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset",
    });
    const d = await json("https://api.open-meteo.com/v1/forecast?" + p);
    const j = d.daily || {};
    return {
      copieDu: d.copieDu || null,
      fuseau: d.timezone,
      decalage: d.utc_offset_seconds,
      actuel: d.current && {
        t: d.current.temperature_2m, ressenti: d.current.apparent_temperature,
        humidite: d.current.relative_humidity_2m, code: d.current.weather_code,
        vent: d.current.wind_speed_10m, jour: d.current.is_day !== 0,
      },
      jours: (j.time || []).map((date, i) => ({
        date, code: j.weather_code[i], max: j.temperature_2m_max[i], min: j.temperature_2m_min[i],
        pluie: j.precipitation_probability_max ? j.precipitation_probability_max[i] : null,
        uv: j.uv_index_max ? j.uv_index_max[i] : null,
        lever: j.sunrise ? j.sunrise[i] : null, coucher: j.sunset ? j.sunset[i] : null,
      })),
    };
  }

  /** Climat moyen des trois dernières années complètes (archives Open-Meteo / ERA5). */
  async function climat(lat, lon) {
    const cle = "climat:" + arrondi(lat, 1) + "," + arrondi(lon, 1);
    const local = lireLocal(cle);
    if (local && Date.now() - local.t < 120 * 864e5) return local.v;
    const auj = new Date();
    const an = auj.getFullYear() - (auj.getMonth() === 0 && auj.getDate() < 20 ? 1 : 0);
    const p = new URLSearchParams({
      latitude: arrondi(lat, 2), longitude: arrondi(lon, 2), timezone: "auto",
      start_date: `${an - 3}-01-01`, end_date: `${an - 1}-12-31`,
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
    });
    const d = await json("https://archive-api.open-meteo.com/v1/archive?" + p, { delai: 15000, duree: 864e5 });
    const j = d.daily || {};
    const mensuel = window.AtloOutils.climatMensuel(j.time || [], j.temperature_2m_max || [], j.temperature_2m_min || [], j.precipitation_sum || []);
    const v = { mensuel, periode: [an - 3, an - 1] };
    ecrireLocal(cle, { t: Date.now(), v });
    return v;
  }

  /** Recherche de villes et lieux dans le monde entier (GeoNames via Open-Meteo). */
  async function geocoder(texte, langue, pays) {
    const p = new URLSearchParams({ name: texte, count: "12", language: langue, format: "json" });
    if (pays) p.set("countryCode", pays);
    const d = await json("https://geocoding-api.open-meteo.com/v1/search?" + p, { delai: 6000 });
    return (d.results || []).map((r) => ({
      nom: r.name, lat: r.latitude, lon: r.longitude, pays: r.country_code, region: r.admin1 || "",
      population: r.population || 0, fuseau: r.timezone,
    }));
  }

  // ---------------------------------------------------------------- Wikipédia
  const titreUrl = (t) => encodeURIComponent(String(t).replace(/ /g, "_"));

  async function lienLangue(titreEn, langue) {
    const p = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", origin: "*", redirects: "1",
      prop: "langlinks", lllang: langue, titles: titreEn,
    });
    const d = await json("https://en.wikipedia.org/w/api.php?" + p);
    const page = d.query && d.query.pages && d.query.pages[0];
    return page && page.langlinks && page.langlinks[0] ? page.langlinks[0].title : null;
  }

  async function chercherTitre(texte, langue) {
    const p = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", origin: "*", list: "search", srsearch: texte, srlimit: "1",
    });
    const d = await json(`https://${langue}.wikipedia.org/w/api.php?` + p);
    const r = d.query && d.query.search && d.query.search[0];
    return r ? r.title : null;
  }

  async function resumeBrut(titre, langue) {
    const d = await json(`https://${langue}.wikipedia.org/api/rest_v1/page/summary/${titreUrl(titre)}`, { duree: 864e5 });
    if (d.type === "disambiguation") throw Object.assign(new Error("homonymie"), { status: 404 });
    return {
      titre: d.title, extrait: d.extract || "", description: d.description || "",
      image: d.thumbnail && d.thumbnail.source, imageGrande: d.originalimage && d.originalimage.source,
      url: d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page,
      coords: d.coordinates ? { lat: d.coordinates.lat, lon: d.coordinates.lon } : null,
      langue,
    };
  }

  /** Résumé d'un article dans la langue de l'interface, avec repli sur l'anglais. */
  async function resume({ fr, en, recherche, titre, langueTitre }, langue) {
    const essais = [];
    if (titre && langueTitre) essais.push([titre, langueTitre]);
    if (langue === "fr" && fr) essais.push([fr, "fr"]);
    if (langue === "en" && en) essais.push([en, "en"]);
    if (langue !== "fr" && langue !== "en" && en) essais.push([() => lienLangue(en, langue), langue]);
    if (en) essais.push([en, "en"]);
    if (fr) essais.push([fr, "fr"]);
    for (const [titre, l] of essais) {
      try {
        const t = typeof titre === "function" ? await titre() : titre;
        if (t) return await resumeBrut(t, l);
      } catch (e) {
        if (e.name === "AbortError" || (e.status && e.status >= 500) || e instanceof TypeError) throw e;
      }
    }
    if (recherche) {
      const l = langue === "fr" ? "fr" : "en";
      try {
        const t = await chercherTitre(recherche, l);
        if (t) return await resumeBrut(t, l);
      } catch (e) {
        if (e.name === "AbortError" || (e.status && e.status >= 500) || e instanceof TypeError) throw e;
      }
    }
    return null;
  }

  /** Articles géolocalisés autour d'un point, du plus proche au plus lointain. */
  async function autour(lat, lon, langue, { rayon = 10000, limite = 40 } = {}) {
    const p = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", origin: "*",
      generator: "geosearch", ggscoord: `${arrondi(lat, 3)}|${arrondi(lon, 3)}`,
      ggsradius: String(Math.min(10000, rayon)), ggslimit: String(limite),
      prop: "coordinates|pageimages|description", colimit: "max", piprop: "thumbnail", pithumbsize: "240", pilimit: String(limite),
    });
    const d = await json(`https://${langue}.wikipedia.org/w/api.php?` + p, { duree: 3600e3 });
    const pages = (d.query && d.query.pages) || [];
    const O = window.AtloOutils;
    return pages
      .filter((pg) => pg.coordinates && pg.coordinates[0])
      .map((pg) => {
        const c = pg.coordinates[0];
        return {
          titre: pg.title, description: pg.description || "", lat: c.lat, lon: c.lon,
          image: pg.thumbnail && pg.thumbnail.source,
          distance: O.distanceKm(lat, lon, c.lat, c.lon),
          url: `https://${langue}.wikipedia.org/wiki/${titreUrl(pg.title)}`,
          langue,
        };
      })
      .sort((a, b) => a.distance - b.distance);
  }

  // ---------------------------------------------------------------- devises
  /** Taux par rapport au dollar US, mis à jour au plus une fois par jour et gardés hors ligne. */
  async function taux({ forcer = false } = {}) {
    const local = lireLocal("taux");
    if (!forcer && local && Date.now() - local.t < 12 * 3600e3) return local.v;
    try {
      const d = await json("https://open.er-api.com/v6/latest/USD", { delai: 8000, duree: 3600e3 });
      if (d.result !== "success") throw new Error("taux indisponibles");
      const v = { base: "USD", taux: d.rates, maj: d.time_last_update_unix * 1000 };
      ecrireLocal("taux", { t: Date.now(), v });
      return v;
    } catch (e) {
      if (local) return Object.assign({}, local.v, { horsLigne: true });
      throw e;
    }
  }

  function convertir(montant, de, vers, t) {
    if (!t || !t.taux[de] || !t.taux[vers]) return null;
    return (montant / t.taux[de]) * t.taux[vers];
  }

  window.AtloServices = { json, meteo, climat, geocoder, resume, autour, taux, convertir, lireLocal, ecrireLocal };
})();
