// Gold AI — navigation entre les sections + enregistrement du service worker (PWA).

document.addEventListener("DOMContentLoaded", () => {
  const onglets = document.querySelectorAll("nav.barre-onglets button.onglet");
  const sections = document.querySelectorAll("main .section");

  function allerA(cible) {
    onglets.forEach((o) => o.classList.toggle("actif", o.dataset.section === cible));
    sections.forEach((s) => s.classList.toggle("actif", s.id === `section-${cible}`));

    // Charge les données à la demande, seulement au premier affichage de l'onglet.
    // Journal n'a pas besoin d'être ici : sa vue calendrier se charge elle-même
    // au clic sur la tuile "Calendrier" de l'accueil du journal (voir journal.js).
    if (cible === "marche" && window.GoldAI?.marche?.charger) {
      window.GoldAI.marche.charger();
    }
    if (cible === "calendrier" && window.GoldAI?.calendrier?.charger) {
      window.GoldAI.calendrier.charger();
    }
  }

  onglets.forEach((onglet) => {
    onglet.addEventListener("click", () => allerA(onglet.dataset.section));
  });

  // Raccourci dans Journal : consulter le calendrier économique sans perdre
  // de vue qu'on était en train de remplir ses trades.
  document.getElementById("bouton-raccourci-calendrier")?.addEventListener("click", () => {
    allerA("calendrier");
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
