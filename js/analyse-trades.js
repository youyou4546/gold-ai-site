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
  let periode = "tout"; // puces 30 jours / 90 jours / Tout
  const ouvertes = new Set(["conseils"]); // cartes ouvertes (gardées quand la page est redessinée)

  const ouverte = () => $("section-journal")?.classList.contains("actif") && !$("journal-analyse")?.classList.contains("hidden");
  const argent = (v, signe = false) => U.montant(v, "USD", { signe });
  const pct = (x) => `${Math.round(x)} %`;

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
    let trades = J().filtrerParCompte(J().obtenirTradesBruts());
    if (periode !== "tout") {
      const debut = U.cleJour(Date.now() - Number(periode) * 86400000);
      trades = trades.filter((t) => t.date >= debut);
    }
    return trades;
  }

  // ------------------------------------------------ Rendu
  // Couleur d'une case selon son résultat : vert (gain) / rouge (perte), plus
  // intense quand le montant est grand ; gris neutre sans trade.
  function teinte(net, nb, maxAbs) {
    if (!nb) return "";
    const force = maxAbs ? Math.round(14 + (Math.abs(net) / maxAbs) * 40) : 14;
    return `style="background:color-mix(in srgb, var(${net >= 0 ? "--vert" : "--rouge"}) ${force}%, var(--fond-carte))"`;
  }

  // Montant court pour les petites cases : « +178 $ », « −1,6 k$ ».
  const compact = (x) => (Math.abs(x) >= 1000
    ? `${x < 0 ? "−" : "+"}${(Math.abs(x) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k$`
    : court(x));
  const court = (x) => `${x < 0 ? "−" : x > 0 ? "+" : ""}${Math.abs(Math.round(x)).toLocaleString("fr-FR")} $`;

  // Grille de cases (jours ou heures) : libellé, résultat, % gagnants.
  function grille(groupes, libelle, uneLigne = false) {
    const maxAbs = Math.max(0, ...groupes.map((g) => Math.abs(g.net)));
    const style = uneLigne ? ` style="grid-template-columns:repeat(${groupes.length}, minmax(0, 1fr))"` : "";
    return `<div class="grille-cases-analyse"${style}>${groupes.map((g) => `
      <div class="case-analyse ${g.nb ? "" : "vide"}" ${teinte(g.net, g.nb, maxAbs)}
        title="${esc(libelle(g))} : ${g.nb} trade${g.nb > 1 ? "s" : ""}, ${pct(g.taux)} gagnants, ${esc(argent(g.net, true))}">
        <span class="lib-case">${esc(libelle(g))}</span>
        <strong class="val-case">${g.nb ? compact(g.net) : "—"}</strong>
        <span class="sous-case">${g.nb ? `${pct(g.taux)}${uneLigne ? "" : " gagn."}` : "aucun"}</span>
      </div>`).join("")}</div>`;
  }

  // Libellé de la période choisie (badge de la carte Résumé).
  const nomPeriode = () => ({ 30: "30 jours", 90: "90 jours" })[periode] || "Depuis le début";

  // Courbe du résumé : résultat cumulé jour après jour.
  function valeursCumul(trades) {
    const parJour = {};
    trades.forEach((t) => { parJour[t.date] = (parJour[t.date] || 0) + Number(t.resultat) - (Number(t.frais) || 0); });
    let cumul = 0;
    return [0, ...Object.keys(parJour).sort().map((j) => (cumul += parJour[j]))];
  }

  // Meilleur groupe (jour, heure…) pour le résumé d'une carte : « Mar +320 $ ».
  function meilleur(groupes, libelle) {
    const avec = groupes.filter((g) => g.nb);
    if (!avec.length) return "";
    const g = avec.reduce((x, y) => (y.net > x.net ? y : x));
    return `<span class="${g.net >= 0 ? "positif" : "negatif"}">${esc(libelle(g))} ${court(g.net)}</span>`;
  }

  function dessiner(r, trades) {
    const zone = $("contenu-analyse-trades");
    if (!r.nb) {
      zone.innerHTML = `<p class="etat-vide">Aucun trade dans le journal pour ce compte et cette période.</p>`;
      return;
    }
    const icone = { attention: "!", ok: "✓", info: "i" };
    const ordre = { attention: 0, ok: 1, info: 2 }; // les alertes d'abord
    const conseils = [...r.conseils].sort((a, b) => (ordre[a.niveau] ?? 3) - (ordre[b.niveau] ?? 3));
    const alertes = conseils.filter((c) => c.niveau === "attention").length;
    const gm = r.gainMoyen, pm = r.perteMoyenne, somme = gm + pm;
    const sens = [["Achats", r.parSens.buy], ["Ventes", r.parSens.sell]];
    const jours = r.parJour.map((g) => ({ ...g, court: g.nom.slice(0, 3) }));
    const nomJour = (g) => g.court.charAt(0).toUpperCase() + g.court.slice(1);
    const carte = (o) => U.carteSection({ ...o, ouvertes });

    zone.innerHTML = `
      <div class="carte-section carte-resume">
        <div class="titre-carte-compte"><strong>Résumé</strong><span class="badge-periode">${esc(nomPeriode())}</span></div>
        ${U.courbe(valeursCumul(trades))}
        <div class="chiffres-carte-compte">
          <div><span class="lib">Résultat</span><span class="val ${r.total >= 0 ? "positif" : "negatif"}">${court(r.total)}</span></div>
          <div class="droite"><span class="lib">Réussite</span><span class="val">${pct(r.taux)}</span></div>
        </div>
        ${gm || pm ? `<div class="moyennes-analyse">
          <div class="entete-moyennes"><span>Gain moyen <strong class="positif">${court(gm)}</strong></span><span>Perte moyenne <strong class="negatif">${court(-pm)}</strong></span></div>
          <div class="barre-moyennes" role="img" aria-label="Gain moyen ${court(gm)}, perte moyenne ${court(-pm)}">
            <span class="gain" style="flex:${somme ? gm / somme : 0.5}"></span><span class="perte" style="flex:${somme ? pm / somme : 0.5}"></span>
          </div>
        </div>` : ""}
        <div class="pied-carte-compte">
          <span class="texte-attenue">${r.nb} trade${r.nb > 1 ? "s" : ""}</span>
          <span class="texte-attenue">${r.gagnants} gagnant${r.gagnants > 1 ? "s" : ""}</span>
        </div>
      </div>

      ${carte({ cle: "conseils", titre: "À retenir",
        resume: alertes ? `<span class="pastille-alerte">${alertes} alerte${alertes > 1 ? "s" : ""}</span>` : "",
        contenu: conseils.length ? `<ul class="conseils-analyse">${conseils.map((c) => `<li class="${c.niveau}"><span class="icone-conseil" aria-hidden="true">${icone[c.niveau] || "•"}</span><span>${esc(c.texte)}</span></li>`).join("")}</ul>`
          : `<p class="texte-attenue petit">Rien de marquant pour l'instant.</p>` })}

      ${carte({ cle: "jours", titre: "Jours de la semaine", resume: meilleur(jours, nomJour),
        contenu: grille(jours, nomJour, true) })}

      ${carte({ cle: "heures", titre: "Heures d'ouverture", resume: meilleur(r.parHeure, (g) => `${g.heure}h`),
        contenu: r.parHeure.length ? grille(r.parHeure, (g) => `${g.heure}h`) : `<p class="texte-attenue petit">Seuls les trades importés de TradeLocker ont une heure.</p>` })}

      ${carte({ cle: "sens", titre: "Achats / ventes", resume: meilleur(sens.map(([nom, g]) => ({ ...g, nom })), (g) => g.nom),
        contenu: `<div class="sens-analyse">${sens.map(([nom, g]) => `
          <div class="bloc-sens ${g.nb ? "" : "vide"}">
            <span class="lib-kpi">${nom}</span>
            <strong class="${g.net >= 0 ? "positif" : "negatif"}">${g.nb ? court(g.net) : "—"}</strong>
            <div class="barre-sens" role="img" aria-label="${pct(g.taux)} gagnants"><span style="width:${g.taux}%"></span></div>
            <span class="sous-kpi">${g.nb ? `${pct(g.taux)} gagnants · ${g.nb} trade${g.nb > 1 ? "s" : ""}` : "aucun trade"}</span>
          </div>`).join("")}</div>` })}

      ${r.tps.length ? carte({ cle: "tps", titre: "TP atteints", resume: `<span>TP1 ${pct(r.tps[0].pct)}</span>`,
        contenu: `<div class="tps-analyse">${r.tps.map((tp) => `
          <div class="tp-analyse">
            <span class="anneau-kpi petit-anneau" style="--p:${Math.round(tp.pct)}"><strong>${pct(tp.pct)}</strong></span>
            <span class="lib-kpi">TP${tp.numero}</span>
            <span class="sous-kpi">${tp.atteints} / ${tp.total}</span>
          </div>`).join("")}</div>` }) : ""}`;
  }

  let enCours = null;
  let filtreLu = false;
  async function afficher() {
    if (!$("contenu-analyse-trades") || !window.GoldAI.auth?.getToken()) return;
    const tache = (async () => {
      if (!filtreLu) { filtreLu = true; J().lireFiltreMemorise(); } // une seule fois : l'événement du filtre relance afficher()
      J().afficherSelecteurCompte("choix-compte-analyse");
      await Promise.all([J().chargerTousLesTrades(), chargerPositions()]);
      const trades = tradesRetenus();
      dessiner(N.analyserTrades(trades, { positions, moment }), trades);
    })();
    enCours = tache;
    try { await tache; } finally { if (enCours === tache) enCours = null; }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("choix-compte-analyse")?.addEventListener("change", (e) => J().changerFiltreCompte(e.target.value));
    $("filtres-periode-analyse")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-periode]");
      if (!b) return;
      periode = b.dataset.periode;
      document.querySelectorAll("#filtres-periode-analyse [data-periode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      afficher();
    });
    U.basculerSections($("contenu-analyse-trades"), ouvertes);
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
