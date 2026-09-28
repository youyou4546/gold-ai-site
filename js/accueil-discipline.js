// Gold AI — Calculateur : bloc Discipline (après un calcul) + barre d'objectif.
//
// - « Trades restants » : repris du garde-fou du jour (js/garde-fou.js).
// - Compte à rebours vers la prochaine annonce à impact élevé DU JOUR
//   (calendrier déjà chargé, fuseau de l'utilisateur), mis à jour chaque
//   seconde : orange sous 30 min, rouge sous 10 min, passe tout seul à la
//   suivante. Toucher → section Annonces.
// - Barre d'objectif de profit (en haut de TOUTES les pages, sous le garde-fou) (jour / semaine / mois, tous comptes ou un
//   compte) réglée dans Profil › Général, calculée avec les trades du journal
//   (noyau.progressionObjectif).
(() => {
  const N = window.GoldAI.noyau;
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  const LIBELLE_PERIODE = { jour: "aujourd'hui", semaine: "cette semaine", mois: "ce mois-ci" };

  let prochaine = null;   // { e, ms } ou null
  let tic = null;

  // Le bloc n'apparaît que dans le Calculateur, une fois un trade calculé.
  const surAccueil = () => $("section-calculateur")?.classList.contains("actif") && !$("bloc-discipline")?.classList.contains("hidden") && window.GoldAI.auth?.getToken();
  const actif = () => surAccueil() && !document.hidden; // pas de tic-tac écran éteint / app en arrière-plan

  // ---------------------------------------------------------------- Trades restants

  function afficherTradesRestants() {
    const zone = $("tuile-trades-restants");
    if (!zone) return;
    const g = window.GoldAI.gardeFou?.etat();
    let valeur = "—", sous = "aucune limite définie", classe = "";
    if (g?.maxTrades) {
      const reste = Math.max(0, g.maxTrades - g.nb);
      valeur = `${reste} / ${g.maxTrades}`;
      sous = reste === 0 ? "plus de trade aujourd'hui" : `${g.nb} déjà pris aujourd'hui`;
      classe = g.niveau === "bloque" || reste === 0 ? "rouge" : reste === 1 || g.niveau === "attention" ? "orange" : "";
    } else if (g) {
      sous = `${g.nb} pris aujourd'hui · sans limite`;
    }
    if (g?.niveau === "bloque") sous = "journée terminée";
    zone.className = `tuile-discipline ${classe}`;
    zone.innerHTML = `<span class="libelle-tuile">Trades restants</span><span class="valeur-tuile">${valeur}</span><span class="sous-tuile">${esc(sous)}</span>`;
  }

  // ---------------------------------------------------------------- Compte à rebours

  function chercherProchaine() {
    const evs = window.GoldAI.calendrier?.evenementsCalendrier?.() || [];
    prochaine = N.prochaineAnnonceDuJour(evs, Date.now(), (ms) => U.cleJour(ms));
  }

  function hms(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, "0")).join(":");
  }

  function afficherCompteARebours() {
    const zone = $("tuile-prochaine-annonce");
    if (!zone) return;
    // Annonce passée → on passe automatiquement à la suivante.
    if (!prochaine || prochaine.ms <= Date.now()) chercherProchaine();
    if (!prochaine) {
      zone.className = "tuile-discipline tuile-annonce";
      zone.innerHTML = `<span class="libelle-tuile">Prochaine annonce</span><span class="sous-tuile vide-annonce">Plus d'annonce importante aujourd'hui</span>`;
      return;
    }
    const reste = prochaine.ms - Date.now();
    const classe = reste < 10 * 60000 ? "rouge" : reste < 30 * 60000 ? "orange" : "";
    const e = prochaine.e;
    const cle = `${e.id}|${classe}`;
    if (zone.dataset.cle !== cle) {
      zone.dataset.cle = cle;
      zone.className = `tuile-discipline tuile-annonce ${classe}`;
      zone.innerHTML = `<span class="libelle-tuile">Prochaine annonce <span class="badge-impact-mini">Élevé · ${esc(e.devise)}</span></span>
        <span class="valeur-tuile chrono" id="chrono-annonce">${hms(reste)}</span>
        <span class="sous-tuile nom-annonce-tuile">${esc(e.titre)} · ${U.heure(prochaine.ms)}</span>`;
    } else {
      $("chrono-annonce").textContent = hms(reste);
    }
  }

  function demarrerChrono() {
    clearInterval(tic);
    if (!surAccueil()) return;
    afficherCompteARebours();
    tic = setInterval(() => { if (actif()) afficherCompteARebours(); else clearInterval(tic); }, 1000);
  }

  // ---------------------------------------------------------------- Objectif

  async function afficherObjectif() {
    const zone = $("bloc-objectif");
    if (!zone || !window.GoldAI.auth?.getToken()) return;
    const reglages = await window.GoldAI.reglagesCalculateur.charger();
    const parJour = await window.GoldAI.journal.chargerTousLesTrades();
    const trades = Object.values(parJour).flat();
    const aujourdhui = window.GoldAI.gardeFou?.cleAujourdhui?.() || U.cleJour(Date.now());
    // Toujours tous les trades (un ancien choix de compte est ignoré).
    const p = N.progressionObjectif(trades, { ...(reglages.objectif || {}), compteId: "" }, aujourdhui);
    const nomCompte = "";
    const m = (v) => U.montant(v, "USD");
    zone.className = `bloc-objectif${p.atteint ? " atteint" : ""}`;
    zone.hidden = false;
    zone.innerHTML = `
      <div class="entete-objectif">
        <span>🎯 Objectif ${LIBELLE_PERIODE[p.periode] || ""}${nomCompte ? ` <span class="texte-attenue petit">· ${esc(nomCompte)}</span>` : ""}${p.atteint ? ` <span class="objectif-atteint">✅ atteint</span>` : ""}</span>
        <strong class="${p.realise < 0 ? "negatif" : ""}">${m(p.realise)} / ${m(p.montant)}</strong>
      </div>
      <div class="barre-objectif" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.pourcentage)}">
        <div class="remplissage-objectif" style="width:${p.pourcentage}%"></div>
      </div>`;
  }

  // ---------------------------------------------------------------- Réglage (Profil › Général)
  // Enregistré avec les paramètres du calculateur (même stockage par
  // utilisateur, Supabase), sauvegardé dès qu'un champ change.

  async function remplirReglageObjectif() {
    const r = await window.GoldAI.reglagesCalculateur.charger();
    const o = { ...N.OBJECTIF_PAR_DEFAUT, ...(r.objectif || {}) };
    $("objectif-montant").value = o.montant;
    $("objectif-periode").value = o.periode;
  }

  async function enregistrerObjectif() {
    const montant = Number($("objectif-montant").value);
    const message = $("message-objectif");
    if (!(montant > 0)) { message.textContent = "Indique un montant supérieur à 0."; message.classList.add("succes-visible"); return; }
    const r = await window.GoldAI.reglagesCalculateur.charger();
    const res = await window.GoldAI.reglagesCalculateur.sauvegarder({
      ...r, objectif: { montant, periode: $("objectif-periode").value, compteId: "" }, // toujours tous les trades
    });
    message.textContent = res.local ? res.message : "✓ Objectif enregistré";
    message.classList.add("succes-visible");
    setTimeout(() => message.classList.remove("succes-visible"), 2500);
  }

  // ---------------------------------------------------------------- Rendu

  function afficher() {
    if (!$("bloc-discipline")) return;
    $("bloc-discipline").classList.remove("hidden");
    afficherTradesRestants();
    demarrerChrono();
    afficherObjectif();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("tuile-prochaine-annonce")?.addEventListener("click", () => window.GoldAI.app.allerA("calendrier"));
    $("bouton-ouvrir-parametres")?.addEventListener("click", remplirReglageObjectif);
    ["objectif-montant", "objectif-periode"].forEach((id) => $(id)?.addEventListener("change", enregistrerObjectif));
  });
  document.addEventListener("visibilitychange", () => { if (actif()) demarrerChrono(); });
  // Le garde-fou se calcule à la connexion puis à chaque trade : l'objectif
  // (en haut de toutes les pages) suit le même rythme.
  window.addEventListener("goldai:garde-fou", () => { afficherTradesRestants(); afficherObjectif(); });
  window.addEventListener("goldai:trades", afficherObjectif);
  window.addEventListener("goldai:reglages-calculateur", afficherObjectif);
  window.addEventListener("goldai:comptes", afficherObjectif);
  window.addEventListener("goldai:donnees", () => { prochaine = null; if (surAccueil()) afficherCompteARebours(); });

  window.GoldAI = window.GoldAI || {};
  function masquer() {
    clearInterval(tic);
    $("bloc-discipline")?.classList.add("hidden");
  }

  window.GoldAI.discipline = { afficher, masquer, arreter: () => clearInterval(tic) };
})();
