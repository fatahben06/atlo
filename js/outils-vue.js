/* Atlo · boîte à outils du voyageur (devises, phrases, urgences, heures, unités, check-list)
   et page d'aide (préférences, installation, hors connexion, dépannage, sources). */
(function () {
  "use strict";
  const A = window.Atlo;
  const { h, t, fmt, S, I } = A;

  function paysContexte(params) {
    const p = params.get("p");
    if (A.PAYS.has(p)) return p;
    const it = A.itineraire.etat().etapes;
    const dernier = A.stock.lire("dernierPays", null);
    if (A.PAYS.has(dernier)) return dernier;
    if (it.length && A.PAYS.has(it[it.length - 1].pays)) return it[it.length - 1].pays;
    return A.prefs.residence;
  }

  function selectPays(valeur, onchange, etiquette) {
    const coll = new Intl.Collator(I.locale());
    const liste = window.ATLO_PAYS.slice().sort((a, b) => coll.compare(A.nomListe(a.n), A.nomListe(b.n)));
    const sel = h("select", { class: "champ", "aria-label": etiquette },
      liste.map((p) => h("option", { value: p.c, selected: p.c === valeur }, A.drapeau(p.c) + " " + A.nomListe(p.n))));
    sel.addEventListener("change", () => onchange(sel.value));
    return sel;
  }

  // ================================================================== OUTILS
  A.route(/^outils$/, async (_, params) => {
    const code = paysContexte(params);
    const p = A.PAYS.get(code);
    const ancre = location.hash.split("#")[2];
    const contenu = h("div", { class: "page-outils" },
      h("h1", null, t("outilsVoyage")),
      h("div", { class: "contexte" },
        h("label", { class: "champ-groupe" }, h("span", null, t("paysDuVoyage")),
          selectPays(code, (c) => A.aller("/outils?p=" + c), t("paysDuVoyage")))),
      h("nav", { class: "puces sommaire", "aria-label": t("sommaire") },
        [["devises", "💱"], ["phrases", "💬"], ["urgences", "🆘"], ["heures", "🕒"], ["unites", "📏"], ["valise", "🧳"]].map(([id, ic]) =>
          h("a", { href: "#/outils?p=" + code + "#" + id, class: "puce", onclick: (e) => { e.preventDefault(); document.getElementById(id).scrollIntoView({ behavior: "smooth" }); } }, ic + " " + t("outil_" + id)))),
      convertisseur(p),
      await phrases(p),
      urgences(p),
      heures(p),
      unites(),
      valise(p));
    return {
      nom: "outils", titre: t("outilsVoyage"), contenu, onglet: "outils", carte: null,
      apres: () => { if (ancre && document.getElementById(ancre)) document.getElementById(ancre).scrollIntoView(); },
    };
  });

  // ---------------------------------------------------------------- devises
  function convertisseur(p) {
    const corps = h("div", null, A.squelette(3));
    const bloc = h("section", { class: "bloc", id: "devises", "aria-labelledby": "titre-devises" },
      h("h2", { id: "titre-devises" }, "💱 ", t("outil_devises")), corps);
    const charger = async () => {
      A.vider(corps, A.squelette(3));
      let tx;
      try { tx = await S.taux(); } catch (e) { A.vider(corps, A.erreurReseau(e, charger)); return; }
      const codes = Object.keys(tx.taux).sort((a, b) => I.nomDevise(a).localeCompare(I.nomDevise(b), I.locale()));
      const option = (c, choisi) => h("option", { value: c, selected: c === choisi }, c + " · " + I.nomDevise(c));
      let de = A.prefs.devise in tx.taux ? A.prefs.devise : "EUR";
      let vers = (p && p.m && p.m.find((c) => c in tx.taux)) || "USD";
      if (vers === de) vers = de === "USD" ? "EUR" : "USD";
      const montant = h("input", { type: "text", inputmode: "decimal", class: "champ grand", value: "100", "aria-label": t("montant") });
      const selDe = h("select", { class: "champ", "aria-label": t("deDevise") }, codes.map((c) => option(c, de)));
      const selVers = h("select", { class: "champ", "aria-label": t("versDevise") }, codes.map((c) => option(c, vers)));
      const resultat = h("output", { class: "resultat-conversion", "aria-live": "polite" });
      const table = h("table", { class: "table-conversion" });
      // Chiffres arabes (٠-٩, ۰-۹) acceptés ; virgule ou point comme séparateur décimal.
      const lire = () => Number(String(montant.value)
        .replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x6f0)
        .replace(/[\s\u00a0\u202f]/g, "").replace(/[٫,]/g, ".")) || 0;
      const calculer = () => {
        de = selDe.value; vers = selVers.value;
        const v = S.convertir(lire(), de, vers, tx);
        resultat.textContent = v == null ? "–" : fmt.argent(lire(), de) + " = " + fmt.argent(v, vers);
        // Paliers adaptés à la devise du pays : 100 à 100 000 yens, 1 à 1 000 euros…
        const echelle = Math.pow(10, Math.max(0, Math.round(Math.log10(tx.taux[vers] / tx.taux.USD))));
        const paliers = [1, 5, 10, 20, 50, 100, 500, 1000].map((x) => x * echelle);
        A.vider(table,
          h("caption", null, t("tableAchats")),
          h("thead", null, h("tr", null, h("th", { scope: "col" }, vers), h("th", { scope: "col" }, de))),
          h("tbody", null, paliers.map((x) => h("tr", null, h("td", null, fmt.argent(x, vers)), h("td", null, fmt.argent(S.convertir(x, vers, de, tx), de))))));
      };
      [montant, selDe, selVers].forEach((el) => el.addEventListener("input", calculer));
      const inverser = h("button", { type: "button", class: "bouton-icone", "aria-label": t("inverser"), onclick: () => {
        const a = selDe.value; selDe.value = selVers.value; selVers.value = a; calculer();
      } }, "⇅");
      calculer();
      A.vider(corps,
        h("div", { class: "convertisseur" }, montant, h("div", { class: "devises-paire" }, selDe, inverser, selVers)),
        resultat, table,
        h("p", { class: "source" },
          t("tauxDu", { d: new Intl.DateTimeFormat(I.locale(), { dateStyle: "medium" }).format(new Date(tx.maj)) }),
          tx.horsLigne ? " · " + t("tauxHorsLigne") : "", " · ",
          A.lienExterne("https://www.exchangerate-api.com", "Rates By Exchange Rate API"),
          " · ", t("tauxIndicatifs")));
    };
    A.quandVisible(bloc, charger);
    return bloc;
  }

  // ---------------------------------------------------------------- phrases
  async function phrases(p) {
    if (!window.ATLO_PHRASES) await A.chargerScript("data/phrases.js").catch(() => null);
    const P = window.ATLO_PHRASES;
    const bloc = h("section", { class: "bloc", id: "phrases", "aria-labelledby": "titre-phrases" }, h("h2", { id: "titre-phrases" }, "💬 ", t("outil_phrases")));
    if (!P) { bloc.appendChild(A.erreurReseau(null)); return bloc; }
    const disponibles = Object.keys(P.langues);
    let langue = (p && P.preferences[p.c]) || (p && p.l && p.l.find((l) => disponibles.includes(l))) || "en";
    if (!disponibles.includes(langue)) langue = "en";
    const coll = new Intl.Collator(I.locale());
    const sel = h("select", { class: "champ", "aria-label": t("langueDesPhrases") },
      disponibles.slice().sort((a, b) => coll.compare(I.nomLangue(a), I.nomLangue(b)))
        .map((l) => h("option", { value: l, selected: l === langue }, I.nomLangue(l) + " · " + I.nomLangue(l, l))));
    const liste = h("ul", { class: "phrases", role: "list" });
    const voixDispo = (l) => "speechSynthesis" in window && speechSynthesis.getVoices().some((v) => v.lang && v.lang.toLowerCase().startsWith(l));
    const parler = (texte, l) => {
      if (!("speechSynthesis" in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texte);
      u.lang = P.voix[l] || l;
      u.rate = 0.85;
      const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith(l));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    };
    const dessiner = () => {
      langue = sel.value;
      const lignes = P.langues[langue];
      const peutParler = voixDispo(langue);
      A.vider(liste, P.cles.map((cle, i) => {
        const [texte, translit] = lignes[i];
        return h("li", { class: "phrase" },
          h("p", { class: "phrase-sens" }, t("ph_" + cle)),
          h("p", { class: "phrase-texte", lang: langue, dir: "auto" }, texte),
          translit ? h("p", { class: "phrase-translit" }, translit) : null,
          h("div", { class: "phrase-actions" },
            h("button", { type: "button", class: "bouton-icone", "aria-label": t("ecouter") + " : " + texte, disabled: !peutParler, title: peutParler ? t("ecouter") : t("voixIndispo"), onclick: () => parler(texte, langue) }, "🔊"),
            h("button", { type: "button", class: "bouton-icone", "aria-label": t("montrerGrand") + " : " + texte, title: t("montrerGrand"), onclick: () => montrerEnGrand(texte, translit, langue) }, "⤢")));
      }));
    };
    sel.addEventListener("change", dessiner);
    if ("speechSynthesis" in window) speechSynthesis.addEventListener("voiceschanged", dessiner, { once: true });
    dessiner();
    bloc.append(sel, liste, h("p", { class: "note" }, t("phrasesNote")));
    return bloc;
  }

  function montrerEnGrand(texte, translit, langue) {
    const d = document.getElementById("grand-texte");
    A.vider(d.querySelector(".grand-texte-corps"),
      h("p", { lang: langue, dir: "auto", class: "grand" }, texte),
      translit ? h("p", { class: "translit" }, translit) : null);
    d.showModal ? d.showModal() : d.setAttribute("open", "");
  }

  // ---------------------------------------------------------------- urgences
  function urgences(p) {
    const tuile = (icone, titre, ...valeur) => h("div", { class: "tuile" },
      h("span", { class: "tuile-icone", "aria-hidden": "true" }, icone),
      h("div", null, h("h3", null, titre), h("div", { class: "tuile-valeur" }, ...valeur)));
    const residence = A.nomPays(A.prefs.residence);
    return h("section", { class: "bloc", id: "urgences", "aria-labelledby": "titre-urgences" },
      h("h2", { id: "titre-urgences" }, "🆘 ", t("outil_urgences"), p ? " · " + A.nomListe(p.n) : ""),
      h("div", { class: "tuiles" }, p ? A.blocUrgences(p, tuile) : null,
        tuile("🏛️", t("ambassade"), A.lienExterne(`https://www.google.com/search?q=${encodeURIComponent(t("rechercheAmbassade", { de: residence, en: p ? A.nomListe(p.n) : "" }))}`, t("trouverAmbassade", { pays: residence })))),
      h("p", { class: "note" }, t("note112")));
  }

  // ---------------------------------------------------------------- heures
  function heures(p) {
    const lignes = [];
    const ici = Intl.DateTimeFormat().resolvedOptions().timeZone;
    lignes.push([t("ici"), ici]);
    if (p && p.z) p.z.slice(0, 6).forEach((z) => lignes.push([A.nomListe(p.n) + (p.z.length > 1 ? " · " + z.split("/").pop().replace(/_/g, " ") : ""), z]));
    const it = A.itineraire.etat().etapes;
    [...new Set(it.map((e) => e.pays).filter((c) => c && A.PAYS.get(c) && c !== (p && p.c)))].slice(0, 4).forEach((c) => {
      const pc = A.PAYS.get(c);
      if (pc.z) lignes.push([A.nomListe(pc.n), (pc.cap && pc.cap.tz) || pc.z[0]]);
    });
    const tbody = h("tbody");
    const maj = () => A.vider(tbody, lignes.map(([nom, tz]) => h("tr", null,
      h("th", { scope: "row" }, nom), h("td", { class: "horloge" }, fmt.heure(tz)), h("td", null, fmt.decalage(tz)),
      h("td", null, tz === ici ? "" : (A.ecartHeures(tz) >= 0 ? "+" : "") + fmt.nombre(A.ecartHeures(tz), 2) + " h"))));
    maj();
    const id = setInterval(maj, 20000);
    A.surNettoyage(() => clearInterval(id));
    return h("section", { class: "bloc", id: "heures", "aria-labelledby": "titre-heures" },
      h("h2", { id: "titre-heures" }, "🕒 ", t("outil_heures")),
      h("table", { class: "table-heures" }, h("thead", null, h("tr", null, h("th", { scope: "col" }, t("lieu")), h("th", { scope: "col" }, t("heure")), h("th", { scope: "col" }, "UTC"), h("th", { scope: "col" }, t("ecart")))), tbody));
  }

  // ---------------------------------------------------------------- unités
  function unites() {
    const paires = [
      ["°C", "°F", (c) => c * 9 / 5 + 32, (f) => (f - 32) * 5 / 9, 25],
      ["km", "mi", (k) => k * 0.621371, (m) => m / 0.621371, 10],
      ["kg", "lb", (k) => k * 2.20462, (l) => l / 2.20462, 20],
      ["L", "gal (US)", (l) => l / 3.78541, (g) => g * 3.78541, 1],
      ["cm", "in", (c) => c / 2.54, (i) => i * 2.54, 30],
    ];
    const lire = (v) => Number(String(v).replace(",", "."));
    return h("section", { class: "bloc", id: "unites", "aria-labelledby": "titre-unites" },
      h("h2", { id: "titre-unites" }, "📏 ", t("outil_unites")),
      h("div", { class: "unites" }, paires.map(([ua, ub, ab, ba, v0]) => {
        const a = h("input", { type: "text", inputmode: "decimal", class: "champ", value: String(v0), "aria-label": ua });
        const b = h("input", { type: "text", inputmode: "decimal", class: "champ", value: fmt.nombre(ab(v0), 2).replace(/\s/g, ""), "aria-label": ub });
        a.addEventListener("input", () => { const x = lire(a.value); b.value = isFinite(x) ? String(Math.round(ab(x) * 100) / 100) : ""; });
        b.addEventListener("input", () => { const x = lire(b.value); a.value = isFinite(x) ? String(Math.round(ba(x) * 100) / 100) : ""; });
        return h("div", { class: "unite" }, h("label", null, a, h("span", null, ua)), h("span", { "aria-hidden": "true" }, "⇄"), h("label", null, b, h("span", null, ub)));
      })));
  }

  // ---------------------------------------------------------------- valise
  const ITEMS = ["passeport", "visa", "assurance", "adaptateur", "medicaments", "copies", "banque", "permis", "sim", "liquide", "vaccins", "chargeur"];
  function valise(p) {
    const etat = A.stock.lire("valise", { faits: {}, perso: [] });
    const enregistrer = () => A.stock.ecrire("valise", etat);
    const liste = h("ul", { class: "valise", role: "list" });
    const dessiner = () => {
      const items = [
        ...ITEMS.map((k) => ({ id: k, texte: t("valise_" + k, { prises: p && p.p ? p.p.split(" ").join(", ") : "?" }) })),
        ...etat.perso.map((x) => ({ id: x.id, texte: x.texte, perso: true })),
      ];
      const faits = items.filter((x) => etat.faits[x.id]).length;
      progression.value = faits;
      progression.max = items.length;
      libelle.textContent = t("valiseProgression", { a: faits, b: items.length });
      A.vider(liste, items.map((x) => {
        const c = h("input", { type: "checkbox", checked: !!etat.faits[x.id] });
        c.addEventListener("change", () => { etat.faits[x.id] = c.checked; enregistrer(); dessiner(); });
        return h("li", { class: etat.faits[x.id] ? "fait" : "" },
          h("label", null, c, " ", x.texte),
          x.perso ? h("button", { type: "button", class: "bouton-icone danger", "aria-label": t("supprimer") + " : " + x.texte, onclick: () => {
            etat.perso = etat.perso.filter((y) => y.id !== x.id); delete etat.faits[x.id]; enregistrer(); dessiner();
          } }, "✕") : null);
      }));
    };
    const progression = h("progress", { class: "progression" });
    const libelle = h("span", { class: "petit" });
    const champ = h("input", { type: "text", class: "champ", placeholder: t("ajouterObjet"), "aria-label": t("ajouterObjet"), maxlength: "80" });
    const form = h("form", { class: "ajout", onsubmit: (e) => {
      e.preventDefault();
      const texte = champ.value.trim();
      if (!texte) return;
      etat.perso.push({ id: "p" + Date.now().toString(36), texte });
      champ.value = "";
      enregistrer();
      dessiner();
    } }, champ, h("button", { type: "submit", class: "bouton" }, t("ajouter")));
    dessiner();
    return h("section", { class: "bloc", id: "valise", "aria-labelledby": "titre-valise" },
      h("h2", { id: "titre-valise" }, "🧳 ", t("outil_valise")),
      h("div", { class: "progression-ligne" }, progression, libelle),
      liste, form,
      h("button", { type: "button", class: "lien", onclick: () => { etat.faits = {}; enregistrer(); dessiner(); } }, t("toutDecocher")));
  }

  // ================================================================== AIDE
  A.route(/^aide$/, () => {
    const prefs = A.prefs;
    const choix = (cle, valeurs, libelles, apres) => {
      const sel = h("select", { class: "champ" }, valeurs.map((v, i) => h("option", { value: v, selected: prefs[cle] === v }, libelles[i])));
      sel.addEventListener("change", () => { prefs[cle] = sel.value; A.enregistrerPrefs(); apres && apres(sel.value); });
      return sel;
    };
    const installe = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const boutonInstaller = h("button", { type: "button", class: "bouton principal", hidden: !A.installation, onclick: async () => {
      if (!A.installation) return;
      A.installation.prompt();
      await A.installation.userChoice.catch(() => null);
      A.installation = null;
      boutonInstaller.hidden = true;
    } }, h("span", { "aria-hidden": "true" }, "⬇ "), t("installerMaintenant"));
    const etatHorsLigne = h("p", { class: "petit", "aria-live": "polite" });
    const contenu = h("div", { class: "page-aide" },
      h("h1", null, t("aideTitre")),
      h("section", { class: "bloc", "aria-labelledby": "titre-prefs" },
        h("h2", { id: "titre-prefs" }, "⚙️ ", t("preferences")),
        h("div", { class: "grille-champs" },
          h("label", { class: "champ-groupe" }, h("span", null, t("langue")),
            choix("langue", ["fr", "en", "es", "ar"], ["Français", "English", "Español", "العربية"], (l) => { I.choisir(l); A.traduirePage(); A.changerLangueCarte(); A.rendre(); })),
          h("label", { class: "champ-groupe" }, h("span", null, t("theme")),
            choix("theme", ["auto", "clair", "sombre"], [t("themeAuto"), t("themeClair"), t("themeSombre")], () => { A.appliquerTheme(); A.changerThemeCarte(); })),
          h("label", { class: "champ-groupe" }, h("span", null, t("unites")),
            choix("unites", ["metrique", "imperial"], [t("metrique"), t("imperial")])),
          h("label", { class: "champ-groupe" }, h("span", null, t("paysResidence")),
            selectPays(prefs.residence, (c) => { prefs.residence = c; prefs.devise = (A.PAYS.get(c).m || [prefs.devise])[0]; A.enregistrerPrefs(); A.rendre(); }, t("paysResidence"))),
          h("label", { class: "champ-groupe" }, h("span", null, t("deviseReference")),
            h("input", { type: "text", class: "champ", value: prefs.devise, maxlength: "3", pattern: "[A-Za-z]{3}", onchange: (e) => {
              const v = e.target.value.trim().toUpperCase();
              if (/^[A-Z]{3}$/.test(v)) { prefs.devise = v; A.enregistrerPrefs(); } else e.target.value = prefs.devise;
            } })))),
      h("section", { class: "bloc", "aria-labelledby": "titre-installer" },
        h("h2", { id: "titre-installer" }, "📲 ", t("installerTitre")),
        installe ? h("p", { class: "statut bon" }, "✓ " + t("dejaInstallee")) : [
          h("p", null, t("installerIntro")),
          boutonInstaller,
          h("ol", { class: "etapes-aide" },
            h("li", null, h("strong", null, "Android (Chrome, Edge, Samsung) : "), t("installerAndroid")),
            h("li", null, h("strong", null, "iPhone / iPad (Safari) : "), t("installerIos")),
            h("li", null, h("strong", null, t("ordinateur") + " (Chrome, Edge) : "), t("installerOrdi")))]),
      h("section", { class: "bloc", "aria-labelledby": "titre-horsligne" },
        h("h2", { id: "titre-horsligne" }, "✈️ ", t("horsLigneTitre")),
        h("p", null, t("horsLigneTexte")),
        h("button", { type: "button", class: "bouton", onclick: () => preparerHorsLigne(etatHorsLigne) }, h("span", { "aria-hidden": "true" }, "⬇ "), t("preparerHorsLigne")),
        etatHorsLigne),
      h("section", { class: "bloc", "aria-labelledby": "titre-depannage" },
        h("h2", { id: "titre-depannage" }, "🛠️ ", t("depannage")),
        ["carte", "position", "meteo", "installation", "donnees", "noms"].map((k) =>
          h("details", { class: "faq" }, h("summary", null, t("faq_" + k + "_q")), h("p", null, t("faq_" + k + "_r"))))),
      h("section", { class: "bloc", "aria-labelledby": "titre-sources" },
        h("h2", { id: "titre-sources" }, "📚 ", t("sourcesTitre")),
        h("ul", { class: "sources" },
          h("li", null, A.lienExterne("https://www.naturalearthdata.com/", "Natural Earth"), " — ", t("srcNaturalEarth")),
          h("li", null, A.lienExterne("https://github.com/mledoze/countries", "mledoze/countries"), " — ", t("srcPays")),
          h("li", null, A.lienExterne("https://openfreemap.org/", "OpenFreeMap"), ", ", A.lienExterne("https://openmaptiles.org/", "OpenMapTiles"), ", ", A.lienExterne("https://www.openstreetmap.org/copyright", "© OpenStreetMap"), " — ", t("srcCartes")),
          h("li", null, A.lienExterne("https://open-meteo.com/", "Open-Meteo"), " — ", t("srcMeteo")),
          h("li", null, A.lienExterne("https://www.wikipedia.org/", "Wikipédia"), " / ", A.lienExterne("https://commons.wikimedia.org/", "Wikimedia Commons"), " — ", t("srcWiki")),
          h("li", null, A.lienExterne("https://www.exchangerate-api.com", "ExchangeRate-API"), " — ", t("srcTaux")),
          h("li", null, A.lienExterne("https://www.openstreetmap.org/copyright", "OpenStreetMap"), " (ODbL), ", A.lienExterne("https://overpass-api.de/", "Overpass API"), " — ", t("srcHebergements")),
          h("li", null, A.lienExterne("https://maplibre.org/", "MapLibre GL JS"), " (BSD-3), ", A.lienExterne("https://github.com/twitter/twemoji", "Twemoji"), " (CC BY 4.0) — ", t("srcLogiciels"))),
        h("p", { class: "mention" }, t("mention"))),
      h("section", { class: "bloc", "aria-labelledby": "titre-donnees" },
        h("h2", { id: "titre-donnees" }, "🔒 ", t("vieprivee")),
        h("p", null, t("viepriveeTexte")),
        h("button", { type: "button", class: "bouton danger", onclick: async () => {
          if (!confirm(t("confirmerEffacer"))) return;
          A.stock.effacer();
          try { localStorage.removeItem("atlo.cache.taux"); } catch (e) { /* rien */ }
          if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
          location.hash = "#/";
          location.reload();
        } }, t("effacerDonnees"))));
    return { nom: "aide", titre: t("aideTitre"), contenu, onglet: "aide", carte: null };
  });

  async function preparerHorsLigne(sortie) {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
      sortie.textContent = t("horsLigneImpossible");
      return;
    }
    const fichiers = window.ATLO_PAYS.map((p) => `data/pays/${p.c}.js`)
      .concat((window.ATLO_GUIDES || []).map((g) => `data/guides/${g.id}.js`))
      .concat(["data/phrases.js", "vendor/maplibre-gl.js", "vendor/maplibre-gl.css", "vendor/mapbox-gl-rtl-text.js"]);
    let faits = 0, echecs = 0;
    sortie.textContent = t("telechargement", { a: 0, b: fichiers.length });
    const lot = 8;
    for (let i = 0; i < fichiers.length; i += lot) {
      // 404 : petit territoire sans fichier de régions, ce n'est pas un échec.
      const ok = await Promise.all(fichiers.slice(i, i + lot).map((f) => fetch(f).then((r) => r.ok || r.status === 404, () => false)));
      echecs += ok.filter((x) => !x).length;
      faits = Math.min(fichiers.length, i + lot);
      sortie.textContent = t("telechargement", { a: faits, b: fichiers.length });
    }
    sortie.textContent = echecs ? "⚠ " + t("horsLignePartiel", { n: echecs }) : "✓ " + t("horsLignePret");
  }
})();
