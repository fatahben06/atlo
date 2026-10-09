/* Atlo · écrans : accueil, pays, région, lieu, autour de moi, fiche d'un site. */
(function () {
  "use strict";
  const A = window.Atlo;
  const { h, t, fmt, O, S, I } = A;

  const collator = () => new Intl.Collator(I.locale(), { sensitivity: "base" });

  // ================================================================== composants
  A.puce = (texte, { actif = false, onclick, compte } = {}) =>
    h("button", { type: "button", class: "puce", "aria-pressed": actif ? "true" : "false", onclick },
      texte, compte != null ? h("span", { class: "puce-compte" }, fmt.nombre(compte)) : null);

  A.squelette = (lignes = 3) => h("div", { class: "squelette", "aria-hidden": "true" }, Array.from({ length: lignes }, () => h("span")));

  A.erreurReseau = (e, reessayer) =>
    h("p", { class: "note erreur" },
      navigator.onLine === false ? t("horsLigneDonnee") : t("serviceIndispo"),
      reessayer ? [" ", h("button", { type: "button", class: "lien", onclick: reessayer }, t("reessayer"))] : null);

  function libelleCategorie(cat) {
    const c = A.CATEGORIES[cat];
    return c ? c.icone + " " + t(c.cle) : "";
  }

  /** Bouton « ajouter à l'itinéraire » qui reflète l'état courant. */
  A.boutonEtape = (etape, { libelle = false } = {}) => {
    const b = h("button", { type: "button", class: libelle ? "bouton bouton-etape" : "bouton-icone bouton-etape" });
    const maj = () => {
      const dedans = A.itineraire.contient(etape.ref || etape.cle);
      b.setAttribute("aria-pressed", dedans ? "true" : "false");
      b.setAttribute("aria-label", (dedans ? t("retirerDe") : t("ajouterA")) + " : " + etape.nom);
      b.title = dedans ? t("retirerDe") : t("ajouterA");
      A.vider(b, h("span", { "aria-hidden": "true" }, dedans ? "✓" : "+"), libelle ? " " + (dedans ? t("dansItineraire") : t("ajouterItineraire")) : null);
    };
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      A.itineraire.basculer(etape);
      maj();
    });
    maj();
    A.itineraire.ecouter(maj, b);
    return b;
  };

  A.etapeDeSite = (s) => ({ ref: "s:" + s.id, nom: A.nomSite(s), lat: s.lat, lon: s.lon, pays: s.paysRegion, duree: s.cat === "M" ? 150 : s.cat === "V" ? 180 : s.cat === "N" ? 180 : 90 });

  function elementSite(s, { distance, region } = {}) {
    return h("li", { class: "site", dataset: { id: s.id, cat: s.cat } },
      h("button", { type: "button", class: "site-ouvrir", onclick: () => A.ouvrirFiche(s.id) },
        h("span", { class: "site-icone", "aria-hidden": "true" }, A.CATEGORIES[s.cat].icone),
        h("span", { class: "site-texte" },
          h("span", { class: "site-nom" }, A.nomSite(s)),
          h("span", { class: "site-meta" },
            t(A.CATEGORIES[s.cat].cle),
            region ? " · " + region : "",
            distance != null ? " · " + fmt.distance(distance) : "",
            s.unesco ? h("span", { class: "badge-unesco", title: t("unescoTitre") }, "UNESCO") : null))),
      A.boutonEtape(A.etapeDeSite(s)));
  }
  A.elementSite = elementSite;

  /** Liste de sites avec filtre par catégorie. */
  function listeSites(sites, { regionNom, distances } = {}) {
    const bloc = h("div", { class: "liste-sites" });
    const cats = [...new Set(sites.map((s) => s.cat))];
    let filtre = null;
    const ul = h("ul", { class: "sites", role: "list" });
    const dessiner = () => {
      A.vider(ul, sites.filter((s) => !filtre || s.cat === filtre).map((s) =>
        elementSite(s, { region: regionNom && regionNom(s), distance: distances && distances.get(s.id) })));
    };
    if (cats.length > 1) {
      const puces = h("div", { class: "puces", role: "group", "aria-label": t("filtrerCategorie") });
      const majPuces = () => {
        A.vider(puces,
          A.puce(t("tout"), { actif: !filtre, compte: sites.length, onclick: () => { filtre = null; majPuces(); dessiner(); } }),
          cats.map((c) => A.puce(libelleCategorie(c), {
            actif: filtre === c, compte: sites.filter((s) => s.cat === c).length,
            onclick: () => { filtre = filtre === c ? null : c; majPuces(); dessiner(); },
          })));
      };
      majPuces();
      bloc.appendChild(puces);
    }
    dessiner();
    bloc.appendChild(ul);
    return bloc;
  }

  // ---------------------------------------------------------------- météo
  A.blocMeteo = (lat, lon, { titre, fuseau } = {}) => {
    const corps = h("div", { class: "meteo-corps" }, A.squelette(3));
    const bloc = h("section", { class: "bloc meteo", "aria-labelledby": "titre-meteo" },
      h("h2", { id: "titre-meteo" }, titre || t("meteo")), corps);
    const charger = async () => {
      A.vider(corps, A.squelette(3));
      try {
        const m = await S.meteo(lat, lon);
        const a = m.actuel;
        const [cle, icone] = O.meteoWmo(a.code, a.jour);
        const uv = m.jours[0] && m.jours[0].uv;
        const niveauUv = uv == null ? null : uv >= 8 ? ["critique", t("uvTresFort")] : uv >= 6 ? ["serieux", t("uvFort")] : uv >= 3 ? ["attention", t("uvModere")] : ["bon", t("uvFaible")];
        A.vider(corps,
          h("div", { class: "meteo-actuel" },
            h("span", { class: "meteo-icone", "aria-hidden": "true" }, icone),
            h("div", null,
              h("p", { class: "meteo-temp" }, fmt.temperature(a.t)),
              h("p", { class: "meteo-libelle" }, t("wmo_" + cle), " · ", t("ressenti"), " ", fmt.temperature(a.ressenti))),
            h("dl", { class: "meteo-details" },
              h("div", null, h("dt", null, t("vent")), h("dd", null, fmt.vitesse(a.vent))),
              h("div", null, h("dt", null, t("humidite")), h("dd", null, Math.round(a.humidite) + " %")),
              niveauUv ? h("div", null, h("dt", null, t("indiceUv")), h("dd", null, h("span", { class: "statut " + niveauUv[0] }, Math.round(uv) + " · " + niveauUv[1]))) : null,
              // En jour ou nuit polaire, lever et coucher n'existent pas (valeurs vides ou identiques).
              m.jours[0] && m.jours[0].lever && m.jours[0].coucher && m.jours[0].lever !== m.jours[0].coucher
                ? h("div", null, h("dt", null, t("soleil")), h("dd", null, "↑ " + m.jours[0].lever.slice(11) + "  ↓ " + m.jours[0].coucher.slice(11))) : null)),
          h("ol", { class: "meteo-jours", "aria-label": t("previsions7") },
            m.jours.map((j) => {
              const [c, ic] = O.meteoWmo(j.code);
              return h("li", null,
                h("span", { class: "jour" }, fmt.jour(j.date)),
                h("span", { class: "ic", title: t("wmo_" + c), "aria-label": t("wmo_" + c) }, ic),
                h("span", { class: "max" }, fmt.temperature(j.max)),
                h("span", { class: "min" }, fmt.temperature(j.min)),
                j.pluie != null ? h("span", { class: "pluie", title: t("probaPluie") }, "💧" + j.pluie + "%") : null);
            })),
          m.copieDu ? h("p", { class: "note" }, "⚠ ", t("donneesEnregistrees", { d: new Intl.DateTimeFormat(I.locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(m.copieDu)) })) : null,
          h("p", { class: "source" }, t("sourceMeteo"), " ", A.lienExterne("https://open-meteo.com/", "Open-Meteo")));
      } catch (e) {
        A.vider(corps, A.erreurReseau(e, charger));
      }
    };
    A.quandVisible(bloc, charger);
    return bloc;
  };

  // ---------------------------------------------------------------- climat
  /** Deux petits graphiques (jamais deux axes) : températures et pluie, mois par mois. */
  A.blocClimat = (lat, lon, nom) => {
    const corps = h("div", { class: "climat-corps" }, A.squelette(4));
    const bloc = h("section", { class: "bloc climat", "aria-labelledby": "titre-climat" },
      h("h2", { id: "titre-climat" }, t("quandPartir")),
      nom ? h("p", { class: "sous-titre" }, t("climatDe", { lieu: nom })) : null, corps);
    const charger = async () => {
      A.vider(corps, A.squelette(4));
      try {
        const c = await S.climat(lat, lon);
        if (!c.mensuel.some(Boolean)) throw new Error("vide");
        const meilleurs = O.meilleursMois(c.mensuel);
        const plages = O.plagesMois(meilleurs);
        const texteMois = plages.map(([a, b]) => (a === b ? fmt.mois(a, "long") : fmt.mois(a, "long") + " – " + fmt.mois(b, "long"))).join(", ");
        A.vider(corps,
          h("p", { class: "meilleure-periode" },
            meilleurs.length ? [h("strong", null, t("meilleurePeriode")), " ", texteMois] : t("pasDePeriodeIdeale")),
          graphiqueTemperatures(c.mensuel, new Set(meilleurs)),
          graphiquePluie(c.mensuel),
          h("details", { class: "tableau-climat" },
            h("summary", null, t("voirTableau")),
            h("table", null,
              h("thead", null, h("tr", null, h("th", { scope: "col" }, t("mois")), h("th", { scope: "col" }, t("tMax")), h("th", { scope: "col" }, t("tMin")), h("th", { scope: "col" }, t("pluieMm")))),
              h("tbody", null, c.mensuel.map((m, i) => m && h("tr", null,
                h("th", { scope: "row" }, fmt.mois(i, "long")),
                h("td", null, fmt.temperature(m.max)), h("td", null, fmt.temperature(m.min)),
                h("td", null, fmt.nombre(m.pluie) + " mm")))))),
          h("p", { class: "source" }, t("sourceClimat", { a: c.periode[0], b: c.periode[1] }), " ", A.lienExterne("https://open-meteo.com/en/docs/historical-weather-api", "Open-Meteo (ERA5)")));
      } catch (e) {
        A.vider(corps, A.erreurReseau(e, charger));
      }
    };
    A.quandVisible(bloc, charger);
    return bloc;
  };

  const SVG = "http://www.w3.org/2000/svg";
  const s = (tag, attrs = {}, ...enfants) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    enfants.forEach((e) => e && el.appendChild(typeof e === "string" ? document.createTextNode(e) : e));
    return el;
  };

  /** Barres flottantes min → max par mois, une seule série (titre = légende). */
  function graphiqueTemperatures(mensuel, meilleurs) {
    const L = 360, H = 150, g = 30, d = 6, haut = 12, bas = 22;
    const valeurs = mensuel.filter(Boolean);
    const conv = (c) => (A.prefs.unites === "imperial" ? c * 9 / 5 + 32 : c);
    let vmin = Math.floor(Math.min(...valeurs.map((m) => conv(m.min))) / 5) * 5;
    let vmax = Math.ceil(Math.max(...valeurs.map((m) => conv(m.max))) / 5) * 5;
    if (vmax - vmin < 10) vmax = vmin + 10;
    const y = (v) => haut + (H - haut - bas) * (1 - (v - vmin) / (vmax - vmin));
    const pas = (L - g - d) / 12;
    const svg = s("svg", { viewBox: `0 0 ${L} ${H}`, class: "graphique", role: "img", "aria-label": t("graphTemp") });
    const ticks = [];
    const ecart = (vmax - vmin) / 5 > 8 ? 10 : 5;
    for (let v = vmin; v <= vmax; v += ecart) ticks.push(v);
    ticks.forEach((v) => {
      svg.appendChild(s("line", { x1: g, x2: L - d, y1: y(v), y2: y(v), class: v === 0 && A.prefs.unites !== "imperial" ? "axe" : "grille" }));
      svg.appendChild(s("text", { x: g - 6, y: y(v) + 4, class: "tick", "text-anchor": "end" }, String(v) + "°"));
    });
    const bulle = h("div", { class: "bulle-graph", hidden: true });
    mensuel.forEach((m, i) => {
      const x = g + i * pas;
      svg.appendChild(s("text", { x: x + pas / 2, y: H - 6, class: "tick" + (meilleurs.has(i) ? " fort" : ""), "text-anchor": "middle" }, fmt.mois(i, "narrow")));
      if (!m) return;
      const y1 = y(conv(m.max)), y2 = y(conv(m.min));
      const largeur = Math.max(6, pas - 8);
      const groupe = s("g", { class: "marque" + (meilleurs.has(i) ? " meilleur" : ""), tabindex: "0", role: "img",
        "aria-label": `${fmt.mois(i, "long")} : ${fmt.temperature(m.min)} – ${fmt.temperature(m.max)}` });
      groupe.appendChild(s("rect", { x: x, y: haut, width: pas, height: H - haut - bas, class: "zone-survol" }));
      groupe.appendChild(s("rect", { x: x + (pas - largeur) / 2, y: y1, width: largeur, height: Math.max(3, y2 - y1), rx: 4, class: "barre temp" }));
      const montrer = () => {
        bulle.hidden = false;
        bulle.textContent = `${fmt.mois(i, "long")} · ${fmt.temperature(m.min)} → ${fmt.temperature(m.max)}`;
        bulle.style.insetInlineStart = ((x + pas / 2) / L * 100) + "%";
      };
      groupe.addEventListener("pointerenter", montrer);
      groupe.addEventListener("focus", montrer);
      groupe.addEventListener("pointerleave", () => (bulle.hidden = true));
      groupe.addEventListener("blur", () => (bulle.hidden = true));
      svg.appendChild(groupe);
    });
    return h("figure", { class: "figure-graph" }, h("figcaption", null, t("graphTemp")), h("div", { class: "graph-zone" }, svg, bulle));
  }

  function graphiquePluie(mensuel) {
    const L = 360, H = 120, g = 30, d = 6, haut = 10, bas = 22;
    const vmax = Math.max(20, Math.ceil(Math.max(...mensuel.filter(Boolean).map((m) => m.pluie)) / 20) * 20);
    const y = (v) => haut + (H - haut - bas) * (1 - v / vmax);
    const pas = (L - g - d) / 12;
    const svg = s("svg", { viewBox: `0 0 ${L} ${H}`, class: "graphique", role: "img", "aria-label": t("graphPluie") });
    [0, vmax / 2, vmax].forEach((v) => {
      svg.appendChild(s("line", { x1: g, x2: L - d, y1: y(v), y2: y(v), class: v === 0 ? "axe" : "grille" }));
      svg.appendChild(s("text", { x: g - 6, y: y(v) + 4, class: "tick", "text-anchor": "end" }, fmt.nombre(v)));
    });
    const bulle = h("div", { class: "bulle-graph", hidden: true });
    mensuel.forEach((m, i) => {
      const x = g + i * pas;
      svg.appendChild(s("text", { x: x + pas / 2, y: H - 6, class: "tick", "text-anchor": "middle" }, fmt.mois(i, "narrow")));
      if (!m) return;
      const largeur = Math.max(6, pas - 8);
      const groupe = s("g", { class: "marque", tabindex: "0", role: "img", "aria-label": `${fmt.mois(i, "long")} : ${fmt.nombre(m.pluie)} mm` });
      groupe.appendChild(s("rect", { x, y: haut, width: pas, height: H - haut - bas, class: "zone-survol" }));
      const hauteur = Math.max(1, y(0) - y(m.pluie));
      // Barre ancrée sur l'axe : coins arrondis seulement en haut (chemin dessiné à la main).
      const x0 = x + (pas - largeur) / 2, r = Math.min(4, hauteur, largeur / 2), yb = y(0), yh = yb - hauteur;
      groupe.appendChild(s("path", { class: "barre pluie", d: `M${x0},${yb}V${yh + r}Q${x0},${yh} ${x0 + r},${yh}H${x0 + largeur - r}Q${x0 + largeur},${yh} ${x0 + largeur},${yh + r}V${yb}Z` }));
      const montrer = () => {
        bulle.hidden = false;
        bulle.textContent = `${fmt.mois(i, "long")} · ${fmt.nombre(m.pluie)} mm`;
        bulle.style.insetInlineStart = ((x + pas / 2) / L * 100) + "%";
      };
      groupe.addEventListener("pointerenter", montrer);
      groupe.addEventListener("focus", montrer);
      groupe.addEventListener("pointerleave", () => (bulle.hidden = true));
      groupe.addEventListener("blur", () => (bulle.hidden = true));
      svg.appendChild(groupe);
    });
    return h("figure", { class: "figure-graph" }, h("figcaption", null, t("graphPluie")), h("div", { class: "graph-zone" }, svg, bulle));
  }

  // ---------------------------------------------------------------- découvertes Wikipédia
  A.blocAutour = (lat, lon, { titre, exclure = [], rayon = 10000 } = {}) => {
    const corps = h("div", null, A.squelette(4));
    const bloc = h("section", { class: "bloc autour", "aria-labelledby": "titre-autour" },
      h("h2", { id: "titre-autour" }, titre || t("aDecouvrirAutour")),
      h("p", { class: "sous-titre" }, t("autourExplication", { r: fmt.distance(rayon / 1000) })), corps);
    const charger = async () => {
      A.vider(corps, A.squelette(4));
      const maScene = A.etat.scene;
      try {
        const langue = I.langueWiki();
        let liste = await S.autour(lat, lon, langue, { rayon });
        const exclus = new Set(exclure.map(O.normaliser));
        liste = liste.filter((p) => !exclus.has(O.normaliser(p.titre)));
        // Les articles illustrés sont en général les lieux les plus notables : on les montre d'abord.
        liste.sort((a, b) => (!!b.image - !!a.image) || a.distance - b.distance);
        liste = liste.slice(0, 24);
        if (!liste.length) {
          A.vider(corps, h("p", { class: "note" }, t("rienAutour")));
          return;
        }
        // Seulement si l'utilisateur est resté sur la même page.
        if (A.etat.scene === maScene) A.majScene({ decouvertes: liste.map((p, i) => ({ id: "w" + i, lat: p.lat, lon: p.lon, titre: p.titre, type: "wiki", donnees: p })) });
        A.vider(corps,
          h("ul", { class: "decouvertes", role: "list" }, liste.map((p) =>
            h("li", { class: "decouverte" },
              h("button", { type: "button", class: "decouverte-ouvrir", onclick: () => A.ouvrirFicheWiki(p) },
                p.image ? h("img", { src: p.image, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" }) : h("span", { class: "vignette-vide", "aria-hidden": "true" }, "📍"),
                h("span", { class: "decouverte-texte" },
                  h("span", { class: "site-nom" }, p.titre),
                  h("span", { class: "site-meta" }, fmt.distance(p.distance), p.description ? " · " + p.description : ""))),
              A.boutonEtape({ ref: "w:" + p.langue + ":" + p.titre, nom: p.titre, lat: p.lat, lon: p.lon, duree: 60 })))),
          h("p", { class: "source" }, t("sourceWikipedia"), " ", A.lienExterne(`https://${langue}.wikipedia.org/`, "Wikipédia"), " (CC BY-SA)"));
      } catch (e) {
        A.vider(corps, A.erreurReseau(e, charger));
      }
    };
    A.quandVisible(bloc, charger);
    return bloc;
  };

  A.majScene = (patch) => {
    if (!A.etat.scene) return;
    Object.assign(A.etat.scene, patch, { cadrer: false });
    A.afficherCarte(A.etat.scene);
  };

  function scene(s) {
    A.etat.scene = s;
    return s;
  }

  // ---------------------------------------------------------------- horloge
  function horloge(tz) {
    const el = h("span", { class: "horloge" }, fmt.heure(tz));
    const id = setInterval(() => (el.textContent = fmt.heure(tz)), 15000);
    A.surNettoyage(() => clearInterval(id));
    return el;
  }

  function texteEcart(tz) {
    const e = A.ecartHeures(tz);
    if (!e) return t("memeHeure");
    return t(e > 0 ? "enAvance" : "enRetard", { n: Math.abs(e) });
  }

  // ================================================================== ACCUEIL
  A.route(/^$/, () => {
    const total = A.SITES.length;
    const mobile = !matchMedia("(min-width: 960px)").matches;
    const valeurs = {};
    for (const [c, liste] of A.SITES_PAR_PAYS) valeurs[c] = liste.length;
    const coll = collator();
    let continent = A.stock.lire("continent", null);
    let tri = A.stock.lire("tri", "nom");

    const recherche = h("input", {
      type: "search", id: "recherche", class: "champ-recherche", autocomplete: "off", enterkeyhint: "search",
      placeholder: t("rechercherPlaceholder"), "aria-describedby": "aide-recherche", spellcheck: "false",
    });
    const resultats = h("div", { class: "resultats", id: "resultats", "aria-live": "polite" });
    const grille = h("ul", { class: "grille-pays", role: "list" });
    const elements = window.ATLO_PAYS.map((p) => {
      const nb = valeurs[p.c] || 0;
      const cap = A.capitale(p);
      const li = h("li", { dataset: { code: p.c, continent: p.k } },
        h("a", { href: "#/pays/" + p.c, class: "carte-pays" },
          h("span", { class: "drapeau", "aria-hidden": "true" }, A.drapeau(p.c)),
          h("span", { class: "carte-pays-texte" },
            h("span", { class: "carte-pays-nom" }, A.nomListe(p.n)),
            h("span", { class: "carte-pays-meta" }, cap ? cap.nom : "", nb ? h("span", { class: "nb-sites" }, t("nSites", { n: nb })) : null))));
      li._cle = O.normaliser(p.n.join(" ") + " " + (p.alt || []).join(" ") + " " + (p.cap ? [].concat(p.cap.n).join(" ") : "") + " " + p.c);
      li._nom = A.nomListe(p.n);
      li._nb = nb;
      return li;
    });
    const trier = () => {
      const ordonnes = elements.slice().sort((a, b) => (tri === "sites" ? b._nb - a._nb : 0) || coll.compare(a._nom, b._nom));
      A.vider(grille, ordonnes);
    };
    const filtrer = () => {
      const q = O.normaliser(recherche.value);
      let visibles = 0;
      for (const li of elements) {
        const ok = (!continent || li.dataset.continent === continent) && (!q || li._cle.includes(q));
        li.hidden = !ok;
        if (ok) visibles++;
      }
      compteur.textContent = t("nPays", { n: visibles });
    };
    const compteur = h("p", { class: "compteur" });

    const puces = h("div", { class: "puces", role: "group", "aria-label": t("filtrerContinent") });
    const majPuces = () => A.vider(puces,
      A.puce(t("tousContinents"), { actif: !continent, onclick: () => { continent = null; A.stock.ecrire("continent", null); majPuces(); filtrer(); } }),
      A.CONTINENTS.map((k) => A.puce(t("continent_" + k), {
        actif: continent === k,
        onclick: () => { continent = continent === k ? null : k; A.stock.ecrire("continent", continent); majPuces(); filtrer(); },
      })));
    majPuces();

    const selectTri = h("select", { "aria-label": t("trier"), class: "select-petit", onchange: (e) => { tri = e.target.value; A.stock.ecrire("tri", tri); trier(); filtrer(); } },
      h("option", { value: "nom", selected: tri === "nom" }, t("triNom")),
      h("option", { value: "sites", selected: tri === "sites" }, t("triSites")));

    // Recherche globale : pays, sites, puis villes du monde entier (en ligne).
    let minuteur = null, jeton = 0;
    const chercher = () => {
      filtrer();
      const brut = recherche.value.trim();
      const q = O.normaliser(brut);
      clearTimeout(minuteur);
      if (q.length < 2) { A.vider(resultats); return; }
      const sitesTrouves = A.SITES.map((s) => ({ s, sc: Math.max(O.score(q, O.normaliser(s.fr)), O.score(q, O.normaliser(s.en))) }))
        .filter((x) => x.sc).sort((a, b) => b.sc - a.sc).slice(0, 6).map((x) => x.s);
      const zoneVilles = h("div", null);
      A.vider(resultats,
        sitesTrouves.length ? h("div", { class: "groupe-resultats" },
          h("h3", null, t("sites")),
          h("ul", { class: "sites", role: "list" }, sitesTrouves.map((s) => elementSite(s, { region: A.nomPays(s.paysRegion) })))) : null,
        zoneVilles);
      const moi = ++jeton;
      minuteur = setTimeout(async () => {
        A.vider(zoneVilles, h("h3", null, t("villesMonde")), A.squelette(2));
        try {
          const villes = await S.geocoder(brut, I.langueWiki(), null);
          if (moi !== jeton) return;
          A.vider(zoneVilles, villes.length ? [h("h3", null, t("villesMonde")), h("ul", { class: "liste-lieux", role: "list" }, villes.map(elementVille))] : null);
        } catch (e) {
          if (moi === jeton) A.vider(zoneVilles, navigator.onLine === false ? h("p", { class: "note" }, t("rechercheHorsLigne")) : null);
        }
      }, 350);
    };
    recherche.addEventListener("input", chercher);

    const it = A.itineraire.etat();
    const recents = A.stock.lire("recents", []).filter((c) => A.PAYS.has(c));

    trier();
    filtrer();

    const contenu = h("div", { class: "accueil" },
      h("section", { class: "hero" },
        h("h1", null, h("span", { "aria-hidden": "true" }, "🌍 "), "Atlo"),
        h("p", { class: "accroche" }, t("accroche")),
        h("dl", { class: "stats" },
          h("div", null, h("dt", null, t("statPays")), h("dd", null, fmt.nombre(window.ATLO_PAYS.length))),
          h("div", null, h("dt", null, t("statSites")), h("dd", null, fmt.nombre(total))),
          h("div", null, h("dt", null, t("statItineraire")), h("dd", { id: "stat-itineraire" }, fmt.nombre(it.etapes.length)))),
        h("div", { class: "zone-recherche" },
          h("label", { for: "recherche", class: "visuellement-cache" }, t("rechercher")),
          h("span", { class: "loupe", "aria-hidden": "true" }, "🔎"), recherche),
        h("p", { id: "aide-recherche", class: "aide" }, t("aideRecherche")),
        h("div", { class: "actions-rapides" },
          h("a", { href: "#/autour", class: "bouton principal" }, h("span", { "aria-hidden": "true" }, "📍 "), t("autourDeMoi")),
          h("a", { href: "#/itineraire", class: "bouton" }, h("span", { "aria-hidden": "true" }, "🧭 "), t("monItineraire")),
          h("a", { href: "#/outils", class: "bouton" }, h("span", { "aria-hidden": "true" }, "🧰 "), t("outilsVoyage")))),
      resultats,
      // Sur mobile, la carte du monde vient après la recherche plutôt qu'en haut de l'écran.
      mobile ? h("section", { class: "bloc monde-bloc" }, (() => { const el = h("div"); mondeAccueil(el, valeurs); return el; })()) : null,
      recents.length ? h("section", { class: "bloc" },
        h("h2", null, t("recents")),
        h("div", { class: "puces" }, recents.map((c) => h("a", { href: "#/pays/" + c, class: "puce" }, h("span", { class: "drapeau", "aria-hidden": "true" }, A.drapeau(c)), " ", A.nomPays(c))))) : null,
      h("section", { class: "bloc", "aria-labelledby": "titre-pays" },
        h("div", { class: "titre-ligne" }, h("h2", { id: "titre-pays" }, t("choisirPays")), selectTri),
        puces, compteur, grille),
      h("p", { class: "mention" }, t("mention")));

    return {
      nom: "accueil", titre: t("titreAccueil"), contenu, onglet: "explorer",
      carte: mobile ? null : { monde: (el) => mondeAccueil(el, valeurs) },
    };
  });

  function mondeAccueil(el, valeurs) {
    const etiquette = h("p", { class: "monde-etiquette" }, t("survolPays"));
    const zone = h("div", { class: "monde-zone" });
    A.vider(el,
      h("div", { class: "monde-entete" },
        h("h2", null, h("span", { "aria-hidden": "true" }, "🗺️ "), t("carteSites")),
        h("p", null, t("carteSitesAide"))),
      zone,
      h("div", { class: "legende", role: "group", "aria-label": t("legende") },
        h("span", { class: "legende-titre" }, t("legendeSites")),
        h("ol", { class: "legende-cases" },
          [["0", 0], ["1–2", 1], ["3–5", 2], ["6–10", 3], ["11–20", 4], ["21+", 5]].map(([lib, n]) =>
            h("li", null, h("span", { class: "case niv-" + n, "aria-hidden": "true" }), lib)))),
      etiquette);
    const svg = window.AtloCarte.dessinerMonde(zone, {
      contours: window.ATLO_MONDE, valeurs, seuils: [3, 6, 11, 21], libelle: t("carteSites"),
      nom: (code, v) => A.nomPays(code) + " · " + t("nSites", { n: v }),
    });
    const montrer = (code) => {
      if (!code) { etiquette.textContent = t("survolPays"); return; }
      const v = valeurs[code] || 0;
      etiquette.textContent = "";
      A.vider(etiquette, h("span", { class: "drapeau", "aria-hidden": "true" }, A.drapeau(code)), " ", h("strong", null, A.nomPays(code)), " · ", t("nSites", { n: v }));
    };
    svg.addEventListener("pointerover", (e) => { const a = e.target.closest("a"); montrer(a && a.dataset.code); });
    svg.addEventListener("focusin", (e) => { const a = e.target.closest("a"); montrer(a && a.dataset.code); });
    svg.addEventListener("pointerleave", () => montrer(null));
  }

  function elementVille(v) {
    const q = new URLSearchParams({ n: v.nom });
    if (v.pays) q.set("p", v.pays);
    return h("li", null,
      h("a", { href: `#/lieu/${(+v.lat).toFixed(4)},${(+v.lon).toFixed(4)}?${q}`, class: "lieu" },
        h("span", { class: "drapeau", "aria-hidden": "true" }, v.pays ? A.drapeau(v.pays) : "📍"),
        h("span", { class: "lieu-texte" },
          h("span", { class: "site-nom" }, v.nom),
          h("span", { class: "site-meta" }, [v.region, v.pays ? A.nomPays(v.pays) : ""].filter(Boolean).join(", "),
            v.population ? " · " + t("habitants", { n: fmt.nombre(v.population) }) : ""))));
  }
  A.elementVille = elementVille;

  // ================================================================== PAYS
  A.route(/^pays\/([A-Z]{2})$/, async ([code]) => {
    const p = A.PAYS.get(code);
    if (!p) return A.introuvable();
    const recents = [code, ...A.stock.lire("recents", []).filter((c) => c !== code)].slice(0, 8);
    A.stock.ecrire("recents", recents);
    A.stock.ecrire("dernierPays", code);
    const d = await A.donneesPays(code).catch(() => ({ r: [], v: [] }));
    const sites = A.SITES_PAR_PAYS.get(code) || [];
    const cap = A.capitale(p);
    const tz = (cap && cap.tz) || (p.z && p.z[0]);
    const nomRegion = (s) => (s.paysRegion === code && d.r[s.region] ? A.nomListe(d.r[s.region].n) : s.paysRegion !== code ? A.nomPays(s.paysRegion) : "");

    const contenu = h("div", { class: "page-pays" },
      h("nav", { class: "fil", "aria-label": t("filAriane") },
        h("a", { href: "#/" }, t("explorer")), h("span", { "aria-hidden": "true" }, " › "), h("span", { "aria-current": "page" }, A.nomListe(p.n))),
      h("header", { class: "entete-lieu" },
        h("span", { class: "drapeau grand", "aria-hidden": "true" }, A.drapeau(code)),
        h("div", null,
          h("h1", null, A.nomListe(p.n)),
          h("p", { class: "sous-titre" }, [cap ? t("capitale") + " : " + cap.nom : null, t("continent_" + p.k)].filter(Boolean).join(" · ")))),
      h("div", { class: "actions" },
        h("a", { href: "#/outils?p=" + code, class: "bouton" }, h("span", { "aria-hidden": "true" }, "🧰 "), t("outilsPays")),
        h("button", { type: "button", class: "bouton", onclick: () => A.partager({ titre: A.nomListe(p.n) + " · Atlo", url: location.href }) }, h("span", { "aria-hidden": "true" }, "↗ "), t("partager"))),
      blocInfos(p, tz),
      blocRegions(p, d, sites),
      h("section", { class: "bloc", "aria-labelledby": "titre-sites" },
        h("h2", { id: "titre-sites" }, t("sitesEmblematiques"), " ", h("span", { class: "compte" }, fmt.nombre(sites.length))),
        sites.length ? listeSites(sites, { regionNom: nomRegion }) : h("div", { class: "vide-doux" },
          h("p", null, t("pasDeSites")),
          cap && cap.lat != null ? h("a", { class: "bouton", href: `#/lieu/${cap.lat},${cap.lon}?n=${encodeURIComponent(cap.nom)}&p=${code}` }, t("decouvrirCapitale", { v: cap.nom })) : null)),
      // Météo et climat seulement avec la position réelle de la capitale (jamais le centre du pays).
      cap && cap.lat != null ? A.blocMeteo(cap.lat, cap.lon, { titre: t("meteoA", { v: cap.nom }), fuseau: false }) : null,
      cap && cap.lat != null ? A.blocClimat(cap.lat, cap.lon, cap.nom) : null,
      h("p", { class: "mention" }, t("sourcesPays")));

    return {
      nom: "pays", titre: A.nomListe(p.n), contenu, onglet: "explorer",
      carte: scene({ boite: p.bb, points: sites.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, titre: A.nomSite(s) })), zone: null, decouvertes: [], etapes: [] }),
    };
  });

  function blocInfos(p, tz) {
    const tuiles = [];
    const tuile = (icone, titre, ...valeur) => h("div", { class: "tuile" },
      h("span", { class: "tuile-icone", "aria-hidden": "true" }, icone),
      h("div", null, h("h3", null, titre), h("div", { class: "tuile-valeur" }, ...valeur)));
    if (tz) tuiles.push(tuile("🕒", t("heureLocale"), horloge(tz), h("span", { class: "petit" }, fmt.decalage(tz) + " · " + texteEcart(tz)),
      p.z && p.z.length > 1 ? h("span", { class: "petit" }, t("plusieursFuseaux", { n: p.z.length })) : null));
    if (p.m && p.m.length) {
      const devise = p.m[0];
      const taux = h("span", { class: "petit" });
      tuiles.push(tuile("💱", t("monnaie"), h("span", null, I.nomDevise(devise) + " (" + devise + ")"), taux));
      if (devise !== A.prefs.devise) {
        S.taux().then((tx) => {
          const v = S.convertir(1, A.prefs.devise, devise, tx);
          if (!v) return;
          // Toujours un chiffre lisible : « 1 € = 151 DZD » plutôt que « 1 DZD = 0,01 € ».
          const texte = v >= 1 ? "1 " + A.prefs.devise + " = " + fmt.argent(v, devise) : "1 " + devise + " = " + fmt.argent(1 / v, A.prefs.devise);
          taux.textContent = texte + (tx.horsLigne ? " · " + t("tauxHorsLigne") : "");
        }).catch(() => {});
      }
    }
    if (p.l && p.l.length) tuiles.push(tuile("🗣️", t("langues"), p.l.slice(0, 4).map((l) => I.nomLangue(l)).join(", "),
      h("a", { href: "#/outils?p=" + p.c + "#phrases", class: "petit" }, t("phrasesUtiles"))));
    if (p.t) tuiles.push(tuile("📞", t("indicatif"), p.t));
    tuiles.push(tuile(p.g ? "⬅️" : "➡️", t("conduite"), p.g ? t("aGauche") : t("aDroite")));
    if (p.p) {
      const maison = A.PAYS.get(A.prefs.residence);
      let statut = null;
      if (maison && maison.p && maison.c !== p.c) {
        const communs = maison.p.split(" ").filter((x) => p.p.split(" ").includes(x));
        const tension = Math.abs((maison.v || 230) - (p.v || 230)) > 30;
        statut = communs.length && !tension ? h("span", { class: "statut bon" }, "✓ " + t("compatibleAvec", { pays: A.nomPays(maison.c) }))
          : h("span", { class: "statut attention" }, "⚠ " + (tension ? t("tensionDifferente") : t("adaptateurNecessaire")));
      }
      tuiles.push(tuile("🔌", t("prises"), t("types") + " " + p.p.split(" ").join(", ") + " · " + p.v + " V", statut));
    }
    tuiles.push(blocUrgences(p, tuile));
    return h("section", { class: "bloc", "aria-labelledby": "titre-infos" }, h("h2", { id: "titre-infos" }, t("infosPratiques")), h("div", { class: "tuiles" }, tuiles));
  }

  function blocUrgences(p, tuile) {
    const u = p.u;
    if (!u) return tuile("🆘", t("urgences"), h("span", { class: "petit" }, t("urgencesInconnues")));
    const lignes = [["g", t("urgGeneral")], ["p", t("urgPolice")], ["a", t("urgAmbulance")], ["f", t("urgPompiers")], ["t", t("urgTouristes")]]
      .filter(([k]) => u[k]);
    const vus = new Set();
    return tuile("🆘", t("urgences"), h("ul", { class: "urgences" }, lignes.map(([k, lib]) => {
      const cle = k + u[k];
      if (vus.has(cle)) return null;
      vus.add(cle);
      return h("li", null, h("a", { href: "tel:" + u[k], class: "tel" }, u[k]), " ", lib);
    })));
  }
  A.blocUrgences = blocUrgences;

  function blocRegions(p, d, sites) {
    const coll = collator();
    const compte = new Map();
    sites.forEach((s) => { if (s.paysRegion === p.c && s.region >= 0) compte.set(s.region, (compte.get(s.region) || 0) + 1); });
    const regions = d.r.slice().sort((a, b) => coll.compare(A.nomListe(a.n), A.nomListe(b.n)));
    const champ = h("input", { type: "search", class: "champ", placeholder: t("chercherRegionVille"), "aria-label": t("chercherRegionVille"), autocomplete: "off" });
    const listeR = h("ul", { class: "regions", role: "list" });
    const villes = d.v.slice().sort((a, b) => b.pop - a.pop);
    const listeV = h("ul", { class: "liste-lieux", role: "list" });
    const enLigne = h("div");
    const lienVille = (v) => A.elementVille({ nom: A.nomListe(v.n), lat: v.lat, lon: v.lon, pays: p.c, region: d.r[v.region] ? A.nomListe(d.r[v.region].n) : "", population: v.pop });
    let minuteur = null, jeton = 0;
    const dessiner = () => {
      const q = O.normaliser(champ.value);
      const rs = regions.filter((r) => !q || O.normaliser([].concat(r.n).join(" ")).includes(q));
      A.vider(listeR, rs.map((r) => h("li", null,
        h("a", { href: `#/pays/${p.c}/r/${r.i}`, class: "region" },
          h("span", null, A.nomListe(r.n)),
          compte.get(r.i) ? h("span", { class: "puce-compte", title: t("nSites", { n: compte.get(r.i) }) }, compte.get(r.i)) : null))));
      const vs = (q ? villes.filter((v) => O.normaliser([].concat(v.n).join(" ")).includes(q)) : villes).slice(0, q ? 12 : 8);
      A.vider(listeV, vs.map(lienVille));
      clearTimeout(minuteur);
      A.vider(enLigne);
      if (q.length >= 3 && vs.length < 3) {
        const moi = ++jeton;
        minuteur = setTimeout(async () => {
          try {
            const r = await S.geocoder(champ.value.trim(), I.langueWiki(), p.c);
            if (moi === jeton && r.length) A.vider(enLigne, h("h3", null, t("autresLieux")), h("ul", { class: "liste-lieux", role: "list" }, r.map(A.elementVille)));
          } catch (e) { /* hors ligne : on garde les résultats locaux */ }
        }, 350);
      }
    };
    champ.addEventListener("input", dessiner);
    dessiner();
    return h("section", { class: "bloc", "aria-labelledby": "titre-regions" },
      h("h2", { id: "titre-regions" }, t("choisirRegion"), " ", h("span", { class: "compte" }, fmt.nombre(regions.length))),
      champ,
      regions.length ? listeR : h("p", { class: "note" }, t("pasDeRegions")),
      h("h3", null, t("grandesVilles")), listeV, enLigne);
  }

  // ================================================================== RÉGION
  A.route(/^pays\/([A-Z]{2})\/r\/(\d+)$/, async ([code, idx]) => {
    const p = A.PAYS.get(code);
    if (!p) return A.introuvable();
    const d = await A.donneesPays(code);
    const r = d.r[Number(idx)];
    if (!r) return A.introuvable();
    const nom = A.nomListe(r.n);
    const sites = (A.SITES_PAR_PAYS.get(code) || []).filter((s) => s.paysRegion === code && s.region === r.i);
    const villes = d.v.filter((v) => v.region === r.i).sort((a, b) => a.cls - b.cls || b.pop - a.pop);
    const centre = villes[0] ? { lat: villes[0].lat, lon: villes[0].lon, nom: A.nomListe(villes[0].n) } : { lat: r.lat, lon: r.lon, nom };
    const tz = (villes[0] && villes[0].tz) || (p.z && p.z[0]);

    const contenu = h("div", { class: "page-region" },
      h("nav", { class: "fil", "aria-label": t("filAriane") },
        h("a", { href: "#/" }, t("explorer")), h("span", { "aria-hidden": "true" }, " › "),
        h("a", { href: "#/pays/" + code }, A.nomListe(p.n)), h("span", { "aria-hidden": "true" }, " › "),
        h("span", { "aria-current": "page" }, nom)),
      h("header", { class: "entete-lieu" },
        h("span", { class: "drapeau grand", "aria-hidden": "true" }, A.drapeau(code)),
        h("div", null, h("h1", null, nom), h("p", { class: "sous-titre" }, A.nomListe(p.n), tz ? [" · ", horloge(tz), " (" + fmt.decalage(tz) + ")"] : null))),
      h("section", { class: "bloc", "aria-labelledby": "titre-sites" },
        h("h2", { id: "titre-sites" }, t("sitesEmblematiques"), " ", h("span", { class: "compte" }, fmt.nombre(sites.length))),
        sites.length ? listeSites(sites) : h("p", { class: "note" }, t("pasDeSitesRegion"))),
      villes.length ? h("section", { class: "bloc", "aria-labelledby": "titre-villes" },
        h("h2", { id: "titre-villes" }, t("villes")),
        h("ul", { class: "liste-lieux", role: "list" }, villes.slice(0, 12).map((v) =>
          A.elementVille({ nom: A.nomListe(v.n), lat: v.lat, lon: v.lon, pays: code, region: nom, population: v.pop })))) : null,
      A.blocAutour(centre.lat, centre.lon, { titre: t("aDecouvrirA", { v: centre.nom }), exclure: [centre.nom, nom] }),
      A.blocMeteo(centre.lat, centre.lon, { titre: t("meteoA", { v: centre.nom }), fuseau: false }),
      A.blocClimat(centre.lat, centre.lon, centre.nom));

    return {
      nom: "region", titre: nom + " · " + A.nomListe(p.n), contenu, onglet: "explorer",
      carte: scene({ boite: r.bb, zone: A.anneauxRegion(r), points: sites.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, titre: A.nomSite(s) })), decouvertes: [], etapes: [] }),
    };
  });

  // ================================================================== LIEU
  async function vueLieu(lat, lon, { nom, pays, utilisateur, precision } = {}) {
    const loc = !pays ? await A.localiser(lat, lon).catch(() => null) : { pays, region: -1 };
    const code = loc && loc.pays;
    const p = code && A.PAYS.get(code);
    let regionNom = "", villeProche = null;
    if (p) {
      const d = await A.donneesPays(code).catch(() => null);
      if (d) {
        if (loc.region < 0) {
          const r = d.r.find((r) => {
            const [w, s, e, n] = r.bb;
            return lat >= s && lat <= n && lon >= w && lon <= e && O.pointDansAnneaux(lon, lat, A.anneauxRegion(r));
          });
          if (r) loc.region = r.i;
        }
        if (d.r[loc.region]) regionNom = A.nomListe(d.r[loc.region].n);
        let dmin = Infinity;
        for (const v of d.v) {
          const k = O.distanceKm(lat, lon, v.lat, v.lon);
          if (k < dmin) { dmin = k; villeProche = { nom: A.nomListe(v.n), km: k, tz: v.tz }; }
        }
      }
    }
    const titre = nom || (villeProche && villeProche.km < 15 ? villeProche.nom : t("positionActuelle"));
    const proches = A.SITES.map((s) => ({ s, k: O.distanceKm(lat, lon, s.lat, s.lon) })).filter((x) => x.k <= 250).sort((a, b) => a.k - b.k).slice(0, 15);
    const distances = new Map(proches.map((x) => [x.s.id, x.k]));
    const tz = villeProche ? villeProche.tz : p && p.z && p.z[0];
    const etape = { ref: `l:${(+lat).toFixed(4)},${(+lon).toFixed(4)}`, nom: titre, lat, lon, pays: code || "", duree: 120 };

    const contenu = h("div", { class: "page-lieu" },
      h("nav", { class: "fil", "aria-label": t("filAriane") },
        h("a", { href: "#/" }, t("explorer")),
        p ? [h("span", { "aria-hidden": "true" }, " › "), h("a", { href: "#/pays/" + code }, A.nomListe(p.n))] : null,
        h("span", { "aria-hidden": "true" }, " › "), h("span", { "aria-current": "page" }, titre)),
      h("header", { class: "entete-lieu" },
        h("span", { class: "drapeau grand", "aria-hidden": "true" }, code ? A.drapeau(code) : "📍"),
        h("div", null,
          h("h1", null, titre),
          h("p", { class: "sous-titre" }, [regionNom, p ? A.nomListe(p.n) : ""].filter(Boolean).join(", "),
            tz ? [" · ", horloge(tz), " (" + fmt.decalage(tz) + ")"] : null),
          utilisateur ? h("p", { class: "petit" }, t("precisionGps", { m: fmt.nombre(Math.round(precision || 0)) })) : null)),
      h("div", { class: "actions" },
        A.boutonEtape(etape, { libelle: true }),
        A.lienExterne(A.liens.itineraire(lat, lon), h("span", { "aria-hidden": "true" }, "🚗 "), t("yAller")),
        h("button", { type: "button", class: "bouton", onclick: () => A.partager({ titre, url: location.origin + location.pathname + `#/lieu/${(+lat).toFixed(4)},${(+lon).toFixed(4)}?n=${encodeURIComponent(titre)}${code ? "&p=" + code : ""}` }) },
          h("span", { "aria-hidden": "true" }, "↗ "), t("partager"))),
      proches.length ? h("section", { class: "bloc", "aria-labelledby": "titre-proches" },
        h("h2", { id: "titre-proches" }, t("sitesProches")),
        listeSites(proches.map((x) => x.s), { distances, regionNom: (s) => A.nomPays(s.paysRegion) })) : null,
      A.blocAutour(lat, lon, { exclure: [titre] }),
      A.blocMeteo(lat, lon, { fuseau: false }),
      A.blocClimat(lat, lon, titre));

    return {
      nom: "lieu", titre, contenu, onglet: utilisateur ? "autour" : "explorer",
      carte: scene({
        centre: { lat, lon }, zoom: 11, utilisateur: utilisateur ? { lat, lon } : null,
        points: proches.map((x) => ({ id: x.s.id, lat: x.s.lat, lon: x.s.lon, titre: A.nomSite(x.s) })), decouvertes: [], etapes: [],
      }),
    };
  }

  A.route(/^lieu\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/, ([lat, lon], params) => {
    const la = Number(lat), lo = Number(lon);
    if (Math.abs(la) > 90 || Math.abs(lo) > 180) return A.introuvable();
    const pays = params.get("p");
    return vueLieu(la, lo, { nom: params.get("n") || "", pays: A.PAYS.has(pays) ? pays : null });
  });

  // ================================================================== AUTOUR DE MOI
  A.route(/^autour$/, async () => {
    const zone = h("div", { class: "page-autour" },
      h("h1", null, t("autourDeMoi")),
      h("p", { class: "sous-titre" }, t("autourIntro")),
      h("div", { class: "chargement" }, h("span", { class: "spinner", "aria-hidden": "true" }), t("recherchePosition")));
    const essayer = async () => {
      try {
        const pos = await A.position();
        if (!location.hash.startsWith("#/autour")) return;
        const r = await vueLieu(pos.lat, pos.lon, { utilisateur: true, precision: pos.precision });
        A.vider(document.getElementById("vue"), r.contenu);
        document.title = r.titre + " · Atlo";
        A.afficherCarte(r.carte);
      } catch (e) {
        A.vider(zone,
          h("h1", null, t("autourDeMoi")),
          h("div", { class: "vide-doux" },
            h("p", null, h("span", { "aria-hidden": "true" }, "📍 "), e.message),
            h("p", { class: "note" }, t("autourAstuce")),
            h("div", { class: "actions" },
              h("button", { type: "button", class: "bouton principal", onclick: () => { A.vider(zone, h("div", { class: "chargement" }, h("span", { class: "spinner", "aria-hidden": "true" }), t("recherchePosition"))); essayer(); } }, t("reessayer")),
              h("a", { href: "#/", class: "bouton" }, t("chercherVille")))));
      }
    };
    return { nom: "autour", titre: t("autourDeMoi"), contenu: zone, onglet: "autour", carte: null, apres: essayer };
  });

  // ================================================================== SITE (lien direct)
  A.route(/^site\/([a-z0-9-]+)$/, async ([id]) => {
    const s = A.SITE.get(id);
    if (!s) return A.introuvable();
    const vue = await A.routeVue("pays/" + s.paysRegion);
    const apres = vue.apres;
    vue.apres = () => { if (apres) apres(); A.ouvrirFiche(id, { remplacer: "#/pays/" + s.paysRegion }); };
    return vue;
  });
  A.routeVue = async (chemin) => {
    for (const r of A.routesListe()) {
      const m = chemin.match(r.motif);
      if (m) return r.vue(m.slice(1), new URLSearchParams());
    }
    return A.introuvable();
  };

  A.introuvable = () => ({
    nom: "introuvable", titre: t("introuvable"), carte: null,
    contenu: h("section", { class: "bloc vide-doux" }, h("h1", null, t("introuvable")), h("p", null, t("introuvableTexte")), h("a", { href: "#/", class: "bouton principal" }, t("retourAccueil"))),
  });

  // ================================================================== FICHE
  const dialogue = () => document.getElementById("fiche");

  function ouvrirDialogue(contenu, etiquette) {
    const d = dialogue();
    A.vider(d.querySelector(".fiche-corps"), contenu);
    d.setAttribute("aria-label", etiquette);
    if (!d.open) {
      if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    }
    d.querySelector(".fiche-corps").scrollTop = 0;
  }

  A.ouvrirFiche = (id, { remplacer } = {}) => {
    const s = A.SITE.get(id);
    if (!s) return;
    if (remplacer) history.replaceState(null, "", remplacer);
    const nom = A.nomSite(s);
    const pays = A.PAYS.get(s.paysRegion);
    const image = h("div", { class: "fiche-image" }, h("span", { class: "fiche-image-icone", "aria-hidden": "true" }, A.CATEGORIES[s.cat].icone));
    const resume = h("div", { class: "fiche-resume" }, A.squelette(5));
    const coords = { lat: s.lat, lon: s.lon };
    const lienAller = A.lienExterne(A.liens.itineraire(s.lat, s.lon), h("span", { "aria-hidden": "true" }, "🚗 "), t("yAller"));
    const lienCarte = A.lienExterne(A.liens.osm(s.lat, s.lon), h("span", { "aria-hidden": "true" }, "🗺️ "), "OpenStreetMap");
    const lienWiki = h("span");
    const recherche = s.en + " " + (pays ? pays.n[1] : "");
    const meteo = h("p", { class: "fiche-meteo" });

    A.majScene({ choisi: id });
    A.focaliserCarte(s.lat, s.lon, 13);

    ouvrirDialogue([
      image,
      h("div", { class: "fiche-texte" },
        h("p", { class: "fiche-cat" }, libelleCategorie(s.cat), s.unesco ? h("span", { class: "badge-unesco" }, "UNESCO") : null),
        h("h2", { id: "fiche-titre", class: "fiche-titre" }, nom),
        h("p", { class: "sous-titre" }, h("span", { class: "drapeau", "aria-hidden": "true" }, A.drapeau(s.paysRegion)), " ", s.pays.map(A.nomPays).join(" · ")),
        meteo,
        h("div", { class: "actions" }, A.boutonEtape(A.etapeDeSite(s), { libelle: true }), lienAller,
          h("button", { type: "button", class: "bouton", onclick: () => A.partager({ titre: nom, url: location.origin + location.pathname + "#/site/" + s.id }) }, h("span", { "aria-hidden": "true" }, "↗ "), t("partager"))),
        resume,
        h("h3", null, t("voirPlus")),
        h("ul", { class: "liens-externes" },
          h("li", null, lienWiki),
          h("li", null, A.lienExterne(A.liens.photos(s.en), h("span", { "aria-hidden": "true" }, "📷 "), t("photos"))),
          h("li", null, A.lienExterne(A.liens.videos(recherche), h("span", { "aria-hidden": "true" }, "▶️ "), t("videos"))),
          s.unesco ? h("li", null, A.lienExterne(A.liens.unesco(s.unesco), h("span", { "aria-hidden": "true" }, "🏛️ "), t("ficheUnesco"))) : null,
          h("li", null, lienCarte)),
        h("p", { class: "coordonnees" }, h("button", { type: "button", class: "lien", onclick: () => A.copier(`${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`) }, "📌 " + coords.lat.toFixed(4) + ", " + coords.lon.toFixed(4))),
        h("p", { class: "mention" }, t("mentionExterne"))),
    ], nom);

    S.resume({ fr: s.wfr, en: s.wen, recherche: s.en }, I.langueWiki()).then((r) => {
      if (!r) { A.vider(resume, h("p", { class: "note" }, t("pasDeResume"))); return; }
      A.vider(resume, h("p", null, r.extrait), h("p", { class: "source" }, t("sourceWikipedia"), " ", A.lienExterne(r.url, "Wikipédia"), " (CC BY-SA)"));
      A.vider(lienWiki, A.lienExterne(r.url, h("span", { "aria-hidden": "true" }, "📖 "), t("articleWikipedia")));
      if (r.image) {
        // Vignettes Wikimedia aux largeurs standard (500 et 960 px) ; repli sur la vignette d'origine.
        const taille = (l) => r.image.replace(/\/(\d+)px-/, "/" + l + "px-");
        const img = h("img", {
          src: taille(500), srcset: /\/\d+px-/.test(r.image) ? `${taille(500)} 500w, ${taille(960)} 960w` : null,
          sizes: "(max-width: 640px) 100vw, 560px", alt: nom, decoding: "async", referrerpolicy: "no-referrer",
        });
        img.addEventListener("error", () => { img.removeAttribute("srcset"); img.src = r.image; }, { once: true });
        image.classList.add("avec-image");
        A.vider(image, img, h("span", { class: "credit" }, "Wikimedia Commons"));
      }
      // Coordonnées Wikipédia : plus précises que notre point quand l'écart reste faible.
      if (r.coords && O.distanceKm(s.lat, s.lon, r.coords.lat, r.coords.lon) < 30) {
        coords.lat = r.coords.lat; coords.lon = r.coords.lon;
        lienAller.href = A.liens.itineraire(coords.lat, coords.lon);
        lienCarte.href = A.liens.osm(coords.lat, coords.lon);
      }
    }).catch(() => A.vider(resume, A.erreurReseau(null)));

    S.meteo(s.lat, s.lon).then((m) => {
      const [cle, icone] = O.meteoWmo(m.actuel.code, m.actuel.jour);
      A.vider(meteo, icone + " " + fmt.temperature(m.actuel.t) + " · " + t("wmo_" + cle) + " · ", t("heureLocale").toLowerCase() + " " + fmt.heure(m.fuseau));
    }).catch(() => {});
  };

  /** Fiche d'un article Wikipédia trouvé autour d'un point. */
  A.ouvrirFicheWiki = (p) => {
    const resume = h("div", { class: "fiche-resume" }, A.squelette(4));
    const image = h("div", { class: "fiche-image" + (p.image ? " avec-image" : "") },
      p.image ? h("img", { src: p.image, alt: p.titre, decoding: "async", referrerpolicy: "no-referrer" }) : h("span", { class: "fiche-image-icone", "aria-hidden": "true" }, "📍"));
    A.focaliserCarte(p.lat, p.lon, 15);
    ouvrirDialogue([
      image,
      h("div", { class: "fiche-texte" },
        h("p", { class: "fiche-cat" }, "📖 ", t("decouverte")),
        h("h2", { class: "fiche-titre" }, p.titre),
        p.distance != null ? h("p", { class: "sous-titre" }, t("aDistance", { d: fmt.distance(p.distance) })) : null,
        h("div", { class: "actions" },
          A.boutonEtape({ ref: "w:" + p.langue + ":" + p.titre, nom: p.titre, lat: p.lat, lon: p.lon, duree: 60 }, { libelle: true }),
          A.lienExterne(A.liens.itineraire(p.lat, p.lon), h("span", { "aria-hidden": "true" }, "🚗 "), t("yAller"))),
        resume,
        h("ul", { class: "liens-externes" },
          h("li", null, A.lienExterne(p.url, h("span", { "aria-hidden": "true" }, "📖 "), t("articleWikipedia"))),
          h("li", null, A.lienExterne(A.liens.photos(p.titre), h("span", { "aria-hidden": "true" }, "📷 "), t("photos")))),
        h("p", { class: "mention" }, t("mentionExterne"))),
    ], p.titre);
    S.resume({ titre: p.titre, langueTitre: p.langue }, p.langue)
      .then((r) => A.vider(resume, r ? [h("p", null, r.extrait), h("p", { class: "source" }, t("sourceWikipedia"), " (CC BY-SA)")] : h("p", { class: "note" }, t("pasDeResume"))))
      .catch(() => A.vider(resume, A.erreurReseau(null)));
  };

  A.surPointCarte = (type, id, props) => {
    if (type === "site") A.ouvrirFiche(id);
    else if (type === "wiki") {
      const p = (A.etat.scene && (A.etat.scene.decouvertes || []).find((x) => x.id === id)) || null;
      if (p && p.donnees) A.ouvrirFicheWiki(p.donnees);
    } else if (type === "etape") {
      const el = document.querySelector(`[data-etape="${CSS.escape(String(id))}"]`);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("eclair"); setTimeout(() => el.classList.remove("eclair"), 1200); }
    }
  };
})();
