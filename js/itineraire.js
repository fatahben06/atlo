/* Atlo · itinéraire : état persistant, planification jour par jour, exports et partage. */
(function () {
  "use strict";
  const A = window.Atlo;
  const { h, t, fmt, O } = A;

  // ================================================================== état
  const DEFAUT = { titre: "", debut: "", mode: "voiture", heuresParJour: 8, etapes: [] };
  let etat = Object.assign({}, DEFAUT, A.stock.lire("itineraire", {}));
  etat.etapes = (etat.etapes || []).filter((e) => e && isFinite(e.lat) && isFinite(e.lon));
  const abonnes = new Set();

  const nouvelId = () => "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function enregistrer() {
    A.stock.ecrire("itineraire", etat);
    const n = etat.etapes.length;
    document.querySelectorAll("[data-badge-itineraire]").forEach((b) => {
      b.textContent = n ? fmt.nombre(n) : "";
      b.hidden = !n;
    });
    const stat = document.getElementById("stat-itineraire");
    if (stat) stat.textContent = fmt.nombre(n);
    for (const a of [...abonnes]) {
      if (a.el && !a.el.isConnected) { abonnes.delete(a); continue; }
      try { a.f(); } catch (e) { console.error(e); }
    }
  }

  A.itineraire = {
    etat: () => etat,
    contient: (ref) => etat.etapes.some((e) => e.ref === ref),
    ecouter(f, el) { abonnes.add({ f, el }); },
    ajouter(etape, { silencieux = false } = {}) {
      etat.etapes.push(Object.assign({ duree: 90 }, etape, { id: nouvelId() }));
      enregistrer();
      if (!silencieux) A.toast(t("ajoute", { nom: etape.nom }));
    },
    retirer(id) {
      const e = etat.etapes.find((x) => x.id === id || x.ref === id);
      etat.etapes = etat.etapes.filter((x) => x !== e);
      enregistrer();
      if (e) A.toast(t("retire", { nom: e.nom }));
    },
    basculer(etape) {
      if (this.contient(etape.ref)) this.retirer(etape.ref);
      else this.ajouter(etape);
    },
    deplacer(de, vers) {
      if (vers < 0 || vers >= etat.etapes.length || de === vers) return;
      const [e] = etat.etapes.splice(de, 1);
      etat.etapes.splice(vers, 0, e);
      enregistrer();
    },
    maj(patch) { Object.assign(etat, patch); enregistrer(); },
    majEtape(id, patch) {
      const e = etat.etapes.find((x) => x.id === id);
      if (e) { Object.assign(e, patch); enregistrer(); }
    },
    remplacer(nouvel) { etat = Object.assign({}, DEFAUT, nouvel); enregistrer(); },
    vider() { etat = Object.assign({}, DEFAUT); enregistrer(); },
    plan: () => O.planifier(etat.etapes, { mode: etat.mode, minutesParJour: etat.heuresParJour * 60 }),
  };

  // Synchronisation entre onglets ouverts.
  window.addEventListener("storage", (e) => {
    if (e.key === "atlo.itineraire" && e.newValue) {
      try { etat = Object.assign({}, DEFAUT, JSON.parse(e.newValue)); enregistrer(); } catch (err) { /* rien */ }
    }
  });

  const ICONES_MODE = { voiture: "🚗", transport: "🚆", velo: "🚲", pied: "🚶" };
  const DUREES = [0, 30, 60, 90, 120, 180, 240, 360, 480];

  function dateJour(numero) {
    if (!etat.debut) return null;
    const [a, m, j] = etat.debut.split("-").map(Number);
    const d = new Date(Date.UTC(a, m - 1, j + numero - 1, 12));
    return new Intl.DateTimeFormat(A.I.locale(), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
  }

  // ================================================================== vue
  A.route(/^itineraire$/, (_, params) => {
    const conteneur = h("div", { class: "page-itineraire" });
    const partage = params.get("i");
    let importe = null;
    if (partage) {
      try { importe = O.decoderItineraire(partage); } catch (e) { A.toast(t("lienInvalide")); }
    }

    const dessiner = () => {
      const plan = A.itineraire.plan();
      const n = etat.etapes.length;
      const scene = {
        etapes: etat.etapes.map((e) => ({ id: e.id, lat: e.lat, lon: e.lon, titre: e.nom })),
        points: [], decouvertes: [], zoomMax: 12, cadrer: true,
      };
      A.etat.scene = scene;
      A.afficherCarte(n ? scene : null);

      A.vider(conteneur,
        h("nav", { class: "fil", "aria-label": t("filAriane") }, h("a", { href: "#/" }, t("explorer")), h("span", { "aria-hidden": "true" }, " › "), h("span", { "aria-current": "page" }, t("monItineraire"))),
        h("h1", null, t("monItineraire")),
        importe ? banniereImport(importe) : null,
        n ? reglages() : null,
        n ? resume(plan) : null,
        n ? actions(plan) : null,
        n ? plan.jours.map((j) => jour(j, plan)) : vide(),
        n ? h("p", { class: "mention" }, t("estimationTrajets")) : null);
    };

    function banniereImport(it) {
      return h("section", { class: "banniere", role: "region", "aria-label": t("itinerairePartage") },
        h("p", null, h("strong", null, t("itinerairePartage")), " ", (it.titre ? "« " + it.titre + " » · " : "") + t("nEtapes", { n: it.etapes.length })),
        h("div", { class: "actions" },
          h("button", { type: "button", class: "bouton principal", onclick: () => { A.itineraire.remplacer(it); importe = null; history.replaceState(null, "", "#/itineraire"); dessiner(); A.toast(t("importe")); } }, t("remplacerLeMien")),
          etat.etapes.length ? h("button", { type: "button", class: "bouton", onclick: () => {
            it.etapes.forEach((e) => A.itineraire.ajouter(Object.assign({}, e, { id: undefined }), { silencieux: true }));
            importe = null; history.replaceState(null, "", "#/itineraire"); dessiner(); A.toast(t("importe"));
          } }, t("ajouterALaSuite")) : null,
          h("button", { type: "button", class: "bouton", onclick: () => { importe = null; history.replaceState(null, "", "#/itineraire"); dessiner(); } }, t("ignorer"))));
    }

    function reglages() {
      const titre = h("input", { type: "text", class: "champ", value: etat.titre, placeholder: t("titreVoyagePlaceholder"), maxlength: "120", "aria-label": t("titreVoyage") });
      titre.addEventListener("change", () => A.itineraire.maj({ titre: titre.value.trim() }));
      const debut = h("input", { type: "date", class: "champ", value: etat.debut, id: "date-debut" });
      debut.addEventListener("change", () => { A.itineraire.maj({ debut: debut.value }); dessiner(); });
      const mode = h("select", { class: "champ", id: "mode-trajet" },
        Object.keys(O.MODES).map((m) => h("option", { value: m, selected: etat.mode === m }, ICONES_MODE[m] + " " + t("mode_" + m))));
      mode.addEventListener("change", () => { A.itineraire.maj({ mode: mode.value }); dessiner(); });
      const heures = h("select", { class: "champ", id: "heures-jour" },
        [4, 5, 6, 7, 8, 9, 10, 11, 12].map((x) => h("option", { value: x, selected: etat.heuresParJour === x }, t("heures", { n: x }))));
      heures.addEventListener("change", () => { A.itineraire.maj({ heuresParJour: Number(heures.value) }); dessiner(); });
      return h("section", { class: "bloc reglages" },
        h("label", { class: "champ-groupe large" }, h("span", null, t("titreVoyage")), titre),
        h("label", { class: "champ-groupe" }, h("span", null, t("dateDepart")), debut),
        h("label", { class: "champ-groupe" }, h("span", null, t("modeTrajet")), mode),
        h("label", { class: "champ-groupe" }, h("span", null, t("heuresParJour")), heures));
    }

    function resume(plan) {
      return h("dl", { class: "stats stats-itineraire" },
        h("div", null, h("dt", null, t("etapes")), h("dd", null, fmt.nombre(etat.etapes.length))),
        h("div", null, h("dt", null, t("jours")), h("dd", null, fmt.nombre(plan.jours.length))),
        h("div", null, h("dt", null, t("distance")), h("dd", null, fmt.distance(plan.totalKm * O.MODES[etat.mode].detour))),
        h("div", null, h("dt", null, t("trajets")), h("dd", null, fmt.duree(plan.totalTrajet))),
        h("div", null, h("dt", null, t("visites")), h("dd", null, fmt.duree(plan.totalVisite))));
    }

    function actions(plan) {
      const avant = O.longueur(etat.etapes, etat.etapes.map((_, i) => i));
      const optimiser = h("button", {
        type: "button", class: "bouton principal", disabled: etat.etapes.length < 3,
        onclick: () => {
          const nouvel = O.optimiser(etat.etapes);
          const apres = O.longueur(nouvel, nouvel.map((_, i) => i));
          if (avant - apres < 0.5) { A.toast(t("dejaOptimal")); return; }
          A.itineraire.maj({ etapes: nouvel });
          dessiner();
          A.toast(t("optimise", { d: fmt.distance((avant - apres) * O.MODES[etat.mode].detour) }));
        },
      }, h("span", { "aria-hidden": "true" }, "✨ "), t("optimiser"));
      const google = etat.etapes.length <= 10
        ? A.lienExterne(O.lienGoogleItineraire(etat.etapes, etat.mode), h("span", { "aria-hidden": "true" }, "🗺️ "), t("ouvrirGoogle"))
        : null;
      const urlPartage = () => location.origin + location.pathname + "#/itineraire?i=" + O.encoderItineraire(etat);
      const nomFichier = (ext) => (O.normaliser(etat.titre || "atlo-itineraire").replace(/ /g, "-") || "atlo") + "." + ext;
      return h("section", { class: "bloc barre-actions", "aria-label": t("actionsItineraire") },
        optimiser, google,
        h("button", { type: "button", class: "bouton", onclick: () => A.partager({ titre: etat.titre || t("monItineraire"), texte: t("partageTexte", { n: etat.etapes.length }), url: urlPartage() }) },
          h("span", { "aria-hidden": "true" }, "↗ "), t("partager")),
        h("details", { class: "menu" },
          h("summary", { class: "bouton" }, h("span", { "aria-hidden": "true" }, "⬇ "), t("exporter")),
          h("div", { class: "menu-liste" },
            h("button", { type: "button", class: "lien", onclick: () => A.telecharger(nomFichier("gpx"), O.gpx(etat), "application/gpx+xml") }, t("exportGpx")),
            h("button", { type: "button", class: "lien", onclick: () => {
              if (!etat.debut) { A.toast(t("choisirDate")); const d = document.getElementById("date-debut"); if (d) d.focus(); return; }
              A.telecharger(nomFichier("ics"), O.ics(etat, plan), "text/calendar");
            } }, t("exportAgenda")),
            h("button", { type: "button", class: "lien", onclick: () => window.print() }, t("imprimer")),
            h("button", { type: "button", class: "lien danger", onclick: () => { if (confirm(t("confirmerVider"))) { A.itineraire.vider(); dessiner(); } } }, t("toutEffacer")))));
    }

    function jour(j) {
      const date = dateJour(j.numero);
      return h("section", { class: "bloc jour", "aria-labelledby": "jour-" + j.numero },
        h("div", { class: "titre-ligne" },
          h("h2", { id: "jour-" + j.numero }, t("jourN", { n: j.numero }), date ? h("span", { class: "date-jour" }, " · " + date) : null),
          j.etapes.length > 1 && j.etapes.length <= 10 ? A.lienExterne(O.lienGoogleItineraire(j.etapes.map((p) => p.etape), etat.mode), t("navigationJour")) : null),
        h("p", { class: "petit" }, t("resumeJour", { e: j.etapes.length, km: fmt.distance(j.km * O.MODES[etat.mode].detour), d: fmt.duree(j.minutes) })),
        h("ol", { class: "etapes", role: "list" }, j.etapes.map((p, k) => etape(p, k === 0 && j.numero > 1))));
    }

    function etape(p, debutJournee) {
      const e = p.etape;
      const index = etat.etapes.indexOf(e);
      const duree = h("select", { class: "select-petit", "aria-label": t("dureeVisite") + " : " + e.nom },
        DUREES.map((m) => h("option", { value: m, selected: Number(e.duree) === m }, m ? fmt.duree(m) : t("passage"))));
      duree.addEventListener("change", () => { A.itineraire.majEtape(e.id, { duree: Number(duree.value) }); dessiner(); });
      const coupure = h("input", { type: "checkbox", checked: !!e.nouveauJour });
      coupure.addEventListener("change", () => { A.itineraire.majEtape(e.id, { nouveauJour: coupure.checked }); dessiner(); });
      const poignee = h("button", { type: "button", class: "poignee", "aria-label": t("deplacer") + " : " + e.nom, title: t("deplacerAide") }, "⠿");
      poignee.addEventListener("keydown", (ev) => {
        if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
        ev.preventDefault();
        const vers = index + (ev.key === "ArrowUp" ? -1 : 1);
        if (vers < 0 || vers >= etat.etapes.length) return;
        A.itineraire.deplacer(index, vers);
        dessiner();
        const el = conteneur.querySelector(`[data-etape="${e.id}"] .poignee`);
        if (el) el.focus();
      });
      glisser(poignee, index);
      const site = e.ref && e.ref.startsWith("s:") ? A.SITE.get(e.ref.slice(2)) : null;
      return h("li", { class: "etape", dataset: { etape: e.id } },
        p.trajet || index > 0 ? h("p", { class: "trajet" + (p.long ? " long" : "") },
          h("span", { "aria-hidden": "true" }, ICONES_MODE[etat.mode] + " "),
          debutJournee ? t("trajetDepuisVeille") + " · " : "",
          fmt.duree(p.trajet) + " · " + fmt.distance(p.km * O.MODES[etat.mode].detour),
          p.long ? h("span", { class: "statut attention" }, " ⚠ " + t("trajetLong")) : null) : null,
        h("div", { class: "etape-ligne" },
          poignee,
          h("span", { class: "numero", "aria-hidden": "true" }, index + 1),
          h("div", { class: "etape-texte" },
            site ? h("button", { type: "button", class: "lien etape-nom", onclick: () => A.ouvrirFiche(site.id) }, e.nom) : h("span", { class: "etape-nom" }, e.nom),
            h("span", { class: "site-meta" },
              e.pays ? h("span", { class: "drapeau", "aria-hidden": "true" }, A.drapeau(e.pays)) : null, e.pays ? " " + A.nomPays(e.pays) + " · " : "",
              O.heureMinutes(p.arrivee) + (e.duree ? " – " + O.heureMinutes(p.depart) : ""))),
          h("div", { class: "etape-actions" },
            h("button", { type: "button", class: "bouton-icone", "aria-label": t("monter") + " : " + e.nom, disabled: index === 0, onclick: () => { A.itineraire.deplacer(index, index - 1); dessiner(); } }, "↑"),
            h("button", { type: "button", class: "bouton-icone", "aria-label": t("descendre") + " : " + e.nom, disabled: index === etat.etapes.length - 1, onclick: () => { A.itineraire.deplacer(index, index + 1); dessiner(); } }, "↓"),
            h("button", { type: "button", class: "bouton-icone danger", "aria-label": t("retirerDe") + " : " + e.nom, onclick: () => { A.itineraire.retirer(e.id); dessiner(); } }, "✕"))),
        h("div", { class: "etape-options" },
          h("label", null, t("dureeVisite") + " ", duree),
          index > 0 ? h("label", { class: "case" }, coupure, " " + t("nouvelleJournee")) : null,
          A.lienExterne(A.liens.itineraire(e.lat, e.lon), t("yAller"))));
    }

    /** Glisser-déposer au doigt ou à la souris depuis la poignée. */
    function glisser(poignee, index) {
      poignee.addEventListener("pointerdown", (ev) => {
        if (ev.button > 0) return;
        ev.preventDefault();
        poignee.setPointerCapture(ev.pointerId);
        const item = poignee.closest(".etape");
        item.classList.add("glisse");
        let cible = null;
        const deplacer = (e) => {
          const sous = document.elementFromPoint(e.clientX, e.clientY);
          const li = sous && sous.closest(".etape");
          conteneur.querySelectorAll(".cible-avant, .cible-apres").forEach((x) => x.classList.remove("cible-avant", "cible-apres"));
          if (!li || li === item) { cible = null; return; }
          const r = li.getBoundingClientRect();
          const apres = e.clientY > r.top + r.height / 2;
          li.classList.add(apres ? "cible-apres" : "cible-avant");
          const i = etat.etapes.findIndex((x) => x.id === li.dataset.etape);
          cible = apres ? i + (i < index ? 1 : 0) : i - (i > index ? 1 : 0);
          if (e.clientY < 80) window.scrollBy(0, -12);
          if (e.clientY > innerHeight - 80) window.scrollBy(0, 12);
        };
        const fin = () => {
          poignee.removeEventListener("pointermove", deplacer);
          poignee.removeEventListener("pointerup", fin);
          poignee.removeEventListener("pointercancel", fin);
          item.classList.remove("glisse");
          if (cible != null && cible !== index) { A.itineraire.deplacer(index, Math.max(0, Math.min(etat.etapes.length - 1, cible))); dessiner(); }
          else conteneur.querySelectorAll(".cible-avant, .cible-apres").forEach((x) => x.classList.remove("cible-avant", "cible-apres"));
        };
        poignee.addEventListener("pointermove", deplacer);
        poignee.addEventListener("pointerup", fin);
        poignee.addEventListener("pointercancel", fin);
      });
    }

    function vide() {
      return h("div", { class: "vide-doux" },
        h("p", { class: "illustration", "aria-hidden": "true" }, "🧭"),
        h("h2", null, t("itineraireVide")),
        h("p", null, t("itineraireVideTexte")),
        h("div", { class: "actions" },
          h("a", { href: "#/", class: "bouton principal" }, t("explorerLeMonde")),
          h("a", { href: "#/autour", class: "bouton" }, t("autourDeMoi"))));
    }

    return {
      nom: "itineraire", titre: t("monItineraire"), contenu: conteneur, onglet: "itineraire", carte: null,
      apres: () => {
        dessiner();
        // Mise à jour si une étape est ajoutée depuis une fiche ouverte au-dessus.
        A.itineraire.ecouter(() => { if (location.hash.startsWith("#/itineraire") && !conteneur.contains(document.activeElement)) dessiner(); }, conteneur);
      },
    };
  });
})();
