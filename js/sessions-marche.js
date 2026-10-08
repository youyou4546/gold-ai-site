// Gold AI — Marché › « Session de marché », juste sous le prix de l'or.
//
// Montre quelle(s) session(s) sont ouvertes (Asie, Londres, New York — deux à
// la fois pendant un chevauchement), ou « Aucune session majeure active » avec
// la prochaine ouverture. Horaires UTC du robot (noyau.sessionsMarche),
// toujours affichés en heure du Québec (America/Toronto), changements d'heure
// compris.
(() => {
  const { esc } = window.GoldAI.utils;
  const N = window.GoldAI.noyau;
  const FUSEAU_QUEBEC = "America/Toronto";

  const fmt = (ms, options) => new Intl.DateTimeFormat("fr-CA", { timeZone: FUSEAU_QUEBEC, ...options }).format(new Date(ms));
  const heureQc = (ms) => fmt(ms, { hour: "2-digit", minute: "2-digit", hour12: false });
  const jourQc = (ms) => fmt(ms, { year: "numeric", month: "2-digit", day: "2-digit" });

  // « à 20 h 00 », ou « dim. à 20 h 00 » si ce n'est pas aujourd'hui (au Québec).
  function quand(ms, maintenant) {
    return jourQc(ms) === jourQc(maintenant) ? `à ${heureQc(ms)}` : `${fmt(ms, { weekday: "short" })} à ${heureQc(ms)}`;
  }

  function html(maintenant) {
    const { actives, sessions, prochaine } = N.sessionsMarche(maintenant);
    const statut = actives.length
      ? `<span class="point-session actif"></span><strong>${actives.map((s) => esc(s.nom)).join(" + ")}</strong>&nbsp;${actives.length > 1 ? "ouvertes" : "ouverte"}`
      : `<span class="point-session"></span>Aucune session majeure active${prochaine ? ` · <span class="texte-attenue">prochaine : ${esc(prochaine.nom)} ${quand(prochaine.debutMs, maintenant)}</span>` : ""}`;
    // Chevauchement (deux sessions ouvertes) : les deux cases sont entourées en mauve-rose.
    const chevauchement = actives.length > 1;
    const cases = sessions.map((s) => `
      <div class="case-session${s.active ? " active" : ""}${s.active && chevauchement ? " chevauchement" : ""}">
        <span class="nom-session">${esc(s.nom)}</span>
        <span class="heures-session"><span>${heureQc(s.debutMs)} –</span> <span>${heureQc(s.finMs)}</span></span>
      </div>`).join("");
    return `
      <h3 class="titre-bloc-annonces">Session de marché</h3>
      <div class="carte carte-sessions">
        <div class="statut-session">${statut}</div>
        <div class="grille-sessions">${cases}</div>
        <p class="note-sessions">Heure du Québec</p>
      </div>`;
  }

  let dernier = "";
  function afficher() {
    const zone = document.getElementById("sessions-marche");
    if (!zone || !document.getElementById("section-marche")?.classList.contains("actif")) return;
    const contenu = html(Date.now());
    if (contenu !== dernier) { zone.innerHTML = contenu; dernier = contenu; } // redessiné seulement si ça change
  }

  document.addEventListener("DOMContentLoaded", afficher);
  setInterval(afficher, 15000);
  window.addEventListener("goldai:donnees", afficher);
  window.addEventListener("goldai:cotation", afficher); // réaffiche dès que la section Marché redevient visible

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.sessionsMarche = { afficher };
})();
