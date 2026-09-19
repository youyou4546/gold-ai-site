// Gold AI — Section 2 : calendrier économique du jour.
// Lit site/data/calendrier_du_jour.json (copié depuis les données déjà
// collectées par scripts/collecte_quotidienne.py — voir site/sync_calendrier.py)
// et site/data/glossaire_annonces.json (explications fixes, pas d'API).
(() => {
  let glossaireCharge = null;
  let dejaCharge = false;

  function trouverExplication(titreEvenement, glossaire) {
    const titre = titreEvenement.toLowerCase();
    return glossaire.annonces.find((annonce) =>
      annonce.mots_cles.some((motCle) => titre.includes(motCle))
    );
  }

  function creerCarteEvenement(evenement, glossaire) {
    const div = document.createElement("div");
    div.className = "evenement";

    const impact = (evenement.impact || "low").toLowerCase();

    div.innerHTML = `
      <div class="heure">${evenement.heure || "?"}</div>
      <div class="contenu-evenement">
        <div class="titre-evenement">${evenement.titre}</div>
        <div class="meta-evenement">${evenement.devise || ""} · prévision ${evenement.prevision || "—"} · précédent ${evenement.precedent || "—"}</div>
      </div>
      <span class="badge-impact ${impact}">${impact}</span>
    `;

    div.addEventListener("click", () => ouvrirModaleAnnonce(evenement, glossaire));
    return div;
  }

  function ouvrirModaleAnnonce(evenement, glossaire) {
    const explication = trouverExplication(evenement.titre, glossaire);

    document.getElementById("modale-titre-annonce").textContent = evenement.titre;
    document.getElementById("modale-meta-annonce").textContent =
      `${evenement.devise || ""} · ${evenement.heure || "?"} · prévision ${evenement.prevision || "—"} · précédent ${evenement.precedent || "—"}`;

    const blocImpact = document.getElementById("bloc-impact-or");
    const zoneImpact = document.getElementById("modale-impact-or");
    const zoneAvertissement = document.getElementById("modale-avertissement");

    if (!explication) {
      document.getElementById("modale-mesure").textContent =
        "Pas de fiche explicative pour cette annonce précise pour l'instant.";
      blocImpact.style.display = "none";
      zoneAvertissement.style.display = "none";
    } else {
      document.getElementById("modale-mesure").textContent = explication.mesure;
      blocImpact.style.display = "block";

      if (!explication.or_affecte) {
        zoneImpact.innerHTML = `<span style="color:var(--texte-attenue);">Pas d'impact direct connu sur l'or pour ce type d'annonce.</span>`;
        zoneAvertissement.style.display = "none";
      } else {
        zoneImpact.innerHTML = `
          <div style="margin-bottom:12px;">
            <div style="font-size:12px; color:var(--texte-attenue); margin-bottom:4px;">Si le résultat est plus fort que prévu :</div>
            <span class="pastille-direction ${explication.si_superieur.direction}">
              ${explication.si_superieur.direction === "hausse" ? "▲ Hausse probable de l'or" : "▼ Baisse probable de l'or"}
            </span>
            <div style="font-size:12px; margin-top:6px; line-height:1.5;">${explication.si_superieur.raisonnement}</div>
          </div>
          <div>
            <div style="font-size:12px; color:var(--texte-attenue); margin-bottom:4px;">Si le résultat est plus faible que prévu :</div>
            <span class="pastille-direction ${explication.si_inferieur.direction}">
              ${explication.si_inferieur.direction === "hausse" ? "▲ Hausse probable de l'or" : "▼ Baisse probable de l'or"}
            </span>
            <div style="font-size:12px; margin-top:6px; line-height:1.5;">${explication.si_inferieur.raisonnement}</div>
          </div>
        `;
        zoneAvertissement.textContent = `⚠️ ${glossaire.avertissement}`;
        zoneAvertissement.style.display = "block";
      }
    }

    document.getElementById("modale-annonce").classList.add("visible");
  }

  function fermerModaleAnnonce() {
    document.getElementById("modale-annonce").classList.remove("visible");
  }

  async function charger() {
    if (dejaCharge) return; // évite de re-télécharger à chaque clic sur l'onglet
    dejaCharge = true;

    const listeEvenements = document.getElementById("liste-evenements");
    const dateAffichee = document.getElementById("date-calendrier");
    listeEvenements.innerHTML = `<p class="etat-vide">Chargement…</p>`;

    try {
      const [reponseCalendrier, reponseGlossaire] = await Promise.all([
        fetch("data/calendrier_du_jour.json", { cache: "no-store" }),
        fetch("data/glossaire_annonces.json"),
      ]);

      const calendrier = await reponseCalendrier.json();
      glossaireCharge = await reponseGlossaire.json();

      dateAffichee.textContent = calendrier.genere_le
        ? `Données du ${calendrier.date} · mises à jour ${new Date(calendrier.genere_le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
        : "";

      const evenements = calendrier.evenements || [];
      listeEvenements.innerHTML = "";

      if (evenements.length === 0) {
        listeEvenements.innerHTML = `<p class="etat-vide">Aucune annonce économique notable aujourd'hui.</p>`;
        return;
      }

      evenements.forEach((evenement) => {
        listeEvenements.appendChild(creerCarteEvenement(evenement, glossaireCharge));
      });
    } catch (erreur) {
      dejaCharge = false; // laisse une chance de réessayer au prochain clic sur l'onglet
      listeEvenements.innerHTML = `<p class="etat-vide">Impossible de charger le calendrier pour l'instant.<br>Lance <code>sync_calendrier.py</code> après ta collecte quotidienne.</p>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("bouton-fermer-modale").addEventListener("click", fermerModaleAnnonce);
    document.getElementById("modale-annonce").addEventListener("click", (evenement) => {
      if (evenement.target.id === "modale-annonce") fermerModaleAnnonce();
    });
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.calendrier = { charger };
})();
