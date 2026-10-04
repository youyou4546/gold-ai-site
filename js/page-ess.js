// Gold AI — Journal › ESS (tuile de l'accueil du Journal).
//
// Montre simplement si le compte choisi passe l'ESS (Equity Stability Score) ou non,
// avec le tableau des résultats jour par jour. Même calcul que dans Profil › Mes
// comptes TradeLocker (js/noyau.js › calculerEss) : seuil réglé dans Profil ›
// Général (seuilEss, 20 % par défaut) ; pour un compte Financé, seulement les
// trades depuis sa date « Financé depuis le » si elle est indiquée.
(() => {
  const N = window.GoldAI.noyau;
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  const J = () => window.GoldAI.journal;

  const ouverte = () => $("section-journal")?.classList.contains("actif") && !$("journal-ess")?.classList.contains("hidden");
  const argent = (v, signe = false) => U.montant(v, "USD", { signe });
  const pct = (v) => `${(Math.round(v * 100) / 100).toLocaleString("fr-FR")} %`;
  const r2 = (x) => Math.round(x * 100) / 100;

  function dateLisible(cle) {
    const [a, m, j] = cle.split("-").map(Number);
    return new Date(a, m - 1, j).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }

  function dessiner(trades, reglages) {
    const zone = $("contenu-ess");
    const filtre = J().filtreActuel();
    const st = (reglages.statutsComptes || {})[filtre] || {};
    const depuis = st.statut === "finance" ? st.depuis : null;
    const retenus = trades.filter((t) => !depuis || t.date >= depuis);
    const e = N.calculerEss(retenus, reglages.seuilEss);

    const note = `${depuis ? `Trades depuis le passage en Financé (${esc(dateLisible(depuis))}). ` : ""}Calculé avec les trades du journal : ce n'est pas une donnée officielle de la prop firm.`;
    if (!e.nbJours) {
      zone.innerHTML = `<p class="etat-vide">Aucun trade pour ce compte${depuis ? " depuis le passage en Financé" : ""}.</p>`;
      return;
    }

    // Verdict : passe / ne passe pas.
    const passe = e.calculable && e.eligible;
    const verdict = `
      <div class="verdict-ess ${passe ? "ok" : "ko"}">
        <div class="icone-verdict-ess">${passe ? "✅" : "❌"}</div>
        <div class="texte-verdict-ess">${passe ? "Tu passes l'ESS" : "Tu ne passes pas l'ESS"}</div>
        <div class="chiffre-verdict-ess">${e.calculable ? `${pct(e.ess)} <span>· seuil ${pct(e.seuil)}</span>` : `Bénéfice total pas positif <span>· seuil ${pct(e.seuil)}</span>`}</div>
        <p class="petit">${passe
          ? `Marge : encore ${argent(e.marge)} de bénéfice possible sans battre ta plus grande journée.`
          : `Il manque ${argent(e.manque)} de bénéfice total, sans battre ta plus grande journée gagnante ou perdante.`}</p>
      </div>`;

    // Tableau jour par jour (le plus récent en haut), avec les 2 jours qui comptent.
    const parJour = {};
    retenus.forEach((t) => { parJour[t.date] = (parJour[t.date] || 0) + Number(t.resultat) - (Number(t.frais) || 0); });
    const jours = Object.entries(parJour).map(([date, net]) => ({ date, net: r2(net) })).sort((a, b) => b.date.localeCompare(a.date));
    const lignes = jours.map((j) => {
      const marque = e.maxGain > 0 && j.net === e.maxGain ? " ⬆️" : e.maxPerte > 0 && j.net === -e.maxPerte ? " ⬇️" : "";
      return `<tr><th scope="row">${esc(dateLisible(j.date))}${marque}</th><td class="${j.net > 0 ? "positif" : j.net < 0 ? "negatif" : ""}">${argent(j.net, true)}</td></tr>`;
    }).join("");

    zone.innerHTML = `
      ${verdict}
      <div class="carte">
        <h3 class="titre-bloc">Mes résultats</h3>
        <table class="tableau-portions compact tableau-ess">
          <tbody>
            <tr><th scope="row">Bénéfice net total</th><td class="${e.total >= 0 ? "positif" : "negatif"}"><strong>${argent(e.total, true)}</strong></td></tr>
            <tr><th scope="row">⬆️ Plus grande journée gagnante</th><td class="positif">${argent(e.maxGain, true)}</td></tr>
            <tr><th scope="row">⬇️ Plus grande journée perdante</th><td class="negatif">${argent(-e.maxPerte)}</td></tr>
            <tr><th scope="row">Jours de trading</th><td>${e.nbJours}</td></tr>
            <tr><th scope="row">ESS</th><td><strong>${e.calculable ? pct(e.ess) : "—"}</strong></td></tr>
          </tbody>
        </table>
      </div>
      <div class="carte">
        <h3 class="titre-bloc">Résultat de chaque jour</h3>
        <table class="tableau-portions compact tableau-ess">
          <thead><tr><th scope="col">Jour</th><th scope="col">Résultat</th></tr></thead>
          <tbody>${lignes}</tbody>
        </table>
      </div>
      <p class="texte-attenue petit">ESS = (plus grande journée gagnante + plus grande journée perdante) ÷ bénéfice net total. ${note}</p>`;
  }

  // Switch « ESS dans le calculateur » (réglage essDansCalcul, partagé entre appareils).
  async function afficherSwitch() {
    const c = $("switch-ess-calcul");
    if (!c) return;
    try { c.checked = !!(await window.GoldAI.reglagesCalculateur.charger()).essDansCalcul; } catch { /* réglages indisponibles */ }
  }

  async function changerSwitch(actif) {
    const msg = $("message-switch-ess");
    try {
      const r = await window.GoldAI.reglagesCalculateur.charger({ forcer: true }); // dernière version du serveur
      const res = await window.GoldAI.reglagesCalculateur.sauvegarder({ ...r, essDansCalcul: actif });
      msg.textContent = res.local ? res.message : actif
        ? "✓ Calculateur : TP1 = objectif, TP2 à TP4 = bonus, sans battre ta plus grosse journée gagnante."
        : "✓ Calculateur : lots selon ta répartition, sans limite de bonus.";
    } catch {
      msg.textContent = "Enregistrement impossible pour l'instant : vérifie ta connexion.";
      $("switch-ess-calcul").checked = !actif;
    }
  }

  let enCours = null;
  async function afficher() {
    if (!$("contenu-ess") || !window.GoldAI.auth?.getToken()) return;
    const tache = (async () => {
      J().afficherSelecteurCompte("choix-compte-ess");
      const [, reglages] = await Promise.all([J().chargerTousLesTrades(), window.GoldAI.reglagesCalculateur.charger()]);
      $("switch-ess-calcul").checked = !!reglages?.essDansCalcul;
      dessiner(J().filtrerParCompte(J().obtenirTradesBruts()), reglages || {});
    })();
    enCours = tache;
    try { await tache; } finally { if (enCours === tache) enCours = null; }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("choix-compte-ess")?.addEventListener("change", (e) => J().changerFiltreCompte(e.target.value));
    $("switch-ess-calcul")?.addEventListener("change", (e) => changerSwitch(e.target.checked));
    $("bouton-ouvrir-ess")?.addEventListener("click", () => {
      $("journal-accueil").classList.add("hidden");
      $("journal-ess").classList.remove("hidden");
      $("contenu-ess").innerHTML = `<p class="etat-vide">Chargement…</p>`;
      $("message-switch-ess").textContent = "";
      afficherSwitch();
      J().lireFiltreMemorise(); // au clic seulement (pas à chaque affichage : sinon boucle avec l'événement du filtre)
      afficher();
    });
    $("bouton-retour-ess")?.addEventListener("click", () => {
      $("journal-ess").classList.add("hidden");
      $("journal-accueil").classList.remove("hidden");
    });
  });
  window.addEventListener("goldai:filtre-compte", () => { if (ouverte()) afficher(); });
  window.addEventListener("goldai:trades", () => { if (ouverte()) afficher(); });
  window.addEventListener("goldai:reglages-calculateur", () => { if (ouverte()) afficher(); });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.pageEss = { afficher };
})();
