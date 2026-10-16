/* Atlo · cartes.
   - Carte interactive MapLibre GL (tuiles vectorielles OpenFreeMap), chargée à la demande.
   - Carte du monde SVG (projection Equal Earth), instantanée et utilisable hors ligne.
   - Repli « positions schématiques » en SVG si WebGL ou le réseau manquent. */
(function () {
  "use strict";
  const O = window.AtloOutils;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const STYLES = {
    clair: "https://tiles.openfreemap.org/styles/liberty",
    sombre: "https://tiles.openfreemap.org/styles/dark",
    secours: "https://tiles.openfreemap.org/styles/positron",
  };

  let chargement = null;
  function chargerMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (chargement) return chargement;
    chargement = new Promise((ok, ko) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "vendor/maplibre-gl.css";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src = "vendor/maplibre-gl.js";
      s.async = true;
      s.onload = () => (window.maplibregl ? ok(window.maplibregl) : ko(new Error("MapLibre absent")));
      s.onerror = () => ko(new Error("MapLibre non chargé"));
      document.head.appendChild(s);
    });
    chargement.catch(() => (chargement = null));
    return chargement;
  }

  function webglDisponible() {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch (e) {
      return false;
    }
  }

  function couleur(nom) {
    return getComputedStyle(document.documentElement).getPropertyValue(nom).trim() || "#2a78d6";
  }

  function svg(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  // ================================================================== carte interactive
  class CarteInteractive {
    constructor(conteneur, options) {
      this.conteneur = conteneur;
      this.options = options; // { langue, sombre, onPoint, libelles, onEchec }
      this.scene = null;
      this.carte = null;
      this.mode = "attente"; // attente | gl | schema
      this.marqueurUtilisateur = null;
      this.survol = null;
    }

    async demarrer() {
      if (this.mode !== "attente") return;
      this.mode = "chargement";
      const enLigne = navigator.onLine !== false;
      if (!webglDisponible() || location.protocol === "file:" && !enLigne) return this.basculerSchema("webgl");
      let ml;
      try {
        ml = await chargerMapLibre();
      } catch (e) {
        return this.basculerSchema("reseau");
      }
      if (!ml.getRTLTextPluginStatus || ml.getRTLTextPluginStatus() === "unavailable") {
        try { ml.setRTLTextPlugin("vendor/mapbox-gl-rtl-text.js", true); } catch (e) { /* déjà défini */ }
      }
      this.conteneur.textContent = "";
      const fond = document.createElement("div");
      fond.className = "carte-gl";
      this.conteneur.appendChild(fond);
      this.styleCourant = this.options.sombre ? STYLES.sombre : STYLES.clair;
      try {
        this.carte = new ml.Map({
          container: fond,
          style: this.styleCourant,
          center: [10, 25],
          zoom: 1.2,
          attributionControl: { compact: true },
          cooperativeGestures: matchMedia("(pointer: coarse)").matches,
          dragRotate: false,
          pitchWithRotate: false,
          locale: this.options.libelles || {},
        });
      } catch (e) {
        return this.basculerSchema("webgl");
      }
      this.mode = "gl";
      this.carte.touchZoomRotate.disableRotation();
      this.carte.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      this.carte.addControl(new ml.ScaleControl({ unit: this.options.unites === "imperial" ? "imperial" : "metric" }), "bottom-left");
      const chien = setTimeout(() => {
        if (!this.carte.isStyleLoaded()) this.basculerSchema("reseau");
      }, 12000);
      this.carte.on("error", (ev) => {
        const msg = String((ev && ev.error && ev.error.message) || "");
        if (!this.carte.isStyleLoaded() && this.styleCourant === STYLES.sombre && /style|fetch|404/i.test(msg)) {
          this.styleCourant = STYLES.secours;
          this.carte.setStyle(STYLES.secours);
        }
      });
      this.carte.on("style.load", () => {
        clearTimeout(chien);
        this.localiserLibelles();
        this.ajouterCouches();
        if (this.scene) this.appliquer(this.scene, false);
      });
      this.brancherEvenements();
    }

    basculerSchema(raison) {
      if (this.carte) {
        try { this.carte.remove(); } catch (e) { /* rien */ }
        this.carte = null;
      }
      this.mode = "schema";
      this.raison = raison;
      if (this.scene) this.dessinerSchema(this.scene);
      if (this.options.onEchec) this.options.onEchec(raison);
    }

    localiserLibelles() {
      const langue = this.options.langue || "fr";
      const style = this.carte.getStyle();
      for (const couche of style.layers || []) {
        if (couche.type !== "symbol" || !couche.layout || !couche.layout["text-field"]) continue;
        const texte = JSON.stringify(couche.layout["text-field"]);
        if (!/name/.test(texte) || /\bref\b|housenumber/.test(texte)) continue;
        this.carte.setLayoutProperty(couche.id, "text-field", [
          "coalesce",
          ["get", "name:" + langue],
          ["get", "name:latin"],
          ["get", "name"],
        ]);
      }
    }

    police() {
      const couche = (this.carte.getStyle().layers || []).find((c) => c.layout && c.layout["text-font"]);
      const f = couche && couche.layout["text-font"];
      return Array.isArray(f) && typeof f[0] === "string" ? f : ["Noto Sans Regular"];
    }

    ajouterCouches() {
      const c = this.carte;
      const vide = { type: "FeatureCollection", features: [] };
      const bleu = couleur("--serie-1"), orange = couleur("--serie-2"), aqua = couleur("--serie-3");
      const surface = couleur("--surface");
      const police = this.police();
      c.addSource("atlo-zone", { type: "geojson", data: vide });
      c.addSource("atlo-trace", { type: "geojson", data: vide });
      c.addSource("atlo-sites", { type: "geojson", data: vide, cluster: true, clusterRadius: 44, clusterMaxZoom: 11 });
      c.addSource("atlo-decouvertes", { type: "geojson", data: vide });
      c.addSource("atlo-etapes", { type: "geojson", data: vide });
      c.addSource("atlo-guide", { type: "geojson", data: vide, cluster: true, clusterRadius: 28, clusterMaxZoom: 13 });
      c.addSource("atlo-hebergements", { type: "geojson", data: vide });
      c.addLayer({ id: "atlo-zone-fond", type: "fill", source: "atlo-zone", paint: { "fill-color": bleu, "fill-opacity": 0.07 } });
      c.addLayer({ id: "atlo-zone-bord", type: "line", source: "atlo-zone", paint: { "line-color": bleu, "line-width": 2, "line-opacity": 0.8 } });
      c.addLayer({
        id: "atlo-trace", type: "line", source: "atlo-trace",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": aqua, "line-width": 3, "line-dasharray": [2, 1.5] },
      });
      c.addLayer({
        id: "atlo-decouvertes", type: "circle", source: "atlo-decouvertes",
        paint: { "circle-color": orange, "circle-radius": 6, "circle-stroke-color": surface, "circle-stroke-width": 2 },
      });
      c.addLayer({
        id: "atlo-groupes", type: "circle", source: "atlo-sites", filter: ["has", "point_count"],
        paint: {
          "circle-color": bleu, "circle-opacity": 0.92,
          "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 40, 23],
          "circle-stroke-color": surface, "circle-stroke-width": 2,
        },
      });
      c.addLayer({
        id: "atlo-groupes-nb", type: "symbol", source: "atlo-sites", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": police, "text-size": 13, "text-allow-overlap": true },
        paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.35)", "text-halo-width": 1 },
      });
      c.addLayer({
        id: "atlo-sites", type: "circle", source: "atlo-sites", filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": bleu,
          "circle-radius": ["case", ["boolean", ["get", "choisi"], false], 10, 7],
          "circle-stroke-color": surface, "circle-stroke-width": 2,
        },
      });
      c.addLayer({
        id: "atlo-hebergements", type: "circle", source: "atlo-hebergements",
        paint: {
          "circle-color": couleur("--encre-2"),
          "circle-radius": ["case", ["boolean", ["get", "choisi"], false], 10, 6.5],
          "circle-stroke-color": surface, "circle-stroke-width": 2,
        },
      });
      c.addLayer({
        id: "atlo-guide-groupes", type: "circle", source: "atlo-guide", filter: ["has", "point_count"],
        paint: { "circle-color": bleu, "circle-opacity": 0.92, "circle-radius": ["step", ["get", "point_count"], 15, 6, 19], "circle-stroke-color": surface, "circle-stroke-width": 3 },
      });
      c.addLayer({
        id: "atlo-guide-groupes-nb", type: "symbol", source: "atlo-guide", filter: ["has", "point_count"],
        layout: { "text-field": ["concat", "×", ["to-string", ["get", "point_count"]]], "text-font": police, "text-size": 12, "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" },
      });
      c.addLayer({
        id: "atlo-guide", type: "circle", source: "atlo-guide", filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": bleu,
          "circle-radius": ["case", ["boolean", ["get", "choisi"], false], 14, 11],
          "circle-stroke-color": surface, "circle-stroke-width": 2,
        },
      });
      c.addLayer({
        id: "atlo-guide-nb", type: "symbol", source: "atlo-guide", filter: ["!", ["has", "point_count"]],
        layout: { "text-field": ["to-string", ["get", "n"]], "text-font": police, "text-size": 12, "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": "#ffffff" },
      });
      c.addLayer({
        id: "atlo-etapes", type: "circle", source: "atlo-etapes",
        paint: { "circle-color": aqua, "circle-radius": 11, "circle-stroke-color": surface, "circle-stroke-width": 2 },
      });
      c.addLayer({
        id: "atlo-etapes-nb", type: "symbol", source: "atlo-etapes",
        layout: { "text-field": ["to-string", ["get", "n"]], "text-font": police, "text-size": 12, "text-allow-overlap": true },
        paint: { "text-color": couleur("--sur-serie-3") },
      });
    }

    brancherEvenements() {
      const c = this.carte;
      const cliquable = ["atlo-sites", "atlo-decouvertes", "atlo-etapes", "atlo-groupes", "atlo-guide", "atlo-guide-groupes", "atlo-hebergements"];
      for (const id of cliquable) {
        c.on("mouseenter", id, () => (c.getCanvas().style.cursor = "pointer"));
        c.on("mouseleave", id, () => {
          c.getCanvas().style.cursor = "";
          if (this.survol) { this.survol.remove(); this.survol = null; }
        });
      }
      for (const id of ["atlo-sites", "atlo-decouvertes", "atlo-etapes", "atlo-guide", "atlo-hebergements"]) {
        c.on("mousemove", id, (e) => {
          const f = e.features && e.features[0];
          if (!f || matchMedia("(pointer: coarse)").matches) return;
          if (!this.survol) this.survol = new window.maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "bulle" });
          this.survol.setLngLat(f.geometry.coordinates).setText(f.properties.titre || "").addTo(c);
        });
        c.on("click", id, (e) => {
          const f = e.features && e.features[0];
          if (f && this.options.onPoint) this.options.onPoint(f.properties.type, f.properties.id, f.properties);
        });
      }
      for (const [couche, source] of [["atlo-groupes", "atlo-sites"], ["atlo-guide-groupes", "atlo-guide"]]) {
        c.on("click", couche, async (e) => {
          const f = e.features && e.features[0];
          if (!f) return;
          try {
            const zoom = await c.getSource(source).getClusterExpansionZoom(f.properties.cluster_id);
            c.easeTo({ center: f.geometry.coordinates, zoom: zoom + 0.3 });
          } catch (err) { /* rien */ }
        });
      }
    }

    afficher(scene) {
      this.scene = scene;
      if (this.mode === "attente") this.demarrer();
      if (this.mode === "gl" && this.carte && this.carte.isStyleLoaded()) this.appliquer(scene, true);
      if (this.mode === "schema") this.dessinerSchema(scene);
    }

    appliquer(scene, anime) {
      const c = this.carte;
      const pt = (p, extra) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: Object.assign({ id: p.id, titre: p.titre, type: p.type }, extra || {}),
      });
      const fc = (features) => ({ type: "FeatureCollection", features });
      c.getSource("atlo-sites").setData(fc((scene.points || []).map((p) => pt(p, { type: "site", choisi: p.id === scene.choisi }))));
      c.getSource("atlo-decouvertes").setData(fc((scene.decouvertes || []).map((p) => pt(p, { type: "wiki" }))));
      c.getSource("atlo-etapes").setData(fc((scene.etapes || []).map((p, i) => pt(p, { type: "etape", n: i + 1 }))));
      c.getSource("atlo-guide").setData(fc((scene.guide || []).map((p) => pt(p, { type: "guide", n: p.n, choisi: p.id === scene.choisi }))));
      c.getSource("atlo-hebergements").setData(fc((scene.hebergements || []).map((p) => pt(p, { type: "hebergement", choisi: p.id === scene.choisi }))));
      c.getSource("atlo-trace").setData(
        fc(scene.etapes && scene.etapes.length > 1
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: scene.etapes.map((p) => [p.lon, p.lat]) } }]
          : [])
      );
      c.getSource("atlo-zone").setData(
        fc(scene.zone && scene.zone.length
          ? [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: O.multiPolygone(scene.zone) } }]
          : [])
      );
      this.placerUtilisateur(scene.utilisateur);
      if (scene.cadrer !== false) this.cadrer(scene, anime);
    }

    cadrer(scene, anime) {
      const c = this.carte;
      const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const marge = Math.min(60, Math.round(Math.min(c.getContainer().clientWidth, c.getContainer().clientHeight) / 8));
      const options = { padding: marge, duration: anime && !reduit ? 900 : 0, maxZoom: scene.zoomMax || 13 };
      let bb = scene.boite;
      if (!bb) {
        const tous = [...(scene.points || []), ...(scene.etapes || []), ...(scene.guide || []), ...(scene.hebergements || [])];
        if (tous.length) {
          const lats = tous.map((p) => p.lat), lons = tous.map((p) => p.lon);
          bb = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
        }
      }
      if (scene.centre) {
        c.easeTo({ center: [scene.centre.lon, scene.centre.lat], zoom: scene.zoom || 11, duration: options.duration });
      } else if (bb) {
        const [w, s, e, n] = bb;
        if (Math.abs(e - w) < 1e-6 && Math.abs(n - s) < 1e-6) {
          c.easeTo({ center: [w, s], zoom: Math.min(12, options.maxZoom), duration: options.duration });
        } else {
          try { c.fitBounds([[w, s], [e, n]], options); } catch (err) { /* rien */ }
        }
      } else {
        c.easeTo({ center: [10, 25], zoom: 1.2, duration: options.duration });
      }
    }

    placerUtilisateur(position) {
      if (this.marqueurUtilisateur) { this.marqueurUtilisateur.remove(); this.marqueurUtilisateur = null; }
      if (!position || !window.maplibregl || !this.carte) return;
      const el = document.createElement("div");
      el.className = "point-utilisateur";
      el.setAttribute("aria-hidden", "true");
      this.marqueurUtilisateur = new window.maplibregl.Marker({ element: el }).setLngLat([position.lon, position.lat]).addTo(this.carte);
    }

    focaliser(lat, lon, zoom = 14) {
      if (this.mode === "gl" && this.carte) {
        this.carte.easeTo({ center: [lon, lat], zoom, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700 });
      }
    }

    changerTheme(sombre) {
      this.options.sombre = sombre;
      if (this.mode === "gl" && this.carte) {
        this.styleCourant = sombre ? STYLES.sombre : STYLES.clair;
        this.carte.setStyle(this.styleCourant);
      } else if (this.mode === "schema" && this.scene) {
        this.dessinerSchema(this.scene);
      }
    }

    changerLangue(langue) {
      this.options.langue = langue;
      if (this.mode === "gl" && this.carte && this.carte.isStyleLoaded()) this.localiserLibelles();
    }

    redimensionner() {
      if (this.carte) this.carte.resize();
    }

    // ---------------------------------------------------------------- repli SVG
    dessinerSchema(scene) {
      const conteneur = this.conteneur;
      conteneur.textContent = "";
      const largeur = Math.max(280, conteneur.clientWidth || 600);
      const hauteur = Math.max(200, conteneur.clientHeight || 360);
      const tous = [...(scene.points || []), ...(scene.etapes || []), ...(scene.decouvertes || []), ...(scene.guide || []), ...(scene.hebergements || [])];
      let [w, s, e, n] = scene.boite || [-180, -60, 180, 80];
      if (!scene.boite && tous.length) {
        w = Math.min(...tous.map((p) => p.lon)); e = Math.max(...tous.map((p) => p.lon));
        s = Math.min(...tous.map((p) => p.lat)); n = Math.max(...tous.map((p) => p.lat));
      }
      if (scene.centre) { w = scene.centre.lon - 0.2; e = scene.centre.lon + 0.2; s = scene.centre.lat - 0.15; n = scene.centre.lat + 0.15; }
      const kx = Math.cos(((s + n) / 2) * Math.PI / 180) || 1;
      const lx = Math.max(0.02, (e - w) * kx), ly = Math.max(0.02, n - s);
      const echelle = Math.min((largeur - 48) / lx, (hauteur - 48) / ly);
      const ox = (largeur - lx * echelle) / 2, oy = (hauteur - ly * echelle) / 2;
      const proj = (lon, lat) => [ox + (lon - w) * kx * echelle, oy + (n - lat) * echelle];
      const racine = svg("svg", { viewBox: `0 0 ${largeur} ${hauteur}`, class: "schema", role: "img" });
      racine.setAttribute("aria-label", this.options.textes ? this.options.textes.schema : "");
      if (scene.zone && scene.zone.length) {
        const d = scene.zone.map((a) => "M" + a.map(([x, y]) => proj(x, y).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join("");
        racine.appendChild(svg("path", { d, class: "schema-zone", "fill-rule": "evenodd" }));
      }
      if (scene.etapes && scene.etapes.length > 1) {
        racine.appendChild(svg("polyline", { points: scene.etapes.map((p) => proj(p.lon, p.lat).join(",")).join(" "), class: "schema-trace" }));
      }
      const groupe = (liste, classe, type, numeroter, numero) =>
        liste.forEach((p, i) => {
          const [x, y] = proj(p.lon, p.lat);
          const a = svg("a", { href: "#", class: "schema-point " + classe, tabindex: "0" });
          const titre = svg("title");
          titre.textContent = p.titre || "";
          a.appendChild(titre);
          a.appendChild(svg("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: numeroter ? 10 : 6 }));
          if (numeroter) {
            const t = svg("text", { x: x.toFixed(1), y: (y + 4).toFixed(1), "text-anchor": "middle" });
            t.textContent = String(numero ? numero(p, i) : i + 1);
            a.appendChild(t);
          }
          a.addEventListener("click", (ev) => {
            ev.preventDefault();
            if (this.options.onPoint) this.options.onPoint(type, p.id, p);
          });
          racine.appendChild(a);
        });
      groupe(scene.decouvertes || [], "decouverte", "wiki");
      groupe(scene.hebergements || [], "hebergement", "hebergement");
      groupe(scene.points || [], "site", "site");
      groupe(scene.guide || [], "guide", "guide", true, (p) => p.n);
      groupe(scene.etapes || [], "etape", "etape", true);
      if (scene.utilisateur) {
        const [x, y] = proj(scene.utilisateur.lon, scene.utilisateur.lat);
        racine.appendChild(svg("circle", { cx: x, cy: y, r: 7, class: "schema-moi" }));
      }
      conteneur.appendChild(racine);
      const note = document.createElement("p");
      note.className = "schema-note";
      note.textContent = this.options.textes ? this.options.textes.schemaNote : "";
      conteneur.appendChild(note);
    }
  }

  // ================================================================== monde SVG
  /** Carte du monde en SVG : chaque pays est un lien coloré selon une valeur (rampe séquentielle). */
  function dessinerMonde(conteneur, { contours, valeurs, seuils, nom, onPays, libelle }) {
    conteneur.textContent = "";
    const L = 1000, H = 487;
    const kx = L / (2 * 2.7066), ky = H / (2 * 1.3173);
    const proj = (lon, lat) => {
      const [x, y] = O.equalEarth(lon, lat);
      return [(x + 2.7066) * kx, (1.3173 - y) * ky];
    };
    const racine = svg("svg", { viewBox: `0 0 ${L} ${H}`, class: "monde", role: "group" });
    racine.setAttribute("aria-label", libelle || "");
    const contour = [];
    for (let lat = -90; lat <= 90; lat += 5) contour.push(proj(-180, lat));
    for (let lat = 90; lat >= -90; lat -= 5) contour.push(proj(180, lat));
    racine.appendChild(svg("path", { d: "M" + contour.map((p) => p.map((v) => v.toFixed(1)).join(",")).join("L") + "Z", class: "monde-ocean" }));
    const classe = (v) => {
      if (!v) return 0;
      let k = 1;
      for (const s of seuils) if (v >= s) k++;
      return Math.min(k, seuils.length + 1);
    };
    for (const [code, texte] of Object.entries(contours)) {
      const anneaux = O.anneaux(texte, 10);
      const d = anneaux
        .map((a) => {
          // Coupe les anneaux qui traversent l'antiméridien pour éviter les traits parasites.
          let chemin = "", prec = null;
          for (const [lon, lat] of a) {
            const [x, y] = proj(lon, lat);
            chemin += (prec !== null && Math.abs(lon - prec) > 180 ? "M" : chemin ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
            prec = lon;
          }
          return chemin + "Z";
        })
        .join("");
      const v = valeurs[code] || 0;
      const lien = svg("a", { href: "#/pays/" + code, class: "monde-pays", "data-code": code });
      const titre = svg("title");
      titre.textContent = nom(code, v);
      lien.appendChild(titre);
      lien.appendChild(svg("path", { d, class: "niv-" + classe(v), "fill-rule": "evenodd" }));
      if (onPays) lien.addEventListener("focus", () => onPays(code, "focus"));
      racine.appendChild(lien);
    }
    conteneur.appendChild(racine);
    return racine;
  }

  window.AtloCarte = { CarteInteractive, dessinerMonde, chargerMapLibre, webglDisponible };
})();
