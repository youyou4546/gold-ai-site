// Gold AI — navigation entre les 4 sections + enregistrement du service worker (PWA).

document.addEventListener("DOMContentLoaded", () => {
  const onglets = document.querySelectorAll("nav.barre-onglets button.onglet");
  const sections = document.querySelectorAll("main .section");

  onglets.forEach((onglet) => {
    onglet.addEventListener("click", () => {
      const cible = onglet.dataset.section;

      onglets.forEach((o) => o.classList.toggle("actif", o === onglet));
      sections.forEach((s) => s.classList.toggle("actif", s.id === `section-${cible}`));

      // Charge les données à la demande, seulement au premier affichage de l'onglet
      if (cible === "calendrier" && window.GoldAI?.calendrier?.charger) {
        window.GoldAI.calendrier.charger();
      }
      if (cible === "journal" && window.GoldAI?.journal?.afficherMoisCourant) {
        window.GoldAI.journal.afficherMoisCourant();
      }
    });
  });
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
