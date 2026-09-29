// Gold AI — navigation entre les sections + enregistrement du service worker (PWA).

document.addEventListener("DOMContentLoaded", () => {
  const onglets = document.querySelectorAll("nav.barre-onglets button.onglet");
  const sections = document.querySelectorAll("main .section");

  function allerA(cible) {
    // « alertes » = Journal › Suivre le prix (ouvert depuis une notification d'alerte).
    if (cible === "alertes") {
      allerA("journal");
      window.GoldAI?.alertesPrix?.ouvrir();
      return;
    }
    onglets.forEach((o) => o.classList.toggle("actif", o.dataset.section === cible));
    sections.forEach((s) => s.classList.toggle("actif", s.id === `section-${cible}`));

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
      window.GoldAI?.analyseTrades?.afficher();
    }
    if (cible === "calculateur") {
      window.GoldAI?.gardeFou?.afficherAlerteAnnonce();
    }
    if (cible === "profil" || cible === "calendrier") {
      window.GoldAI?.notifications?.rafraichir();
    }
    if (cible === "profil" && window.GoldAI?.profilCompte?.charger) {
      window.GoldAI.profilCompte.charger();
    }

    // Section Chat mise de côté (voir mis-de-cote/chat/LISEZMOI.md) : pour la
    // remettre, rajouter ici le démarrage/arrêt de son rafraîchissement.
  }

  onglets.forEach((onglet) => {
    onglet.addEventListener("click", () => allerA(onglet.dataset.section));
  });

  // Rectangle du haut (garde-fou + objectif) : la croix le masque jusqu'à la
  // prochaine ouverture de l'app (rien n'est enregistré : il revient au
  // lancement et chaque fois qu'on revient sur l'app).
  const barreHaut = document.getElementById("barre-haut");
  document.getElementById("fermer-barre-haut")?.addEventListener("click", () => barreHaut.classList.add("masquee"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) barreHaut?.classList.remove("masquee"); });

  // Toucher une notification d'annonce (app déjà ouverte) → page Annonces.
  navigator.serviceWorker?.addEventListener("message", (e) => {
    if (e.data?.type === "aller" && window.GoldAI.auth?.getToken()) allerA(e.data.section);
  });

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
