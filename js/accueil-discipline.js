// Gold AI — Accueil (Marché) : bloc Discipline + barre d'objectif.
//
// - « Trades restants » : repris du garde-fou du jour (js/garde-fou.js).
// - Compte à rebours vers la prochaine annonce à impact élevé DU JOUR
//   (calendrier déjà chargé, fuseau de l'utilisateur), mis à jour chaque
//   seconde : orange sous 30 min, rouge sous 10 min, passe tout seul à la
//   suivante. Toucher → section Annonces.
// - Barre d'objectif de profit (jour / semaine / mois, tous comptes ou un
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

  const surAccueil = () => $("section-marche")?.classList.contains("actif") && window.GoldAI.auth?.getToken();
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
    const p = N.progressionObjectif(trades, reglages.objectif, aujourdhui);
    let nomCompte = "tous mes comptes";
    if (p.compteId) {
      const c = (await window.GoldAI.comptesTrading.chargerComptes()).find((x) => x.id === p.compteId);
      nomCompte = c ? c.nom : "compte supprimé";
    }
    const m = (v) => U.montant(v, "USD");
    zone.className = `carte bloc-objectif${p.atteint ? " atteint" : ""}`;
    zone.innerHTML = `
      <div class="entete-objectif">
        <span>🎯 Objectif ${LIBELLE_PERIODE[p.periode] || ""} <span class="texte-attenue petit">· ${esc(nomCompte)}</span></span>
        <strong class="${p.realise < 0 ? "negatif" : ""}">${m(p.realise)} / ${m(p.montant)}</strong>
      </div>
      <div class="barre-objectif" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.pourcentage)}">
        <div class="remplissage-objectif" style="width:${p.pourcentage}%"></div>
      </div>
      <div class="pied-objectif">${p.atteint ? "✅ Objectif atteint" : p.realise < 0 ? "En négatif sur la période" : `${Math.round(p.pourcentage)} % — encore ${m(p.montant - p.realise)}`}</div>`;
  }

  // ---------------------------------------------------------------- Réglage (Profil › Général)
  // Enregistré avec les paramètres du calculateur (même stockage par
  // utilisateur, Supabase), sauvegardé dès qu'un champ change.

  async function remplirReglageObjectif() {
    const r = await window.GoldAI.reglagesCalculateur.charger();
    const o = { ...N.OBJECTIF_PAR_DEFAUT, ...(r.objectif || {}) };
    const comptes = await window.GoldAI.comptesTrading.chargerComptes();
    $("objectif-compte").innerHTML = `<option value="">Tous mes comptes combinés</option>`
      + comptes.map((c) => `<option value="${esc(c.id)}">${esc(c.nom)}</option>`).join("");
    $("objectif-montant").value = o.montant;
    $("objectif-periode").value = o.periode;
    $("objectif-compte").value = comptes.some((c) => c.id === o.compteId) ? o.compteId : "";
    await aideCompte();
  }

  // Les nouveaux trades ne sont plus liés à un compte (champ retiré de la
  // fiche) : on le signale si un compte précis est choisi.
  async function aideCompte() {
    const id = $("objectif-compte").value;
    const zone = $("aide-objectif-compte");
    if (!id) { zone.textContent = ""; return; }
    const parJour = await window.GoldAI.journal.chargerTousLesTrades();
    const lies = Object.values(parJour).flat().filter((t) => t.compteTradingId === id).length;
    zone.textContent = `Seuls les trades liés à ce compte sont comptés (${lies} pour l'instant). La fiche de trade ne demande plus le compte : les nouveaux trades ne seront comptés que dans « Tous mes comptes ».`;
  }

  async function enregistrerObjectif() {
    const montant = Number($("objectif-montant").value);
    const message = $("message-objectif");
    if (!(montant > 0)) { message.textContent = "Indique un montant supérieur à 0."; message.classList.add("succes-visible"); return; }
    const r = await window.GoldAI.reglagesCalculateur.charger();
    const res = await window.GoldAI.reglagesCalculateur.sauvegarder({
      ...r, objectif: { montant, periode: $("objectif-periode").value, compteId: $("objectif-compte").value },
    });
    await aideCompte();
    message.textContent = res.local ? res.message : "✓ Objectif enregistré";
    message.classList.add("succes-visible");
    setTimeout(() => message.classList.remove("succes-visible"), 2500);
  }

  // ---------------------------------------------------------------- Rendu

  function afficher() {
    if (!$("bloc-discipline")) return;
    afficherTradesRestants();
    demarrerChrono();
    afficherObjectif();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("tuile-prochaine-annonce")?.addEventListener("click", () => window.GoldAI.app.allerA("calendrier"));
    $("bouton-ouvrir-parametres")?.addEventListener("click", remplirReglageObjectif);
    ["objectif-montant", "objectif-periode", "objectif-compte"].forEach((id) => $(id)?.addEventListener("change", enregistrerObjectif));
  });
  document.addEventListener("visibilitychange", () => { if (actif()) demarrerChrono(); });
  window.addEventListener("goldai:garde-fou", afficherTradesRestants);
  window.addEventListener("goldai:trades", afficherObjectif);
  window.addEventListener("goldai:reglages-calculateur", afficherObjectif);
  window.addEventListener("goldai:comptes", afficherObjectif);
  window.addEventListener("goldai:donnees", () => { prochaine = null; if (surAccueil()) afficherCompteARebours(); });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.discipline = { afficher, arreter: () => clearInterval(tic) };
})();
