// Gold AI — Section Marché : suivi des actifs qui influencent l'or (DXY,
// rendement US 10 ans, argent). Lit site/data/marche.json, généré par
// site/sync_marche.py (Yahoo Finance / Twelve Data — voir ce script).
(() => {
  let dejaCharge = false;

  function formaterPrix(cle, prix) {
    if (cle === "rendement10ans") return `${prix.toFixed(3)}%`;
    return prix.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  }

  function creerCarteActif(actif) {
    const div = document.createElement("div");
    div.className = "carte-actif";

    if (actif.erreur) {
      div.innerHTML = `
        <div class="nom-actif">${actif.nom}</div>
        <div class="etat-vide" style="padding:10px 0;">Indisponible pour l'instant</div>
      `;
      return div;
    }

    const hausse = actif.variation_pct >= 0;
    const classeVariation = hausse ? "positif" : "negatif";
    const signeVariation = hausse ? "+" : "";

    div.innerHTML = `
      <div class="entete-actif">
        <div class="nom-actif">${actif.nom}</div>
        <span class="pastille-correlation">
          ${actif.correlation === "inverse" ? "⇅ Corrélation inverse" : "⇄ Corrélation positive"}
        </span>
      </div>
      <div class="ligne-prix-actif">
        <div class="prix-actif">${formaterPrix(actif.cle, actif.prix)}</div>
        <div class="variation-actif ${classeVariation}">${signeVariation}${actif.variation_pct.toFixed(2)}%</div>
      </div>
      <div class="explication-correlation">${actif.correlation_explication}</div>
    `;
    return div;
  }

  async function charger() {
    if (dejaCharge) return;
    dejaCharge = true;

    const liste = document.getElementById("liste-actifs-marche");
    const dateAffichee = document.getElementById("date-marche");
    liste.innerHTML = `<p class="etat-vide">Chargement…</p>`;

    try {
      const reponse = await fetch("data/marche.json", { cache: "no-store" });
      const contenu = await reponse.json();

      dateAffichee.textContent = contenu.genere_le
        ? `Mis à jour ${new Date(contenu.genere_le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
        : "";

      const actifs = contenu.actifs || [];
      liste.innerHTML = "";

      if (actifs.length === 0) {
        liste.innerHTML = `<p class="etat-vide">Aucune donnée pour l'instant.</p>`;
        return;
      }

      actifs.forEach((actif) => liste.appendChild(creerCarteActif(actif)));
    } catch (erreur) {
      dejaCharge = false;
      liste.innerHTML = `<p class="etat-vide">Impossible de charger le suivi du marché pour l'instant.<br>Lance <code>sync_marche.py</code>.</p>`;
    }
  }

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.marche = { charger };
})();
