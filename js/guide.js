/* Atlo · guides de ville et hébergement.
   - Guides (premier : Béjaïa) : incontournables classés, hébergements avec réservation pré-remplie,
     itinéraires prêts à charger, infos pratiques. Données : data/guides.js (index, chargé au
     démarrage) et data/guides/<id>.js (chargé à la demande).
   - « Où dormir » partout dans le monde : établissements OpenStreetMap autour d'un lieu et
     recherche pré-remplie (dates, voyageurs) sur les plateformes de réservation. */
(function () {
  "use strict";
  const A = window.Atlo;
  const { h, t, fmt, O, S, I } = A;

  /** Texte multilingue { fr, en, es, ar } → langue de l'interface, repli anglais puis français. */
  const tx = (v) => (v == null ? "" : typeof v === "string" ? v : v[I.langue] || v.en || v.fr || "");
  A.tx = tx;

  const PARTENAIRES = window.ATLO_PARTENAIRES || {};
  const affilie = Object.entries(PARTENAIRES).some(([k, v]) => (k === "enveloppes" ? Object.values(v || {}).some(Boolean) : !!v));
  const moisAnnee = (iso) => {
    const [a, m] = String(iso || "").split("-").map(Number);
    return a && m ? new Intl.DateTimeFormat(I.locale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(a, m - 1, 15))) : "";
  };

  // ================================================================== index et chargement
  A.GUIDES = new Map((window.ATLO_GUIDES || []).map((g) => [g.id, g]));
  A.guidesDuPays = (code) => [...A.GUIDES.values()].filter((g) => g.pays === code);
  A.guideDeRegion = (code, i) => [...A.GUIDES.values()].find((g) => g.pays === code && g.region === i) || null;

  const contenus = new Map();
  const chargements = new Map();
  window.atloGuide = (g) => {
    g.sites.forEach((s, i) => { s.rang = i + 1; s.lat = s.ll[0]; s.lon = s.ll[1]; });
    g.site = new Map(g.sites.map((s) => [s.id, s]));
    g.hebergements.forEach((x) => { x.source = "selection"; });
    contenus.set(g.id, g);
  };
  A.chargerGuide = (id) => {
    if (contenus.has(id)) return Promise.resolve(contenus.get(id));
    if (!A.GUIDES.has(id)) return Promise.reject(new Error("guide inconnu : " + id));
    if (!chargements.has(id)) {
      const p = A.chargerScript(`data/guides/${id}.js`).then(() => {
        if (!contenus.has(id)) throw new Error("guide illisible : " + id);
        return contenus.get(id);
      });
      p.catch(() => chargements.delete(id));
      chargements.set(id, p);
    }
    return chargements.get(id);
  };

  /** Recherche dans l'index des guides (sans charger les guides) : villes et incontournables. */
  A.chercherGuides = (q) => {
    const res = [];
    for (const g of A.GUIDES.values()) {
      const sc = Math.max(...[...Object.values(g.nom), ...(g.alt || [])].map((n) => O.score(q, O.normaliser(n))));
      if (sc) res.push({ sc: sc + 5, g });
      for (const [id, ...noms] of g.sites || []) {
        const s = Math.max(...noms.filter(Boolean).map((n) => O.score(q, O.normaliser(n))));
        if (s) res.push({ sc: s, g, site: { id, nom: noms[{ fr: 0, en: 1, es: 1, ar: 2 }[I.langue]] || noms[1] || noms[0] } });
      }
    }
    return res.sort((a, b) => b.sc - a.sc).slice(0, 8);
  };

  // ================================================================== favoris
  const abonnesFavoris = new Set();
  A.favoris = {
    liste: () => A.stock.lire("favoris", []),
    a: (cle) => A.favoris.liste().includes(cle),
    basculer(cle) {
      const l = A.favoris.liste();
      const i = l.indexOf(cle);
      if (i >= 0) l.splice(i, 1); else l.unshift(cle);
      A.stock.ecrire("favoris", l.slice(0, 500));
      for (const a of [...abonnesFavoris]) {
        if (a.el && !a.el.isConnected) { abonnesFavoris.delete(a); continue; }
        try { a.f(); } catch (e) { console.error(e); }
      }
      return i < 0;
    },
    ecouter: (f, el) => abonnesFavoris.add({ f, el }),
  };

  function boutonFavori(cle, nom) {
    const b = h("button", { type: "button", class: "bouton-icone favori" });
    const maj = () => {
      const oui = A.favoris.a(cle);
      b.setAttribute("aria-pressed", oui ? "true" : "false");
      b.setAttribute("aria-label", t(oui ? "retirerFavori" : "ajouterFavori") + " : " + nom);
      b.title = t(oui ? "retirerFavori" : "ajouterFavori");
      A.vider(b, h("span", { "aria-hidden": "true" }, oui ? "♥" : "♡"));
    };
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const oui = A.favoris.basculer(cle);
      A.toast(t(oui ? "favoriAjoute" : "favoriRetire", { nom }));
    });
    maj();
    A.favoris.ecouter(maj, b);
    return b;
  }

  // ================================================================== séjour (dates et voyageurs)
  const aujourdhui = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  };
  function lireSejour() {
    const s = Object.assign({ arrivee: "", depart: "", adultes: 2, chambres: 1 }, A.stock.lire("sejour", {}));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.arrivee) || s.arrivee < aujourdhui()) { s.arrivee = ""; s.depart = ""; }
    if (s.arrivee && !O.nuits(s.arrivee, s.depart)) s.depart = O.decalerDate(s.arrivee, 1);
    s.adultes = Math.min(16, Math.max(1, Math.round(Number(s.adultes)) || 2));
    s.chambres = Math.min(8, Math.max(1, Math.round(Number(s.chambres)) || 1));
    return s;
  }
  const sejour = lireSejour();
  const abonnesSejour = new Set();
  function majSejour(patch) {
    Object.assign(sejour, patch);
    A.stock.ecrire("sejour", sejour);
    for (const a of [...abonnesSejour]) {
      if (!a.el.isConnected) { abonnesSejour.delete(a); continue; }
      try { a.f(); } catch (e) { console.error(e); }
    }
  }
  const ecouterSejour = (f, el) => abonnesSejour.add({ f, el });

  function resumeSejour() {
    const n = O.nuits(sejour.arrivee, sejour.depart);
    const parts = [];
    if (n) {
      const f = new Intl.DateTimeFormat(I.locale(), { day: "numeric", month: "short", timeZone: "UTC" });
      const d1 = new Date(sejour.arrivee + "T12:00:00Z"), d2 = new Date(sejour.depart + "T12:00:00Z");
      parts.push(f.formatRange ? f.formatRange(d1, d2) : f.format(d1) + " – " + f.format(d2), t("nNuits", { n }));
    } else {
      parts.push(t("datesLibres"));
    }
    parts.push(t("nAdultes", { n: sejour.adultes }), t("nChambres", { n: sejour.chambres }));
    return parts.join(" · ");
  }

  function compteur(libelle, valeur, min, max, changer) {
    let v = valeur;
    const sortie = h("output", { class: "compteur-valeur" }, String(v));
    const moins = h("button", { type: "button", class: "bouton-icone", "aria-label": t("moins") + " : " + libelle }, "−");
    const plus = h("button", { type: "button", class: "bouton-icone", "aria-label": t("plus") + " : " + libelle }, "+");
    const maj = () => { sortie.textContent = fmt.nombre(v); moins.disabled = v <= min; plus.disabled = v >= max; };
    moins.addEventListener("click", () => { if (v > min) { v--; maj(); changer(v); } });
    plus.addEventListener("click", () => { if (v < max) { v++; maj(); changer(v); } });
    maj();
    return h("div", { class: "compteur-champ", role: "group", "aria-label": libelle },
      h("span", { class: "compteur-libelle" }, libelle), h("span", { class: "compteur-boutons" }, moins, sortie, plus));
  }

  /** Formulaire « Votre séjour » (dates, voyageurs, chambres), mémorisé sur l'appareil. */
  function blocSejour(ctx) {
    const min = aujourdhui();
    const arrivee = h("input", { type: "date", class: "champ", id: "sejour-arrivee", min, value: sejour.arrivee });
    const depart = h("input", { type: "date", class: "champ", id: "sejour-depart", min: O.decalerDate(sejour.arrivee || min, 1), value: sejour.depart });
    arrivee.addEventListener("change", () => {
      const a = arrivee.value && arrivee.value >= min ? arrivee.value : "";
      let d = depart.value;
      if (a && (!d || d <= a)) d = O.decalerDate(a, 1);
      depart.min = O.decalerDate(a || min, 1);
      arrivee.value = a;
      depart.value = a ? d : "";
      majSejour({ arrivee: a, depart: a ? d : "" });
    });
    depart.addEventListener("change", () => {
      let d = depart.value;
      let a = sejour.arrivee;
      if (d && !a) { a = O.decalerDate(d, -1) >= min ? O.decalerDate(d, -1) : ""; arrivee.value = a; }
      if (!O.nuits(a, d)) d = a ? O.decalerDate(a, 1) : "";
      depart.value = d;
      majSejour({ arrivee: a, depart: d });
    });
    const resume = h("p", { class: "sejour-resume", "aria-live": "polite" });
    const liens = h("div", { class: "actions sejour-liens" });
    const majTout = () => {
      resume.textContent = resumeSejour();
      A.vider(liens, liensVille(ctx));
    };
    majTout();
    ecouterSejour(majTout, resume);
    return h("section", { class: "bloc sejour", id: "sejour", "aria-labelledby": "titre-sejour" },
      h("h2", { id: "titre-sejour" }, h("span", { "aria-hidden": "true" }, "📅 "), t("votreSejour")),
      h("div", { class: "sejour-champs" },
        h("label", { class: "champ-groupe" }, h("span", null, t("arrivee")), arrivee),
        h("label", { class: "champ-groupe" }, h("span", null, t("depart")), depart),
        compteur(t("voyageurs"), sejour.adultes, 1, 16, (v) => majSejour({ adultes: v, chambres: Math.min(sejour.chambres, v) })),
        compteur(t("chambres"), sejour.chambres, 1, 8, (v) => majSejour({ chambres: v }))),
      resume, liens,
      h("p", { class: "petit" }, t("sejourAide")));
  }

  // ================================================================== liens de réservation
  const ICONES_HEB = { hotel: "🏨", motel: "🛣️", hostel: "🎒", guest_house: "🏡", apartment: "🏢", resort: "🏖️", camping: "⛺", other: "🛏️" };
  const AVEC_AIRBNB = new Set(["apartment", "guest_house", "other"]);

  function liensDe(ctx, x) {
    const r = ctx.reservation || {};
    const cible = x
      ? { requete: [x.n, x.lieu || ctx.nom].filter(Boolean).join(", "), lieu: r.lieu || ctx.nom, ficheBooking: x.booking, tripadvisor: r.tripadvisor, airbnb: r.airbnb }
      : { requete: r.lieu || ctx.nom, lieu: r.lieu || ctx.nom, expedia: r.expedia, tripadvisor: r.tripadvisor, airbnb: r.airbnb };
    return O.liensReservation(cible, sejour, PARTENAIRES, I.langue);
  }

  /** Boutons de recherche à l'échelle de la ville (dates et voyageurs compris). */
  function liensVille(ctx) {
    const l = liensDe(ctx, null);
    const par = Object.fromEntries(l.map((x) => [x.id, x]));
    return [
      A.lienExterne(par.booking.url, t("chercherSur", { p: "Booking.com" })),
      A.lienExterne(par.google.url, t("comparerSur", { p: "Google" })),
      A.lienExterne(par.airbnb.url, "Airbnb"),
      A.lienExterne(par.expedia.url, "Expedia"),
    ].map((a, i) => { if (i === 0) a.classList.add("principal"); return a; });
  }

  function detailLien(l, ctx) {
    const n = O.nuits(sejour.arrivee, sejour.depart);
    const base = l.id === "booking" ? t(l.fiche ? "pageEtablissement" : "rechercheParNom")
      : l.id === "google" ? t("comparerPrix")
      : l.id === "tripadvisor" ? t("lireAvis")
      : l.id === "airbnb" ? t("logementsA", { v: ctx.nom })
      : t("rechercheParNom");
    return base + (l.dates && n ? " · " + t("datesIncluses") : "");
  }

  // ================================================================== images (Wikimedia)
  const taille = (url, l) => url.replace(/\/(\d+)px-/, "/" + l + "px-");
  const nomCommons = (f) => String(f || "").replace(/^(File|Fichier):/i, "").replace(/_/g, " ").trim();
  function image(v, { largeur = 500, alt = "" } = {}) {
    const img = h("img", { src: taille(v.url, largeur), alt, loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => { if (img.src !== v.url) img.src = v.url; }, { once: true });
    return img;
  }
  function credit(v) {
    const texte = [v.auteur, v.licence].filter(Boolean).join(" · ") || "Wikimedia Commons";
    return v.page ? h("a", { class: "credit", href: v.page, target: "_blank", rel: "noopener noreferrer" }, "📷 " + texte) : h("span", { class: "credit" }, "📷 " + texte);
  }

  /** Photo de chaque site : fichier Commons choisi, sinon image de l'article Wikipédia (2 à 3 requêtes au total). */
  const imagesParGuide = new Map();
  function imagesGuide(g) {
    if (imagesParGuide.has(g.id)) return imagesParGuide.get(g.id);
    const p = (async () => {
      const res = new Map();
      const fichiers = [g.image, ...g.sites.map((s) => s.img)].filter(Boolean);
      if (fichiers.length) {
        try {
          const m = await S.imagesCommons(fichiers, 960);
          if (g.image && m.get(nomCommons(g.image))) res.set("_guide", m.get(nomCommons(g.image)));
          for (const s of g.sites) if (s.img && m.get(nomCommons(s.img))) res.set(s.id, m.get(nomCommons(s.img)));
        } catch (e) { /* hors ligne : repli Wikipédia puis pictogramme */ }
      }
      for (const [cle, langue] of [["wfr", "fr"], ["wen", "en"]]) {
        const manquants = g.sites.filter((s) => s[cle] && !res.has(s.id));
        if (!manquants.length) continue;
        try {
          const m = await S.vignettesWiki(manquants.map((s) => s[cle]), langue, 960);
          for (const s of manquants) {
            if (m.get(s[cle])) res.set(s.id, { url: m.get(s[cle]), page: A.liens.wikipedia(s[cle], langue), auteur: "", licence: "Wikipédia" });
          }
        } catch (e) { /* idem */ }
      }
      return res;
    })();
    imagesParGuide.set(g.id, p);
    // Rien obtenu (hors ligne) : on réessaiera à la prochaine ouverture.
    p.then((m) => { if (!m.size) imagesParGuide.delete(g.id); });
    return p;
  }
  function poserImage(g, cle, conteneur, { largeur = 500, alt = "", avecCredit = false } = {}) {
    imagesGuide(g).then((m) => {
      const v = m.get(cle);
      if (!v) return;
      conteneur.prepend(image(v, { largeur, alt }));
      if (avecCredit) conteneur.appendChild(credit(v));
      conteneur.classList.add("avec-image");
    }).catch(() => {});
  }

  // ================================================================== outils communs
  let guideCourant = null;
  const pointsHeb = new Map(); // id → { ctx, x } pour les clics sur la carte

  function contexteGuide(g) {
    return { cle: "g:" + g.id, guide: g, nom: tx(g.nom), centre: g.centre, pays: g.pays, reservation: g.reservation, sites: g.sites, maj: g.maj };
  }
  const etapeGuide = (g, s) => ({ ref: `g:${g.id}:${s.id}`, nom: tx(s.n), lat: s.lat, lon: s.lon, pays: g.pays, duree: s.duree || 90 });
  const pointGuide = (s) => ({ id: s.id, lat: s.lat, lon: s.lon, titre: s.rang + ". " + tx(s.n), n: s.rang });
  const pointHeb = (x) => ({ id: x.id, lat: x.ll[0], lon: x.ll[1], titre: x.n });

  function plusProches(liste, [lat, lon], n, exclure) {
    return liste
      .filter((x) => x !== exclure && (x.ll || x.lat != null))
      .map((x) => ({ x, k: O.distanceKm(lat, lon, x.ll ? x.ll[0] : x.lat, x.ll ? x.ll[1] : x.lon) }))
      .sort((a, b) => a.k - b.k)
      .slice(0, n);
  }

  const premierePhrase = (texte) => {
    const m = String(texte).match(/^.{20,}?[.!?。؟](\s|$)/);
    return m ? m[0].trim() : texte;
  };

  function fait(icone, titre, valeur) {
    return h("div", null, h("dt", null, h("span", { "aria-hidden": "true" }, icone + " "), titre), h("dd", null, valeur));
  }

  const etoiles = (n) => (n ? h("span", { class: "etoiles", role: "img", "aria-label": t("nEtoiles", { n }) }, " " + "★".repeat(Math.min(5, n))) : null);

  // ================================================================== fiche d'un incontournable
  function ouvrirSite(g, s) {
    const nom = tx(s.n);
    const image = h("div", { class: "fiche-image" }, h("span", { class: "fiche-image-icone", "aria-hidden": "true" }, (A.CATEGORIES[s.cat] || {}).icone || "📍"));
    poserImage(g, s.id, image, { largeur: 960, alt: nom, avecCredit: true });
    const meteo = h("p", { class: "fiche-meteo" });
    const ctx = contexteGuide(g);
    const hebergements = plusProches((g.fusion || g.hebergements).filter((x) => x.ll), [s.lat, s.lon], 3);
    const voisins = plusProches(g.sites, [s.lat, s.lon], 3, s);
    const langueWiki = I.langue === "fr" && s.wfr ? "fr" : s.wen ? "en" : s.wfr ? "fr" : null;
    const titreWiki = langueWiki === "fr" ? s.wfr : s.wen;
    const lienPartage = location.origin + location.pathname + `#/guide/${g.id}/site/${s.id}`;
    A.majScene({ choisi: s.id });
    A.focaliserCarte(s.lat, s.lon, 14);
    A.ouvrirDialogue([
      image,
      h("div", { class: "fiche-texte" },
        h("p", { class: "fiche-cat" }, h("span", { class: "rang-fiche" }, t("rangN", { n: s.rang })), " ", A.libelleCategorie(s.cat), " · ", s.lieu),
        h("h2", { class: "fiche-titre" }, nom),
        s.local ? h("p", { class: "sous-titre" }, h("bdi", null, s.local)) : null,
        meteo,
        s.alerte ? h("p", { class: "alerte", role: "note" }, h("span", { "aria-hidden": "true" }, "⚠ "), tx(s.alerte)) : null,
        h("dl", { class: "faits" },
          s.duree ? fait("⏱", t("dureeConseillee"), fmt.duree(s.duree)) : null,
          s.moment ? fait("🕐", t("meilleurMoment"), tx(s.moment)) : null,
          s.entree ? fait("🎟️", t("entree"), tx(s.entree)) : null,
          fait("📍", t("depuisCentre"), fmt.distance(O.distanceKm(g.centre[0], g.centre[1], s.lat, s.lon)))),
        h("div", { class: "actions" },
          A.boutonEtape(etapeGuide(g, s), { libelle: true }),
          A.lienExterne(s.llApprox ? A.liens.itineraireNom(s.q || (s.n.fr || s.n.en) + ", " + tx(g.nom))
            : A.liens.itineraire(s.lat, s.lon), h("span", { "aria-hidden": "true" }, "🚗 "), t("yAller")),
          boutonFavori(`g:${g.id}:s:${s.id}`, nom),
          h("button", { type: "button", class: "bouton-icone", "aria-label": t("partager") + " : " + nom, title: t("partager"),
            onclick: () => A.partager({ titre: nom + " · " + tx(g.nom), url: lienPartage }) }, h("span", { "aria-hidden": "true" }, "↗"))),
        h("p", { class: "fiche-description" }, tx(s.d)),
        s.conseil ? [h("h3", null, "💡 ", t("bonASavoir")), h("p", null, tx(s.conseil))] : null,
        hebergements.length ? [
          h("h3", null, "🛏️ ", t("dormirAProximite")),
          h("ul", { class: "liste-proches", role: "list" }, hebergements.map(({ x, k }) => h("li", null,
            h("button", { type: "button", class: "proche", onclick: () => ouvrirHebergement(ctx, x) },
              h("span", { "aria-hidden": "true" }, ICONES_HEB[x.type] || "🛏️"), " ", h("span", { class: "proche-nom" }, x.n), etoiles(x.etoiles),
              h("span", { class: "site-meta" }, fmt.distance(k)))))),
          h("a", { class: "lien", href: `#/guide/${g.id}/dormir?pres=${s.id}` }, t("voirHebergementsProches"))] : null,
        voisins.length ? [
          h("h3", null, "🧭 ", t("aVoirAussi")),
          h("ul", { class: "liste-proches", role: "list" }, voisins.map(({ x, k }) => h("li", null,
            h("button", { type: "button", class: "proche", onclick: () => ouvrirSite(g, x) },
              h("span", { class: "rang-mini" }, x.rang), " ", h("span", { class: "proche-nom" }, tx(x.n)), h("span", { class: "site-meta" }, fmt.distance(k))))))] : null,
        h("h3", null, t("voirPlus")),
        h("ul", { class: "liens-externes" },
          titreWiki ? h("li", null, A.lienExterne(A.liens.wikipedia(titreWiki, langueWiki), h("span", { "aria-hidden": "true" }, "📖 "), t("articleWikipedia"))) : null,
          h("li", null, A.lienExterne(A.liens.photos((s.n.fr || s.n.en) + " " + tx(g.nom)), h("span", { "aria-hidden": "true" }, "📷 "), t("photos"))),
          h("li", null, A.lienExterne(A.liens.videos((s.n.fr || s.n.en) + " " + tx(g.nom)), h("span", { "aria-hidden": "true" }, "▶️ "), t("videos"))),
          h("li", null, A.lienExterne(A.liens.osm(s.lat, s.lon), h("span", { "aria-hidden": "true" }, "🗺️ "), "OpenStreetMap"))),
        s.llApprox ? h("p", { class: "note" }, h("span", { "aria-hidden": "true" }, "📍 "), t("positionApprox"))
          : h("p", { class: "coordonnees" }, h("button", { type: "button", class: "lien", onclick: () => A.copier(`${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`) }, "📌 " + s.lat.toFixed(4) + ", " + s.lon.toFixed(4))),
        h("p", { class: "source" }, t("selectionAtlo", { d: moisAnnee(g.maj) })),
        h("p", { class: "mention" }, t("mentionExterne"))),
    ], nom);
    S.meteo(s.lat, s.lon).then((m) => {
      const [cle, icone] = O.meteoWmo(m.actuel.code, m.actuel.jour);
      A.vider(meteo, icone + " " + fmt.temperature(m.actuel.t) + " · " + t("wmo_" + cle) + " · " + t("heureLocale").toLowerCase() + " " + fmt.heure(m.fuseau));
    }).catch(() => {});
  }

  A.ouvrirSiteGuide = async (gid, sid) => {
    try {
      const g = await A.chargerGuide(gid);
      const s = g.site.get(sid);
      if (s) ouvrirSite(g, s);
    } catch (e) { A.toast(t("serviceIndispo")); }
  };

  // ================================================================== fiche d'un hébergement
  function ouvrirHebergement(ctx, x) {
    const liens = liensDe(ctx, x).filter((l) => l.id !== "airbnb" || AVEC_AIRBNB.has(x.type));
    const kmCentre = x.ll && ctx.centre ? O.distanceKm(ctx.centre[0], ctx.centre[1], x.ll[0], x.ll[1]) : null;
    const adresse = [x.quartier, x.lieu].filter(Boolean).join(", ");
    const contacts = [
      x.site ? A.lienExterne(x.site, h("span", { "aria-hidden": "true" }, "🌐 "), t("siteOfficiel")) : null,
      x.fb ? A.lienExterne(x.fb, h("span", { "aria-hidden": "true" }, "📘 "), "Facebook") : null,
      x.tel ? h("a", { href: "tel:" + x.tel.replace(/[^\d+]/g, ""), class: "lien-tel" }, h("span", { "aria-hidden": "true" }, "📞 "), x.tel) : null,
      A.lienExterne("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([x.n, adresse || ctx.nom].join(", ")),
        h("span", { "aria-hidden": "true" }, "📍 "), t("avisPhotosGoogle")),
      x.ll ? A.lienExterne(A.liens.itineraire(x.ll[0], x.ll[1]), h("span", { "aria-hidden": "true" }, "🚗 "), t("yAller")) : null,
    ].filter(Boolean);
    const sites = x.ll && ctx.sites && ctx.guide ? plusProches(ctx.sites, x.ll, 3) : [];
    if (x.ll) {
      A.majScene({ choisi: x.id });
      A.focaliserCarte(x.ll[0], x.ll[1], 15);
    }
    A.ouvrirDialogue([
      h("div", { class: "fiche-image fiche-heb" }, h("span", { class: "fiche-image-icone", "aria-hidden": "true" }, ICONES_HEB[x.type] || "🛏️")),
      h("div", { class: "fiche-texte" },
        h("p", { class: "fiche-cat" }, t("type_" + x.type), etoiles(x.etoiles)),
        h("h2", { class: "fiche-titre" }, x.n),
        x.nomLocal ? h("p", { class: "sous-titre" }, h("bdi", null, x.nomLocal)) : null,
        h("p", { class: "sous-titre" }, adresse || ctx.nom, kmCentre != null ? " · " + t("aDistanceDe", { d: fmt.distance(kmCentre), lieu: t("centreVille") }) : ""),
        x.mer || x.note ? h("p", { class: "badges" }, x.mer ? h("span", { class: "badge" }, "🌊 " + t("bordDeMer")) : null, x.note ? h("span", { class: "badge discret" }, tx(x.note)) : null) : null,
        h("h3", null, t("reserverComparer")),
        h("p", { class: "sejour-pastille" }, h("span", { "aria-hidden": "true" }, "📅 "), resumeSejour(),
          ctx.guide ? [" · ", h("a", { href: `#/guide/${ctx.guide.id}/dormir#sejour` }, t("modifier"))] : null),
        h("ul", { class: "plateformes", role: "list" }, liens.map((l) => h("li", null,
          A.lienExterne(l.url, h("span", { class: "plateforme-nom" }, l.nom), h("span", { class: "plateforme-detail" }, detailLien(l, ctx)))))),
        h("p", { class: "note" }, t("prixPlateformes"), " ", t(affilie ? "mentionAffiliation" : "sansCommission")),
        h("h3", null, t("contactAcces")),
        h("ul", { class: "liens-externes" }, contacts.map((c) => h("li", null, c))),
        sites.length ? [
          h("h3", null, "🧭 ", t("aVoirAProximite")),
          h("ul", { class: "liste-proches", role: "list" }, sites.map(({ x: s, k }) => h("li", null,
            h("button", { type: "button", class: "proche", onclick: () => ouvrirSite(ctx.guide, s) },
              h("span", { class: "rang-mini" }, s.rang), " ", h("span", { class: "proche-nom" }, tx(s.n)), h("span", { class: "site-meta" }, fmt.distance(k))))))] : null,
        h("p", { class: "source" }, x.source === "osm" ? t("sourceOsm") : t("selectionAtlo", { d: moisAnnee(ctx.maj) }),
          x.llSource === "osm" ? " " + t("positionOsm") : ""),
        h("p", { class: "mention" }, t("mentionExterne"))),
    ], x.n);
  }

  function carteHebergement(ctx, x, { km, refNom } = {}) {
    const liens = liensDe(ctx, x);
    const principal = x.booking ? liens[0] : liens.find((l) => l.id === "google");
    const adresse = [x.quartier, x.lieu].filter(Boolean).join(", ");
    pointsHeb.set(x.id, { ctx, x });
    return h("li", { class: "carte-heb", dataset: { id: x.id } },
      h("button", { type: "button", class: "carte-heb-ouvrir", onclick: () => ouvrirHebergement(ctx, x) },
        h("span", { class: "heb-icone", "aria-hidden": "true" }, ICONES_HEB[x.type] || "🛏️"),
        h("span", { class: "carte-heb-texte" },
          h("span", { class: "carte-heb-nom" }, x.n, etoiles(x.etoiles)),
          h("span", { class: "site-meta" }, [t("type_" + x.type), adresse, km != null ? t("aDistanceDe", { d: fmt.distance(km), lieu: refNom }) : null].filter(Boolean).join(" · ")),
          x.mer || x.source === "osm" ? h("span", { class: "badges" },
            x.mer ? h("span", { class: "badge" }, "🌊 " + t("bordDeMer")) : null,
            x.source === "osm" ? h("span", { class: "badge discret" }, "OpenStreetMap") : null) : null)),
      h("div", { class: "carte-heb-actions" },
        boutonFavori(ctx.cle + ":h:" + x.id, x.n),
        A.lienExterne(principal.url, t("voirPrix"))));
  }

  // ================================================================== « Où dormir » partout
  /** Bloc « Où dormir » autour d'un point : OpenStreetMap + recherche pré-remplie sur les plateformes. */
  A.blocHebergements = (lat, lon, nom, { pays, rayonKm = 6 } = {}) => {
    const lieu = nom + (pays ? ", " + A.nomPays(pays) : "");
    const ctx = { cle: "l:" + (+lat).toFixed(2) + "," + (+lon).toFixed(2), nom, centre: [lat, lon], pays, reservation: { lieu }, sites: [] };
    const corps = h("div", null, A.squelette(3));
    const actions = h("div", { class: "actions sejour-liens" });
    const resume = h("p", { class: "petit" });
    const majActions = () => { A.vider(actions, liensVille(ctx)); resume.textContent = resumeSejour(); };
    majActions();
    ecouterSejour(majActions, actions);
    const bloc = h("section", { class: "bloc", "aria-labelledby": "titre-dormir" },
      h("h2", { id: "titre-dormir" }, h("span", { "aria-hidden": "true" }, "🛏️ "), t("ouDormirA", { v: nom })),
      resume, actions, corps);
    const charger = async () => {
      A.vider(corps, A.squelette(3));
      try {
        const dLat = rayonKm / 111, dLon = rayonKm / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
        const liste = await S.hebergementsOsm([lon - dLon, lat - dLat, lon + dLon, lat + dLat]);
        const tri = liste.map((x) => ({ x, k: O.distanceKm(lat, lon, x.ll[0], x.ll[1]) })).sort((a, b) => a.k - b.k);
        if (!tri.length) { A.vider(corps, h("p", { class: "note" }, t("aucunHebergementOsm"))); return; }
        const maScene = A.etat.scene;
        tri.forEach(({ x }) => pointsHeb.set(x.id, { ctx, x }));
        if (maScene && A.etat.scene === maScene) A.majScene({ hebergements: tri.slice(0, 80).map(({ x }) => pointHeb(x)) });
        let n = 6;
        const ul = h("ul", { class: "cartes-heb", role: "list" });
        const plus = h("button", { type: "button", class: "bouton", onclick: () => { n += 12; dessiner(); } }, t("afficherPlus"));
        const dessiner = () => {
          A.vider(ul, tri.slice(0, n).map(({ x, k }) => carteHebergement(ctx, x, { km: k, refNom: nom })));
          plus.hidden = n >= tri.length;
        };
        dessiner();
        A.vider(corps, h("p", { class: "petit" }, t("nHebergementsOsm", { n: tri.length })), ul, plus, h("p", { class: "source" }, t("sourceOsm")));
      } catch (e) {
        A.vider(corps, A.erreurReseau(e, charger));
      }
    };
    A.quandVisible(bloc, charger);
    return bloc;
  };

  // ================================================================== carte d'accueil d'un guide
  A.carteGuide = (resume) => {
    const fond = h("span", { class: "carte-guide-image", "aria-hidden": "true" });
    const el = h("a", { href: "#/guide/" + resume.id, class: "carte-guide" }, fond,
      h("span", { class: "carte-guide-texte" },
        h("span", { class: "carte-guide-sur" }, h("span", { class: "drapeau", "aria-hidden": "true" }, A.drapeau(resume.pays)), " ", A.nomPays(resume.pays), " · ", t("guideDeVille"),
          resume.brouillon ? h("span", { class: "badge-apercu" }, t("apercu")) : null),
        h("span", { class: "carte-guide-nom" }, tx(resume.nom)),
        h("span", { class: "carte-guide-accroche" }, tx(resume.accroche)),
        h("span", { class: "carte-guide-chiffres" },
          [t("topN", { n: resume.nb.sites }), t("nHebergements", { n: resume.nb.hebergements }), t("nItineraires", { n: resume.nb.itineraires })].join(" · "))));
    if (resume.image) {
      S.imagesCommons([resume.image], 960).then((m) => {
        const v = m.get(nomCommons(resume.image));
        if (!v) return;
        fond.appendChild(image(v, { largeur: 960 }));
        el.classList.add("avec-image");
      }).catch(() => {});
    }
    return el;
  };

  // ================================================================== écran du guide
  const ONGLETS = [["voir", "🏛️", "aVoir"], ["dormir", "🛏️", "ouDormir"], ["itineraires", "🗓️", "itinerairesPrets"], ["pratique", "ℹ️", "pratique"]];

  A.route(/^guide\/([a-z0-9-]+)(?:\/(dormir|itineraires|pratique|site|heb)(?:\/([^/]+))?)?$/, async ([id, section, cle], params) => {
    if (!A.GUIDES.has(id)) return A.introuvable();
    const g = await A.chargerGuide(id);
    guideCourant = g;
    const onglet = section === "site" ? "voir" : section === "heb" ? "dormir" : section || "voir";
    const memeGuide = (A.etat.vue || "").split("?")[0].startsWith("guide/" + id);
    const scene = { boite: g.boite, guide: [], hebergements: [], points: [], decouvertes: [], etapes: [] };
    A.etat.scene = scene;
    const corps = h("div", { class: "guide-corps" });
    const apres = [];
    ({ voir: ongletVoir, dormir: ongletDormir, itineraires: ongletItineraires, pratique: ongletPratique })[onglet](g, corps, scene, { params, apres, cle });
    const contenu = h("div", { class: "page-guide" },
      h("nav", { class: "fil", "aria-label": t("filAriane") },
        h("a", { href: "#/" }, t("explorer")), h("span", { "aria-hidden": "true" }, " › "),
        h("a", { href: "#/pays/" + g.pays }, A.nomPays(g.pays)), h("span", { "aria-hidden": "true" }, " › "),
        g.region != null ? [h("a", { href: `#/pays/${g.pays}/r/${g.region}` }, tx(g.nom)), h("span", { "aria-hidden": "true" }, " › ")] : null,
        h("span", { "aria-current": "page" }, t("guide"))),
      hero(g),
      g.brouillon ? h("p", { class: "bandeau-brouillon", role: "note" }, h("span", { "aria-hidden": "true" }, "🚧 "), t("guideBrouillon")) : null,
      h("nav", { class: "onglets-guide", "aria-label": t("sectionsGuide") },
        ONGLETS.map(([k, icone, libelle]) => {
          const n = k === "voir" ? g.sites.length : k === "dormir" ? g.hebergements.length : k === "itineraires" ? g.itineraires.length : 0;
          return h("a", { href: "#/guide/" + g.id + (k === "voir" ? "" : "/" + k), class: "onglet-guide", "aria-current": k === onglet ? "page" : null },
            h("span", { "aria-hidden": "true" }, icone), h("span", { class: "onglet-libelle" }, t(libelle)),
            n ? h("span", { class: "puce-compte" }, h("span", { class: "visuellement-cache" }, " · "), fmt.nombre(n)) : null);
        })),
      corps,
      h("p", { class: "mention" }, t("mention")));
    return {
      nom: "guide", titre: tx(g.nom) + " · " + t(ONGLETS.find((o) => o[0] === onglet)[2]), contenu, onglet: "explorer",
      garderDefilement: memeGuide, carte: scene,
      apres: () => {
        if (memeGuide) {
          // Changement d'onglet : on garde les onglets en vue plutôt que de remonter en haut du guide.
          const nav = contenu.querySelector(".onglets-guide");
          if (nav && nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: "start" });
        }
        apres.forEach((f) => f());
      },
    };
  });

  function hero(g) {
    const fond = h("div", { class: "guide-hero-image" });
    const meteo = h("span", { class: "guide-hero-fait" });
    const el = h("header", { class: "guide-hero" }, fond,
      h("div", { class: "guide-hero-texte" },
        h("p", { class: "guide-hero-sur" }, h("span", { class: "drapeau", "aria-hidden": "true" }, A.drapeau(g.pays)), " ", A.nomPays(g.pays), " · ", t("guideDeVille")),
        h("h1", null, tx(g.nom)),
        g.local ? h("p", { class: "guide-hero-local" }, h("bdi", null, g.local)) : null,
        h("p", { class: "guide-hero-accroche" }, tx(g.accroche)),
        h("p", { class: "guide-hero-faits" },
          h("span", { class: "guide-hero-fait" }, h("span", { "aria-hidden": "true" }, "🕒 "), A.horloge(g.fuseau)), meteo)),
      h("button", { type: "button", class: "bouton-icone guide-partager", "aria-label": t("partager") + " : " + tx(g.nom), title: t("partager"),
        onclick: () => A.partager({ titre: tx(g.nom) + " · Atlo", texte: tx(g.accroche), url: location.origin + location.pathname + "#/guide/" + g.id }) },
        h("span", { "aria-hidden": "true" }, "↗")));
    poserImage(g, "_guide", fond, { largeur: 960, avecCredit: true });
    imagesGuide(g).then((m) => { if (m.has("_guide")) el.classList.add("avec-image"); });
    S.meteo(g.centre[0], g.centre[1]).then((m) => {
      const [cle, icone] = O.meteoWmo(m.actuel.code, m.actuel.jour);
      A.vider(meteo, h("span", { "aria-hidden": "true" }, icone + " "), fmt.temperature(m.actuel.t) + " · " + t("wmo_" + cle));
    }).catch(() => {});
    return el;
  }

  // ------------------------------------------------------------------ À voir
  function ongletVoir(g, corps, scene, { apres, cle }) {
    let filtre = null, distances = null;
    const cats = [...new Set(g.sites.map((s) => s.cat))];
    const cleFav = (s) => `g:${g.id}:s:${s.id}`;
    const nbFav = () => g.sites.filter((s) => A.favoris.a(cleFav(s))).length;
    const liste = h("ol", { class: "cartes-sites", role: "list" });
    const puces = h("div", { class: "puces defilantes", role: "group", "aria-label": t("filtrerCategorie") });
    const visibles = () => {
      const l = g.sites.filter((s) => (filtre === "fav" ? A.favoris.a(cleFav(s)) : !filtre || s.cat === filtre));
      return distances ? l.slice().sort((a, b) => distances.get(a.id) - distances.get(b.id)) : l;
    };
    const dessiner = (premier) => {
      const l = visibles();
      A.vider(liste, l.length ? l.map((s) => carteSite(g, s, distances && distances.get(s.id)))
        : h("li", { class: "vide-doux" }, t(filtre === "fav" ? "aucunFavori" : "aucunResultat")));
      const points = l.map(pointGuide);
      if (premier) scene.guide = points;
      else A.majScene({ guide: points });
    };
    const choisir = (f) => { filtre = f; majPuces(); dessiner(); };
    const majPuces = () => A.vider(puces,
      A.puce(t("tout"), { actif: !filtre, compte: g.sites.length, onclick: () => choisir(null) }),
      A.puce("♥ " + t("favoris"), { actif: filtre === "fav", compte: nbFav(), onclick: () => choisir(filtre === "fav" ? null : "fav") }),
      cats.map((c) => A.puce(A.libelleCategorie(c), {
        actif: filtre === c, compte: g.sites.filter((s) => s.cat === c).length, onclick: () => choisir(filtre === c ? null : c),
      })));
    majPuces();
    A.favoris.ecouter(() => { majPuces(); if (filtre === "fav") dessiner(); }, puces);
    const proches = h("button", { type: "button", class: "bouton petit", "aria-pressed": "false" }, h("span", { "aria-hidden": "true" }, "📍 "), t("lesPlusProches"));
    proches.addEventListener("click", async () => {
      if (distances) { distances = null; proches.setAttribute("aria-pressed", "false"); dessiner(); return; }
      proches.disabled = true;
      try {
        const pos = await A.position();
        const loin = O.distanceKm(pos.lat, pos.lon, g.centre[0], g.centre[1]);
        if (loin > 80) {
          A.toast(t("loinDuGuide", { d: fmt.distance(loin), v: tx(g.nom) }));
        } else {
          distances = new Map(g.sites.map((s) => [s.id, O.distanceKm(pos.lat, pos.lon, s.lat, s.lon)]));
          proches.setAttribute("aria-pressed", "true");
          dessiner();
        }
      } catch (e) {
        A.toast(e.message);
      } finally {
        proches.disabled = false;
      }
    });
    dessiner(true);
    A.vider(corps,
      h("section", { class: "bloc bloc-guide", "aria-labelledby": "titre-top" },
        h("div", { class: "titre-ligne" }, h("h2", { id: "titre-top" }, t("topN", { n: g.sites.length })), proches),
        h("p", { class: "sous-titre" }, tx(g.intro)),
        puces, liste,
        h("p", { class: "source" }, t("selectionAtlo", { d: moisAnnee(g.maj) }), " ", t("classementExplique"))));
    if (cle) {
      apres.push(() => {
        const s = g.site.get(cle);
        if (s) ouvrirSite(g, s);
        else A.toast(t("introuvable"));
      });
    }
    // Positions OpenStreetMap des hébergements, pour « Dormir à proximité » dans les fiches.
    apres.push(() => hebergementsFusionnes(g).catch(() => {}));
  }

  function carteSite(g, s, distance) {
    const nom = tx(s.n);
    const vignette = h("span", { class: "vignette" },
      h("span", { class: "vignette-icone", "aria-hidden": "true" }, (A.CATEGORIES[s.cat] || {}).icone || "📍"),
      h("span", { class: "rang", "aria-hidden": "true" }, s.rang));
    poserImage(g, s.id, vignette, { largeur: 330 });
    return h("li", { class: "carte-site", dataset: { id: s.id } },
      h("button", { type: "button", class: "carte-site-ouvrir", onclick: () => ouvrirSite(g, s) },
        vignette,
        h("span", { class: "carte-site-texte" },
          h("span", { class: "carte-site-nom" }, h("span", { class: "visuellement-cache" }, t("rangN", { n: s.rang }) + " · "), nom),
          h("span", { class: "site-meta" }, [t((A.CATEGORIES[s.cat] || {}).cle || "catA"), s.lieu, s.duree ? "⏱ " + fmt.duree(s.duree) : null,
            distance != null ? "📍 " + fmt.distance(distance) : null].filter(Boolean).join(" · ")),
          h("span", { class: "carte-site-resume" }, premierePhrase(tx(s.d))),
          s.alerte ? h("span", { class: "statut attention" }, "⚠ " + t("aSavoirAvant")) : null)),
      h("div", { class: "carte-site-actions" }, boutonFavori(`g:${g.id}:s:${s.id}`, nom), A.boutonEtape(etapeGuide(g, s))));
  }

  // ------------------------------------------------------------------ Où dormir
  const osmParGuide = new Map();
  function hebergementsFusionnes(g) {
    if (!osmParGuide.has(g.id)) {
      const p = S.hebergementsOsm(g.boiteHebergements || g.boite).then((osm) => {
        g.fusion = O.fusionnerHebergements(g.hebergements, osm);
        return g.fusion;
      });
      p.catch(() => osmParGuide.delete(g.id));
      osmParGuide.set(g.id, p);
    }
    return osmParGuide.get(g.id);
  }

  function ongletDormir(g, corps, scene, { params, apres, cle }) {
    const ctx = contexteGuide(g);
    let liste = g.fusion || g.hebergements;
    let type = null, lieu = null;
    let tri = params.get("pres") && g.site.has(params.get("pres")) ? "site:" + params.get("pres") : "recommande";
    const ul = h("ul", { class: "cartes-heb", role: "list" });
    const compteurEl = h("p", { class: "compteur", "aria-live": "polite" });
    const etatOsm = h("p", { class: "note", role: "status" });
    const puces = h("div", { class: "puces defilantes", role: "group", "aria-label": t("filtrerType") });
    const pucesLieux = h("div", { class: "puces defilantes", role: "group", "aria-label": t("filtrerLieu") });
    const cleFav = (x) => ctx.cle + ":h:" + x.id;
    const reference = () => {
      if (tri.startsWith("site:")) {
        const s = g.site.get(tri.slice(5));
        if (s) return { lat: s.lat, lon: s.lon, nom: tx(s.n), s };
      }
      return { lat: g.centre[0], lon: g.centre[1], nom: t("centreVille") };
    };
    const selectTri = h("select", { class: "select-petit", "aria-label": t("trier") },
      h("option", { value: "recommande" }, t("triRecommande")),
      h("option", { value: "centre" }, t("triCentre")),
      h("option", { value: "etoiles" }, t("triEtoiles")),
      h("optgroup", { label: t("presDe") }, g.sites.map((s) => h("option", { value: "site:" + s.id }, s.rang + ". " + tx(s.n)))));
    selectTri.value = tri;
    selectTri.addEventListener("change", () => { tri = selectTri.value; dessiner(); });

    const dessiner = (premier) => {
      const ref = reference();
      const km = (x) => (x.ll ? O.distanceKm(ref.lat, ref.lon, x.ll[0], x.ll[1]) : null);
      let l = liste.filter((x) => (type === "fav" ? A.favoris.a(cleFav(x)) : !type || x.type === type) && (!lieu || x.lieu === lieu));
      const ordre = new Map(liste.map((x, i) => [x, i]));
      const parDistance = (a, b) => (km(a) ?? 1e9) - (km(b) ?? 1e9);
      if (tri === "recommande") l.sort((a, b) => (a.source === "osm") - (b.source === "osm") || (a.source === "osm" ? parDistance(a, b) : ordre.get(a) - ordre.get(b)));
      else if (tri === "etoiles") l.sort((a, b) => (b.etoiles || 0) - (a.etoiles || 0) || parDistance(a, b));
      else l.sort(parDistance);
      A.vider(ul, l.length ? l.map((x) => carteHebergement(ctx, x, { km: km(x), refNom: ref.nom }))
        : h("li", { class: "vide-doux" }, t(type === "fav" ? "aucunFavori" : "aucunResultat")));
      compteurEl.textContent = t("nHebergements", { n: l.length });
      const patch = { hebergements: l.filter((x) => x.ll).map(pointHeb), guide: ref.s ? [pointGuide(ref.s)] : [] };
      if (premier) Object.assign(scene, patch);
      else A.majScene(patch);
    };
    const majPuces = () => {
      const types = [...new Set(liste.map((x) => x.type))];
      A.vider(puces,
        A.puce(t("tout"), { actif: !type, compte: liste.length, onclick: () => { type = null; majPuces(); dessiner(); } }),
        A.puce("♥ " + t("favoris"), { actif: type === "fav", compte: liste.filter((x) => A.favoris.a(cleFav(x))).length, onclick: () => { type = type === "fav" ? null : "fav"; majPuces(); dessiner(); } }),
        types.map((ty) => A.puce((ICONES_HEB[ty] || "🛏️") + " " + t("types_" + ty), {
          actif: type === ty, compte: liste.filter((x) => x.type === ty).length, onclick: () => { type = type === ty ? null : ty; majPuces(); dessiner(); },
        })));
      const lieux = [...new Set(liste.map((x) => x.lieu).filter(Boolean))]
        .map((v) => [v, liste.filter((x) => x.lieu === v).length]).sort((a, b) => b[1] - a[1]);
      A.vider(pucesLieux, lieux.length > 1 ? [
        A.puce(t("partout"), { actif: !lieu, onclick: () => { lieu = null; majPuces(); dessiner(); } }),
        lieux.map(([v, n]) => A.puce(v, { actif: lieu === v, compte: n, onclick: () => { lieu = lieu === v ? null : v; majPuces(); dessiner(); } })),
      ] : null);
    };
    majPuces();
    A.favoris.ecouter(() => { majPuces(); if (type === "fav") dessiner(); }, puces);
    dessiner(true);

    const avecOsm = () => {
      etatOsm.textContent = t("rechercheOsm");
      hebergementsFusionnes(g).then((fusion) => {
        if (!ul.isConnected) return; // l'utilisateur a quitté l'onglet : la fusion reste en mémoire
        const ajoutes = fusion.length - g.hebergements.length;
        liste = fusion;
        etatOsm.textContent = ajoutes > 0 ? t("ajoutesOsm", { n: ajoutes }) : t("rienDePlusOsm");
        majPuces();
        dessiner();
        ouvrirDemande();
      }).catch((e) => {
        A.vider(etatOsm, A.erreurReseau(e, avecOsm));
        ouvrirDemande();
      });
    };
    // Lien direct vers un établissement : ouvert dès qu'il est connu (sélection, ou OSM une fois chargé).
    let demande = cle || null;
    const ouvrirDemande = () => {
      if (!demande) return;
      const x = liste.find((y) => y.id === demande);
      if (x) { demande = null; ouvrirHebergement(ctx, x); }
    };

    A.vider(corps,
      blocSejour(ctx),
      h("section", { class: "bloc", "aria-labelledby": "titre-heb" },
        h("div", { class: "titre-ligne" }, h("h2", { id: "titre-heb" }, t("hebergementsA", { v: tx(g.nom) })), selectTri),
        h("p", { class: "sous-titre" }, tx(g.introHebergement)),
        puces, pucesLieux, compteurEl, ul, etatOsm,
        h("p", { class: "note" }, t("prixPlateformes"), " ", t(affilie ? "mentionAffiliation" : "sansCommission")),
        h("p", { class: "source" }, t("selectionAtlo", { d: moisAnnee(g.maj) }), " ", t("sourceOsm"))));
    apres.push(() => {
      if (location.hash.includes("#sejour") || location.hash.endsWith("/dormir#sejour")) {
        const s = document.getElementById("sejour-arrivee");
        if (s) { s.scrollIntoView({ block: "center" }); s.focus({ preventScroll: true }); }
      }
      ouvrirDemande();
      if (!g.fusion) avecOsm();
    });
  }

  // ------------------------------------------------------------------ Itinéraires prêts
  function etapesItineraire(g, it) {
    const etapes = [];
    it.jours.forEach((j, numero) => {
      j.e.forEach((id, i) => {
        const s = g.site.get(id);
        if (s) etapes.push({ s, jour: numero, premier: i === 0 });
      });
    });
    return etapes;
  }

  function ongletItineraires(g, corps, scene) {
    const montrer = (it, cadrer) => {
      const etapes = etapesItineraire(g, it).map((e) => ({ id: e.s.id, lat: e.s.lat, lon: e.s.lon, titre: tx(e.s.n) }));
      if (cadrer === "initial") { scene.etapes = etapes; scene.boite = null; return; }
      if (!A.etat.scene) return;
      Object.assign(A.etat.scene, { etapes, guide: [], boite: null, cadrer: true });
      A.afficherCarte(A.etat.scene);
    };
    montrer(g.itineraires[0], "initial");
    A.vider(corps,
      h("p", { class: "sous-titre" }, t("itinerairesIntro")),
      g.itineraires.map((it) => carteItineraire(g, it, () => montrer(it))));
  }

  function carteItineraire(g, it, montrer) {
    const etapes = etapesItineraire(g, it);
    let km = 0;
    for (let i = 1; i < etapes.length; i++) {
      if (etapes[i].jour === etapes[i - 1].jour) km += O.distanceKm(etapes[i - 1].s.lat, etapes[i - 1].s.lon, etapes[i].s.lat, etapes[i].s.lon);
    }
    const choix = h("div", { class: "choix-itineraire", hidden: true });
    const titre = tx(it.t);
    const utiliser = () => {
      const nouvelles = etapes.map((e, i) => Object.assign(etapeGuide(g, e.s), {
        id: "g" + i + "-" + Math.random().toString(36).slice(2, 7), nouveauJour: e.premier && e.jour > 0,
      }));
      const etat = A.itineraire.etat();
      const appliquer = (mode) => {
        if (mode === "remplacer") {
          A.itineraire.remplacer({ titre, debut: sejour.arrivee || etat.debut || "", mode: "voiture", heuresParJour: 9, etapes: nouvelles });
        } else {
          if (nouvelles[0]) nouvelles[0].nouveauJour = true;
          A.itineraire.maj({ etapes: etat.etapes.concat(nouvelles) });
        }
        A.toast(t("itineraireCharge", { n: nouvelles.length }));
        A.aller("/itineraire");
      };
      if (!etat.etapes.length) { appliquer("remplacer"); return; }
      choix.hidden = false;
      A.vider(choix,
        h("p", null, t("itineraireExistant", { n: etat.etapes.length })),
        h("div", { class: "actions" },
          h("button", { type: "button", class: "bouton principal", onclick: () => appliquer("remplacer") }, t("remplacerLeMien")),
          h("button", { type: "button", class: "bouton", onclick: () => appliquer("ajouter") }, t("ajouterALaSuite")),
          h("button", { type: "button", class: "bouton", onclick: () => { choix.hidden = true; } }, t("annuler"))));
      choix.querySelector("button").focus();
    };
    return h("section", { class: "bloc itineraire-pret", "aria-labelledby": "it-" + it.id },
      h("p", { class: "itineraire-duree" }, t("nJours", { n: it.jours.length })),
      h("h2", { id: "it-" + it.id }, titre),
      h("p", { class: "sous-titre" }, tx(it.r)),
      h("p", { class: "petit" }, t("nEtapes", { n: etapes.length }) + " · " + fmt.distance(km * O.MODES.voiture.detour)),
      it.jours.map((j, numero) => h("div", { class: "jour-pret" },
        h("h3", null, t("jourN", { n: numero + 1 }), j.t ? " · " + tx(j.t) : ""),
        h("ol", { class: "etapes-pretes", role: "list" }, j.e.map((id, i) => {
          const s = g.site.get(id);
          if (!s) return null;
          const prec = i > 0 ? g.site.get(j.e[i - 1]) : null;
          const k = prec ? O.distanceKm(prec.lat, prec.lon, s.lat, s.lon) : 0;
          const aPied = k < 1.5;
          return h("li", null,
            prec ? h("span", { class: "trajet-pret" }, h("span", { "aria-hidden": "true" }, aPied ? "🚶 " : "🚗 "),
              fmt.duree(O.dureeTrajet(k, aPied ? "pied" : "voiture")) + " · " + fmt.distance(k * O.MODES[aPied ? "pied" : "voiture"].detour)) : null,
            h("button", { type: "button", class: "etape-pret", onclick: () => ouvrirSite(g, s) },
              h("span", { class: "rang-mini" }, s.rang),
              h("span", { class: "etape-pret-nom" }, tx(s.n)),
              h("span", { class: "site-meta" }, fmt.duree(s.duree || 90))));
        })),
        j.conseil ? h("p", { class: "petit" }, "💡 ", tx(j.conseil)) : null)),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "bouton principal", onclick: utiliser }, h("span", { "aria-hidden": "true" }, "🧭 "), t("utiliserItineraire")),
        h("button", { type: "button", class: "bouton", onclick: montrer }, h("span", { "aria-hidden": "true" }, "🗺️ "), t("voirSurCarte"))),
      choix);
  }

  // ------------------------------------------------------------------ Pratique
  function ongletPratique(g, corps, scene) {
    const p = g.pratique || {};
    const pays = A.PAYS.get(g.pays);
    scene.points = (p.lieux || []).filter((l) => l.ll).map((l) => ({ id: "lieu:" + l.id, lat: l.ll[0], lon: l.ll[1], titre: tx(l.n) }));
    if (scene.points.length > 1) scene.boite = null;
    const liste = (items) => h("ul", { class: "liste-pratique", role: "list" }, items.map((x) =>
      h("li", null, x.i ? h("span", { class: "liste-pratique-icone", "aria-hidden": "true" }, x.i) : null,
        h("div", null, x.n ? h("strong", null, tx(x.n)) : null, x.quand ? h("span", { class: "petit" }, " · " + tx(x.quand)) : null,
          h("p", null, tx(x.t || x.d)), x.source ? h("p", { class: "source" }, A.lienExterne(x.source, t("source"))) : null))));
    const section = (id, icone, titre, ...contenu) => h("section", { class: "bloc", "aria-labelledby": "pr-" + id },
      h("h2", { id: "pr-" + id }, h("span", { "aria-hidden": "true" }, icone + " "), titre), ...contenu);
    A.vider(corps,
      p.venir && p.venir.length ? section("venir", "✈️", t("venirA", { v: tx(g.nom) }), liste(p.venir)) : null,
      p.bouger && p.bouger.length ? section("bouger", "🚕", t("seDeplacer"), liste(p.bouger)) : null,
      p.saison ? section("saison", "🌤️", t("quandPartir"), h("p", null, tx(p.saison))) : null,
      A.blocMeteo(g.centre[0], g.centre[1], { titre: t("meteoA", { v: tx(g.nom) }) }),
      A.blocClimat(g.centre[0], g.centre[1], tx(g.nom)),
      p.cuisine && p.cuisine.length ? section("cuisine", "🍲", t("aGouter"), liste(p.cuisine)) : null,
      p.evenements && p.evenements.length ? section("evenements", "🎭", t("evenements"), liste(p.evenements)) : null,
      p.conseils && p.conseils.length ? section("conseils", "💡", t("bonASavoir"), liste(p.conseils)) : null,
      p.lieux && p.lieux.length ? section("lieux", "📍", t("adressesUtiles"),
        h("ul", { class: "liste-pratique", role: "list" }, p.lieux.map((l) => h("li", null,
          h("span", { class: "liste-pratique-icone", "aria-hidden": "true" }, l.i || "📍"),
          h("div", null, h("strong", null, tx(l.n)), l.d ? h("p", null, tx(l.d)) : null,
            l.ll ? A.lienExterne(A.liens.itineraire(l.ll[0], l.ll[1]), t("yAller")) : null))))) : null,
      pays ? section("urgences", "🆘", t("urgences"),
        A.blocUrgences(pays, (icone, titre, ...v) => h("div", { class: "tuile" }, h("div", null, ...v))),
        h("p", null, h("a", { href: `#/outils?p=${g.pays}#phrases` }, t("phrasesUtiles")), " · ", h("a", { href: "#/pays/" + g.pays }, t("infosPays", { p: A.nomPays(g.pays) })))) : null,
      g.histoire ? section("histoire", "📜", t("unPeuDHistoire"), h("p", null, tx(g.histoire))) : null,
      g.sources && g.sources.length ? h("details", { class: "bloc sources-guide" },
        h("summary", null, t("sourcesDuGuide")),
        h("ul", { class: "sources" }, g.sources.map((u) => h("li", null, A.lienExterne(u, u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70)))))) : null);
  }

  // ================================================================== clics sur la carte
  const surPointPrecedent = A.surPointCarte;
  A.surPointCarte = (type, id, props) => {
    if (type === "guide" && guideCourant && guideCourant.site.has(id)) return ouvrirSite(guideCourant, guideCourant.site.get(id));
    if (type === "hebergement" && pointsHeb.has(id)) {
      const { ctx, x } = pointsHeb.get(id);
      return ouvrirHebergement(ctx, x);
    }
    if (type === "site" && String(id).startsWith("lieu:")) {
      if (props && props.titre) A.toast(props.titre);
      return;
    }
    return surPointPrecedent && surPointPrecedent(type, id, props);
  };
})();
