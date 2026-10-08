// Gold AI — navigation entre les sections + enregistrement du service worker (PWA).

document.addEventListener("DOMContentLoaded", () => {
  const onglets = document.querySelectorAll("nav.barre-onglets button.onglet");
  const sections = document.querySelectorAll("main .section");

  function allerA(cible) {
    // « alertes » = Analyse › volet Suivre le prix, déplié (ouvert depuis une notification d'alerte).
    if (cible === "alertes") {
      allerA("analyse");
      const volet = document.getElementById("journal-alertes");
      if (volet) volet.open = true;
      volet?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    onglets.forEach((o) => o.classList.toggle("actif", o.dataset.section === (cible === "formation" ? "profil" : cible)));
    // Rectangle du haut (objectif / garde-fou) : caché dans Profil et Journal.
    document.getElementById("barre-haut")?.classList.toggle("cachee-onglet", cible === "profil" || cible === "journal" || cible === "formation");
    // Sens de l'animation : vers la droite si l'onglet choisi est après l'actuel, sinon vers la gauche.
    const ordre = [...onglets].map((o) => o.dataset.section);
    const avant = ordre.indexOf(document.querySelector("main .section.actif")?.id.replace("section-", ""));
    const apres = ordre.indexOf(cible);
    const sens = avant < 0 || apres < 0 || avant === apres ? "" : apres > avant ? "vers-droite" : "vers-gauche";
    sections.forEach((s) => {
      const visee = s.id === `section-${cible}`;
      if (visee && s.classList.contains("actif")) return; // déjà affichée : pas d'animation
      s.classList.remove("vers-gauche", "vers-droite");
      if (visee && sens) s.classList.add(sens);
      s.classList.toggle("actif", visee);
    });

    // Charge les données à la demande, seulement au premier affichage de l'onglet.
    // Journal n'a pas besoin d'être ici : sa vue calendrier se charge elle-même
    // au clic sur la tuile "Calendrier" de l'accueil du journal (voir journal.js).
    if (cible === "marche" && window.GoldAI?.marche?.charger) {
      window.GoldAI.marche.charger();
    }
    // Trades restants + prochaine annonce : n'apparaissent qu'après un calcul.
    window.GoldAI?.discipline?.masquer();
    if (cible === "calendrier" && window.GoldAI?.calendrier?.charger) {
      window.GoldAI.calendrier.charger();
    }
    if (cible === "analyse") {
      window.GoldAI?.analyseIa?.rafraichir();
      window.GoldAI?.alertesPrix?.ouvrir();
    }
    if (cible === "calculateur") {
      // Trades TradeLocker importés tout seuls (au plus 1 fois par minute) : le garde-fou
      // et le calculateur voient les trades du jour sans toucher « Actualiser les trades ».
      window.GoldAI?.journal?.actualiserTrades?.({ auto: true });
      window.GoldAI?.gardeFou?.afficherAlerteAnnonce();
      window.GoldAI?.calculateur?.restaurer();
    }
    if (cible === "profil" || cible === "calendrier") {
      window.GoldAI?.notifications?.rafraichir();
    }
    if (cible === "formation") window.GoldAI?.formation?.ouvrir();
    if (cible === "profil" && window.GoldAI?.profilCompte?.charger) {
      window.GoldAI.profilCompte.charger();
    }

    // Section Chat mise de côté (voir mis-de-cote/chat/LISEZMOI.md) : pour la
    // remettre, rajouter ici le démarrage/arrêt de son rafraîchissement.
  }

  onglets.forEach((onglet) => {
    onglet.addEventListener("click", () => allerA(onglet.dataset.section));
  });
  // Formation : ouverte depuis la tuile de Profil (pas d'onglet en bas).
  document.getElementById("bouton-ouvrir-formation")?.addEventListener("click", () => allerA("formation"));

  // Rectangle du haut (garde-fou + objectif) : la croix le masque jusqu'à la
  // prochaine ouverture de l'app (rien n'est enregistré : il revient au
  // lancement et chaque fois qu'on revient sur l'app).
  const barreHaut = document.getElementById("barre-haut");
  document.getElementById("fermer-barre-haut")?.addEventListener("click", () => barreHaut.classList.add("masquee"));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    barreHaut?.classList.remove("masquee");
    if (document.getElementById("section-calculateur")?.classList.contains("actif")) window.GoldAI?.journal?.actualiserTrades?.({ auto: true });
  });

  // Toucher une notification d'annonce (app déjà ouverte) → page Annonces.
  navigator.serviceWorker?.addEventListener("message", (e) => {
    if (e.data?.type === "aller" && window.GoldAI.auth?.getToken()) allerA(e.data.section);
  });

  // Téléphone : en ouvrant le clavier (ou après un défilement automatique), le
  // navigateur fait parfois glisser TOUTE la page vers le haut et ne la remet pas en
  // place → la barre d'onglets du bas disparaît sous l'écran. On la recale dès que
  // le clavier se ferme ou que la page a glissé (jamais pendant la saisie).
  const saisieEnCours = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  const recaler = () => {
    if (saisieEnCours()) return;
    if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  };
  window.addEventListener("scroll", recaler, { passive: true });
  document.addEventListener("focusout", () => setTimeout(recaler, 150));
  window.visualViewport?.addEventListener("resize", () => setTimeout(recaler, 150));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) recaler(); });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.app = { allerA };
});

// Enregistrement du service worker : c'est ce qui rend l'app installable
// et utilisable hors-ligne. Aucun coût, tourne entièrement en local.
//
// updateViaCache: "none" force le navigateur à toujours revérifier sur le
// serveur si service-worker.js a changé, plutôt que de faire confiance à son
// cache HTTP habituel (10 minutes sur GitHub Pages) — sans ça, une mise à
// jour peut mettre plusieurs minutes, voire rester bloquée, avant d'être vue.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js", { updateViaCache: "none" })
      .catch((erreur) => {
        console.warn("Service worker non enregistré :", erreur);
      });
  });
}
