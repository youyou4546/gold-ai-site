// Gold AI — Profil › Mes comptes : comptes MT5 (ex. FundedNext) en LECTURE SEULE.
//
// Les chiffres sont lus par le PC (site/sync_mt5.py, mot de passe investisseur)
// toutes les 15 min et publiés dans Supabase (table comptes_mt5, seulement
// pour la personne connectée). Ici : solde, résultat du jour, marge avant
// rupture, perte max du jour restante, progression vers l'objectif.
(() => {
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  const argent = (v, d = "USD", signe = false) => U.montant(v, d, { signe });
  const r2 = (x) => Math.round(x * 100) / 100;

  let comptes = null;
  let erreur = null;

  async function charger() {
    const { data, error } = await window.GoldAI.auth.client.rpc("lire_mes_comptes_mt5", { p_token: window.GoldAI.auth.getToken() });
    erreur = error ? "Comptes MT5 illisibles pour l'instant." : null;
    if (!error) comptes = data || [];
    afficher();
  }

  // Calculs à partir des chiffres publiés par le PC.
  function etat(c) {
    const plancher = c.depart - c.perteMax;                       // niveau de rupture (perte max totale)
    const marge = r2(c.equite - plancher);
    const perteJourFaite = Math.max(0, r2(c.soldeDebutJour - c.equite));
    const resteJour = r2(c.perteJour - perteJourFaite);
    const cible = r2(c.depart * (1 + c.objectifPct / 100));
    const resteObjectif = r2(cible - c.solde);
    const progression = c.objectifPct > 0 ? Math.max(0, Math.min(100, ((c.solde - c.depart) / (cible - c.depart)) * 100)) : null;
    return { plancher, marge, resteJour, cible, resteObjectif, progression, ratioMarge: c.perteMax > 0 ? marge / c.perteMax : 1 };
  }

  function carte(ligne) {
    const c = ligne.contenu || {};
    const d = c.devise || "USD";
    const e = etat(c);
    const vieux = Date.now() - Date.parse(ligne.maj_le) > 40 * 60000; // > 40 min : PC éteint ?
    const couleur = e.ratioMarge <= 0.25 ? "negatif" : e.ratioMarge <= 0.5 ? "attention" : "positif";
    return `
      <div class="carte carte-mt5">
        <div class="entete-mt5">
          <strong>${esc(c.nom || ligne.cle)}</strong>
          <span class="texte-attenue petit">MT5 · ${esc(c.serveur || "")} · ${c.lectureSeule ? "lecture seule 🔒" : "lecture"}</span>
        </div>
        <div class="grille-mt5">
          <div><span class="lib">Solde</span><span class="val">${argent(c.solde, d)}</span></div>
          <div><span class="lib">Équité</span><span class="val">${argent(c.equite, d)}</span></div>
          <div><span class="lib">Aujourd'hui</span><span class="val ${c.jourNet >= 0 ? "positif" : "negatif"}">${argent(c.jourNet, d, true)}</span>
            <span class="sous">${c.tradesJour || 0} trade${c.tradesJour > 1 ? "s" : ""} fermé${c.tradesJour > 1 ? "s" : ""}${c.positionsOuvertes ? ` · ${c.positionsOuvertes} ouvert${c.positionsOuvertes > 1 ? "s" : ""}` : ""}</span></div>
          <div><span class="lib">Avant rupture</span><span class="val ${couleur}">${argent(e.marge, d)}</span>
            <span class="sous">rupture à ${argent(e.plancher, d)}</span></div>
          <div><span class="lib">Perte max du jour restante</span><span class="val">${argent(e.resteJour, d)}</span>
            <span class="sous">sur ${argent(c.perteJour, d)}</span></div>
          <div><span class="lib">Objectif ${U.nombre(c.objectifPct, 0)} %</span><span class="val">${e.resteObjectif > 0 ? `reste ${argent(e.resteObjectif, d)}` : "atteint ✅"}</span>
            <span class="sous">cible ${argent(e.cible, d)}</span></div>
        </div>
        ${e.progression !== null ? `<div class="barre-mt5"><span style="width:${e.progression.toFixed(1)}%"></span></div>` : ""}
        <p class="texte-attenue petit">${vieux ? "⚠️ " : ""}Lu par ton PC à ${esc(U.heure(ligne.maj_le))}${vieux ? " — le PC est peut-être éteint" : " · toutes les 15 min"}.</p>
      </div>`;
  }

  function afficher() {
    const zone = $("contenu-mt5");
    if (!zone) return;
    if (erreur && !comptes) { zone.innerHTML = `<p class="alerte-donnees">${esc(erreur)}</p>`; return; }
    if (!comptes?.length) { zone.innerHTML = ""; return; }
    zone.innerHTML = `<h3 class="titre-bloc">Comptes MT5</h3>${comptes.map(carte).join("")}`;
  }

  const ouverte = () => !$("profil-tradelocker")?.classList.contains("hidden");
  let minuterie = null;
  document.addEventListener("DOMContentLoaded", () => {
    $("bouton-ouvrir-tradelocker")?.addEventListener("click", () => {
      charger();
      clearInterval(minuterie);
      minuterie = setInterval(() => { if (ouverte() && !document.hidden) charger(); else if (!ouverte()) clearInterval(minuterie); }, 60000);
    });
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.comptesMt5 = { charger, viderCache: () => { comptes = null; erreur = null; clearInterval(minuterie); const z = $("contenu-mt5"); if (z) z.innerHTML = ""; } };
})();
