/* Atlo · démarrage : textes de l'interface, thème, connexion, installation, service worker, routeur. */
(function () {
  "use strict";
  const A = window.Atlo;
  const { t, I } = A;

  /** Textes statiques de index.html : data-t (contenu), data-t-aria (aria-label), data-t-title. */
  A.traduirePage = () => {
    document.documentElement.lang = I.langue;
    document.documentElement.dir = I.direction();
    document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
    document.querySelectorAll("[data-t-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.tAria)));
    document.querySelectorAll("[data-t-title]").forEach((el) => el.setAttribute("title", t(el.dataset.tTitle)));
  };

  // ---------------------------------------------------------------- thème
  A.appliquerTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (A.prefs.theme === "auto") { A.appliquerTheme(); A.changerThemeCarte(); }
  });
  document.getElementById("bouton-theme").addEventListener("click", () => {
    A.prefs.theme = A.sombre() ? "clair" : "sombre";
    A.enregistrerPrefs();
    A.appliquerTheme();
    A.changerThemeCarte();
    A.toast(A.prefs.theme === "sombre" ? t("themeSombreActif") : t("themeClairActif"));
  });

  // ---------------------------------------------------------------- connexion
  const bandeau = document.getElementById("bandeau-hors-ligne");
  const majConnexion = () => (bandeau.hidden = navigator.onLine !== false);
  window.addEventListener("online", () => { majConnexion(); A.toast(t("deNouveauEnLigne")); });
  window.addEventListener("offline", majConnexion);
  majConnexion();

  // ---------------------------------------------------------------- installation (PWA)
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    A.installation = e;
    document.querySelectorAll("[data-installer]").forEach((b) => (b.hidden = false));
  });
  window.addEventListener("appinstalled", () => {
    A.installation = null;
    document.querySelectorAll("[data-installer]").forEach((b) => (b.hidden = true));
    A.toast(t("installee"));
  });
  document.querySelectorAll("[data-installer]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!A.installation) { A.aller("/aide"); return; }
      A.installation.prompt();
      await A.installation.userChoice.catch(() => null);
      A.installation = null;
      b.hidden = true;
    }));

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    // Première visite : les données déjà chargées passent par le service worker dès qu'il prend la main,
    // pour rester disponibles hors connexion.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      performance.getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin) && /\/(data|vendor)\//.test(u))
        .forEach((u) => fetch(u).catch(() => {}));
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then((reg) => {
        const proposer = (en_attente) => {
          const b = A.h("button", { type: "button", class: "lien", onclick: () => {
            navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
            en_attente.postMessage("activer");
          } }, t("recharger"));
          A.toast(A.h("span", null, t("miseAJour"), " ", b), { duree: 15000 });
        };
        // Mise à jour déjà téléchargée lors d'une visite précédente.
        if (reg.waiting && navigator.serviceWorker.controller) proposer(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const nouveau = reg.installing;
          if (!nouveau) return;
          nouveau.addEventListener("statechange", () => {
            if (nouveau.state === "installed" && navigator.serviceWorker.controller) proposer(reg.waiting || nouveau);
          });
        });
      }).catch(() => { /* hors ligne ou navigation privée : l'application fonctionne sans */ });
    });
  }

  // ---------------------------------------------------------------- fiche (dialogue)
  const fiche = document.getElementById("fiche");
  fiche.addEventListener("click", (e) => {
    if (e.target === fiche) fiche.close();
  });
  fiche.addEventListener("close", () => A.majScene({ choisi: null }));
  document.querySelectorAll("[data-fermer]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  document.getElementById("grand-texte").addEventListener("click", (e) => e.currentTarget.close());

  // ---------------------------------------------------------------- carte plein écran (mobile)
  document.getElementById("bouton-carte-pleine").addEventListener("click", (e) => {
    const plein = document.body.classList.toggle("carte-pleine");
    e.currentTarget.setAttribute("aria-pressed", plein ? "true" : "false");
    e.currentTarget.textContent = plein ? t("reduireCarte") : t("agrandirCarte");
    setTimeout(A.redimensionnerCarte, 260);
  });
  new ResizeObserver(() => A.redimensionnerCarte()).observe(document.getElementById("carte"));
  // L'accueil place la carte du monde différemment sur mobile et sur grand écran.
  matchMedia("(min-width: 960px)").addEventListener("change", () => {
    if (document.body.dataset.vue === "accueil") A.rendre();
  });

  // ---------------------------------------------------------------- raccourcis
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      const champ = document.getElementById("recherche");
      if (champ) { e.preventDefault(); champ.focus(); }
    }
  });

  // ---------------------------------------------------------------- démarrage
  A.traduirePage();
  A.itineraire.maj({});
  window.addEventListener("hashchange", () => {
    const d = document.getElementById("fiche");
    if (d.open && !location.hash.startsWith("#/site/")) d.close();
    A.rendre();
  });
  A.rendre();
  document.documentElement.classList.remove("demarrage");
})();
