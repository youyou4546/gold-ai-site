// Gold AI — Journal › Analyse de mes trades (tuile de l'accueil du Journal ;
// gratuit, calculé dans l'app).
//
// À partir du journal (compte choisi dans le menu « Compte », partagé avec le
// Calendrier et la Performance ; par défaut le compte maître) :
//  - résumé : % de trades gagnants, gain moyen / perte moyenne, total ;
//  - par jour de la semaine et par heure d'ouverture (fuseau de l'app) ;
//  - achats / ventes ;
//  - TP atteints (trades importés de TradeLocker : position k gagnante = TPk
//    atteint), via la fonction Supabase lister_positions_importees
//    (supabase/patch_analyse_trades.sql) ;
//  - conseils en français (js/noyau.js › analyserTrades).
// Les trades saisis à la main n'ont pas d'heure : ils ne comptent pas dans
// l'analyse par heure ni dans les TP atteints.
(() => {
  const N = window.GoldAI.noyau;
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  const J = () => window.GoldAI.journal;

  let positions = null; // { idTrade: [résultats par position] }, chargé une fois par session

  const ouverte = () => $("section-journal")?.classList.contains("actif") && !$("journal-analyse")?.classList.contains("hidden");
  const argent = (v, signe = false) => U.montant(v, "USD", { signe });
  const pct = (x) => `${Math.round(x)} %`;

  async function chargerPositions(forcer = false) {
    if (positions && !forcer) return positions;
    const { data, error } = await window.GoldAI.auth.client.rpc("lister_positions_importees", { p_token: window.GoldAI.auth.getToken() });
    positions = {};
    if (!error) (data || []).forEach((p) => { (positions[p.trade_id] = positions[p.trade_id] || []).push(Number(p.resultat)); });
    return positions;
  }

  // Jour et heure d'ouverture dans le fuseau choisi dans l'app.
  function moment(t) {
    if (!t.ouvertLe) return null;
    const morceaux = new Intl.DateTimeFormat("en-US", { timeZone: U.fuseau(), weekday: "short", hour: "2-digit", hour12: false })
      .formatToParts(new Date(t.ouvertLe));
    const jour = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(morceaux.find((m) => m.type === "weekday")?.value);
    const heure = Number(morceaux.find((m) => m.type === "hour")?.value) % 24;
    return jour < 0 || !Number.isFinite(heure) ? null : { jour, heure };
  }

  function tradesRetenus() {
    const periode = $("periode-analyse")?.value || "tout";
    let trades = J().filtrerParCompte(J().obtenirTradesBruts());
    if (periode !== "tout") {
      const debut = U.cleJour(Date.now() - Number(periode) * 86400000);
      trades = trades.filter((t) => t.date >= debut);
    }
    return trades;
  }

  // Une ligne « barre » : libellé, nombre de trades, % gagnants, total (barre verte / rouge).
  function lignes(groupes, libelle, maxAbs) {
    return groupes.map((g) => `
      <div class="ligne-analyse">
        <span class="lib-analyse">${esc(libelle(g))}</span>
        <span class="barre-analyse">${g.nb ? `<span class="${g.net >= 0 ? "gain" : "perte"}" style="width:${maxAbs ? Math.max(3, (Math.abs(g.net) / maxAbs) * 100) : 0}%"></span>` : ""}</span>
        <span class="val-analyse">${g.nb ? `<strong class="${g.net >= 0 ? "positif" : "negatif"}">${argent(g.net, true)}</strong><br><span class="texte-attenue petit">${g.nb} trade${g.nb > 1 ? "s" : ""} · ${pct(g.taux)} gagnants</span>` : `<span class="texte-attenue petit">aucun trade</span>`}</span>
      </div>`).join("");
  }

  function tuile(label, valeur, sous = "", classe = "") {
    return `<div class="carte-stat"><div class="label-stat">${label}</div><div class="valeur-stat ${classe}">${valeur}</div>${sous ? `<div class="sous-valeur-stat">${sous}</div>` : ""}</div>`;
  }

  function dessiner(r) {
    const zone = $("contenu-analyse-trades");
    if (!r.nb) {
      zone.innerHTML = `<p class="etat-vide">Aucun trade dans le journal pour ce compte et cette période.</p>`;
      return;
    }
    const maxJour = Math.max(0, ...r.parJour.map((g) => Math.abs(g.net)));
    const maxHeure = Math.max(0, ...r.parHeure.map((g) => Math.abs(g.net)));
    const sens = [["Achats", r.parSens.buy], ["Ventes", r.parSens.sell]].filter(([, g]) => g.nb);
    const icone = { attention: "⚠️", ok: "✅", info: "💡" };
    zone.innerHTML = `
      <div class="grille-stats-perf">
        ${tuile("Trades gagnants", pct(r.taux), `${r.gagnants} sur ${r.nb}`)}
        ${tuile("Total", argent(r.total, true), "", r.total >= 0 ? "positif" : "negatif")}
        ${tuile("Gain moyen", argent(r.gainMoyen), r.meilleur !== null ? `meilleur ${argent(r.meilleur, true)}` : "", "positif")}
        ${tuile("Perte moyenne", argent(r.perteMoyenne), r.pire !== null ? `pire ${argent(r.pire, true)}` : "", "negatif")}
      </div>
      ${r.ratioGainPerte !== null ? `<p class="texte-attenue petit">Gain moyen ÷ perte moyenne : <strong>${U.nombre(r.ratioGainPerte, 2)}</strong>${r.profitFactor !== null ? ` · total des gains ÷ total des pertes : <strong>${U.nombre(r.profitFactor, 2)}</strong> (au-dessus de 1 = rentable)` : ""}</p>` : ""}

      <h4 class="sous-titre-analyse">Conseils</h4>
      ${r.conseils.length ? `<ul class="conseils-analyse">${r.conseils.map((c) => `<li class="${c.niveau}">${icone[c.niveau] || "•"} ${esc(c.texte)}</li>`).join("")}</ul>`
        : `<p class="texte-attenue petit">Rien de marquant pour l'instant : pas de créneau, de jour ou de sens nettement meilleur ou pire (au moins 4 trades par groupe).</p>`}

      <h4 class="sous-titre-analyse">Par jour de la semaine</h4>
      ${lignes(r.parJour, (g) => g.nom.charAt(0).toUpperCase() + g.nom.slice(1), maxJour)}

      <h4 class="sous-titre-analyse">Par heure d'ouverture <span class="texte-attenue petit">(${esc(U.fuseau())})</span></h4>
      ${r.parHeure.length ? lignes(r.parHeure, (g) => `${g.heure}h – ${g.heure + 1}h`, maxHeure) : `<p class="texte-attenue petit">Aucune heure connue (seuls les trades importés de TradeLocker ont une heure d'ouverture).</p>`}
      ${r.sansHeure ? `<p class="texte-attenue petit">${r.sansHeure} trade${r.sansHeure > 1 ? "s" : ""} saisi${r.sansHeure > 1 ? "s" : ""} à la main, sans heure : pas compté${r.sansHeure > 1 ? "s" : ""} ici.</p>` : ""}

      <h4 class="sous-titre-analyse">Achats / ventes</h4>
      ${sens.length ? `<div class="grille-stats-perf">${sens.map(([nom, g]) => tuile(nom, argent(g.net, true), `${g.nb} trade${g.nb > 1 ? "s" : ""} · ${pct(g.taux)} gagnants`, g.net >= 0 ? "positif" : "negatif")).join("")}</div>`
        : `<p class="texte-attenue petit">Sens inconnu (trades saisis à la main).</p>`}

      <h4 class="sous-titre-analyse">TP atteints</h4>
      ${r.tps.length ? r.tps.map((tp) => `
        <div class="ligne-analyse">
          <span class="lib-analyse">TP${tp.numero}</span>
          <span class="barre-analyse"><span class="gain" style="width:${tp.pct}%"></span></span>
          <span class="val-analyse"><strong>${pct(tp.pct)}</strong><br><span class="texte-attenue petit">${tp.atteints} sur ${tp.total}</span></span>
        </div>`).join("") + `<p class="texte-attenue petit">Trades importés de TradeLocker seulement : chaque position (TP1, TP2, TP3…) fermée en gain compte comme TP atteint.</p>`
        : `<p class="texte-attenue petit">Pas encore de trade importé de TradeLocker sur cette période.</p>`}`;
  }

  let enCours = null;
  let filtreLu = false;
  async function afficher() {
    if (!$("contenu-analyse-trades") || !window.GoldAI.auth?.getToken()) return;
    const tache = (async () => {
      if (!filtreLu) { filtreLu = true; J().lireFiltreMemorise(); } // une seule fois : l'événement du filtre relance afficher()
      J().afficherSelecteurCompte("choix-compte-analyse");
      await Promise.all([J().chargerTousLesTrades(), chargerPositions()]);
      dessiner(N.analyserTrades(tradesRetenus(), { positions, moment }));
    })();
    enCours = tache;
    try { await tache; } finally { if (enCours === tache) enCours = null; }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("choix-compte-analyse")?.addEventListener("change", (e) => J().changerFiltreCompte(e.target.value));
    $("periode-analyse")?.addEventListener("change", afficher);
    $("bouton-ouvrir-analyse-trades")?.addEventListener("click", () => {
      $("journal-accueil").classList.add("hidden");
      $("journal-analyse").classList.remove("hidden");
      $("contenu-analyse-trades").innerHTML = `<p class="etat-vide">Chargement…</p>`;
      afficher();
    });
    $("bouton-retour-analyse-trades")?.addEventListener("click", () => {
      $("journal-analyse").classList.add("hidden");
      $("journal-accueil").classList.remove("hidden");
    });
  });
  window.addEventListener("goldai:filtre-compte", () => { if (ouverte()) afficher(); });
  // Nouveau trade (ajouté, importé, supprimé) : positions relues puis analyse refaite.
  window.addEventListener("goldai:trades", async () => { positions = null; if (ouverte()) afficher(); });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.analyseTrades = { afficher, viderCache: () => { positions = null; filtreLu = false; } };
})();
