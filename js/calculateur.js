// Gold AI — section Calculateur : colle un signal, obtiens la taille de position.
//
// Le texte est lu par js/noyau.js (lireSignal), le calcul fait par
// calculerPosition avec les paramètres de Profil › Général. Le signal
// interprété est TOUJOURS affiché et modifiable sur place avant de faire
// confiance au résultat. Aucun ordre n'est envoyé nulle part : c'est un
// calcul affiché à l'écran, rien de plus.
(() => {
  const { esc, montant, nombre } = window.GoldAI.utils;
  const N = window.GoldAI.noyau;

  let signalCourant = null;     // signal (éventuellement corrigé à la main)
  let lectureCourante = null;   // résultat brut de lireSignal (ambiguïtés, lignes ignorées)
  let repartitionForcee = null; // répartition au prorata choisie pour CE calcul uniquement
  let taux = null;              // { taux, horodatageMs, source, manuel }

  function champ(id, label, valeur, { type = "number", manquant = false, options = null } = {}) {
    const classe = manquant ? "champ a-preciser" : "champ";
    if (options) {
      return `<div class="${classe}"><label for="${id}">${label}${manquant ? " — à préciser" : ""}</label>
        <select id="${id}"><option value="">—</option>${options.map((o) => `<option ${o === valeur ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
    }
    return `<div class="${classe}"><label for="${id}">${label}${manquant ? " — à préciser" : ""}</label>
      <input id="${id}" type="${type}" ${type === "number" ? 'inputmode="decimal" step="any"' : ""} value="${valeur ?? ""}" /></div>`;
  }

  function afficherSignalEditable(s, lecture) {
    const manque = (c) => lecture.aPreciser.includes(c) || lecture.ambiguites.some((a) => a.champ === c);
    const tps = s.tps.length ? s.tps : [{ numero: 1, prix: null }];
    return `
      <div class="carte bloc-signal">
        <h3 class="titre-bloc">Signal interprété <span class="aide-inline">vérifie et corrige si besoin</span></h3>
        ${lecture.ambiguites.map((a) => `
          <div class="alerte-donnees">${esc(a.message)}
            ${a.options ? `<div class="choix-ambiguite">${a.options.map((o) => `<button type="button" class="puce-choix" data-champ="${esc(a.champ)}" data-valeur="${esc(o)}">${esc(o)}</button>`).join("")}</div>` : ""}
          </div>`).join("")}
        <div class="ligne-champs">
          ${champ("sig-instrument", "Instrument", s.instrument, { type: "text", manquant: manque("instrument") })}
          ${champ("sig-sens", "Sens", s.sens, { manquant: manque("sens"), options: ["BUY", "SELL"] })}
        </div>
        <div class="ligne-champs">
          ${champ("sig-entree", "Entrée", s.entree, { manquant: manque("entree") })}
          ${champ("sig-sl", "Stop-loss (SL)", s.sl, { manquant: manque("sl") })}
        </div>
        <div id="sig-liste-tps" class="grille-tps">
          ${tps.map((t, i) => champ(`sig-tp-${i}`, `TP${t.numero ?? i + 1}`, t.prix, { manquant: manque("tps") && t.prix === null })).join("")}
        </div>
        <div class="ligne-actions">
          <button type="button" class="bouton secondaire bouton-petit" id="sig-ajouter-tp">+ TP</button>
          <label class="case-a-cocher"><input type="checkbox" id="sig-tp-ouvert" ${s.tpOuverts ? "checked" : ""}/> Le signal a un « TP ouvert » (sans prix)</label>
        </div>
        ${lecture.lignesIgnorees.length ? `<details class="details-discrets"><summary>${lecture.lignesIgnorees.length} ligne(s) ignorée(s) (commentaires)</summary><ul>${lecture.lignesIgnorees.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>` : ""}
      </div>`;
  }

  function lireSignalEditable() {
    const v = (id) => document.getElementById(id)?.value.trim() ?? "";
    const num = (id) => { const x = v(id); return x === "" ? null : N.versNombre(x); };
    const tps = [...document.querySelectorAll("#sig-liste-tps input")]
      .map((c, i) => ({ numero: i + 1, prix: c.value.trim() === "" ? null : N.versNombre(c.value) }))
      .filter((t) => t.prix !== null);
    return {
      instrument: v("sig-instrument").toUpperCase().replace(/[^A-Z0-9]/g, "") || null,
      sens: v("sig-sens") || null,
      entree: num("sig-entree"),
      sl: num("sig-sl"),
      tps,
      tpOuverts: document.getElementById("sig-tp-ouvert")?.checked ? 1 : 0,
    };
  }

  function carteChiffre(label, valeur, sous = "", classe = "") {
    return `<div class="carte-stat ${classe}"><div class="label-stat">${label}</div><div class="valeur-stat">${valeur}</div>${sous ? `<div class="sous-valeur-stat">${sous}</div>` : ""}</div>`;
  }

  function afficherResultat(r, reglages, spec) {
    const d = r.devise;
    const lignes = r.portions.map((p) => `
      <tr>
        <th scope="row">${esc(p.objectif)}</th>
        <td>${p.prix === null ? "<span class=\"texte-attenue\">sans prix</span>" : nombre(p.prix, Math.max(2, (String(p.prix).split(".")[1] || "").length))}</td>
        <td>${nombre(p.pctConfigure, 0)} %${Math.abs(p.pctReel - p.pctConfigure) >= 0.5 ? `<br><span class="texte-attenue">réel ${nombre(p.pctReel, 1)} %</span>` : ""}</td>
        <td><strong>${nombre(p.lot, 2)}</strong></td>
        <td class="positif">${p.gainAuTp === null ? "<span class=\"texte-attenue\">non calculable</span>" : `▲ ${montant(p.gainAuTp, d)}`}</td>
        <td class="negatif">▼ ${montant(p.perteAuSl, d)}</td>
      </tr>`).join("");

    const scenarios = r.scenarios.map((s) => `
      <li><strong>${esc(s.jusqua)} atteint</strong> : gain cumulé des portions clôturées ${montant(s.gainCumule, d)}
      ${s.perteRestantAuSl > 0.005 ? ` ; si le reste revient ensuite au SL initial : −${montant(s.perteRestantAuSl, d)} → net <strong>${montant(s.net, d, { signe: true })}</strong>` : " (toute la position est clôturée)"}</li>`).join("");

    return `
      <div class="grille-stats-perf">
        ${carteChiffre("Risque demandé", montant(r.risqueDemande, d), reglages.risqueMode === "montant" ? "montant fixe" : `${nombre(reglages.risqueValeur, 2)} % de ${montant(reglages.solde, d, { decimales: 0 })}`)}
        ${carteChiffre("Lot total à ouvrir", `${nombre(r.lotTotal, 2)} lot`, `calcul brut ${nombre(r.lotBrut, 4)} → arrondi vers le bas au pas de ${spec.pasLot}`, "carte-mise-en-avant")}
        ${carteChiffre("Perte totale au SL initial", `<span class="negatif">▼ ${montant(r.perteTotaleSl, d)}</span>`, `${nombre(r.ticksSl, 0)} ticks × ${nombre(r.lotTotal, 2)} lot`)}
        ${carteChiffre("Risque effectif après arrondi", montant(r.risqueEffectif, d), `${montant(r.risqueNonUtilise, d)} sous le risque demandé`)}
        ${carteChiffre("Gain si tous les TP chiffrés sont atteints", `<span class="positif">▲ ${montant(r.gainTotalSiTousTps, d)}</span>`, r.contientTpOuvert ? "hors portion « TP ouvert » (sans prix)" : "somme des portions", "carte-stat-large")}
      </div>

      <div class="carte">
        <h3 class="titre-bloc">Répartition par objectif</h3>
        <div class="tableau-defilant">
          <table class="tableau-portions">
            <thead><tr><th scope="col">Objectif</th><th scope="col">Prix</th><th scope="col">Répartition</th><th scope="col">Lot</th><th scope="col">Gain au TP</th><th scope="col">Perte au SL</th></tr></thead>
            <tbody>${lignes}</tbody>
            <tfoot><tr><th scope="row">Total</th><td></td><td>100 %</td><td><strong>${nombre(r.sommeLotsPortions, 2)}</strong></td><td class="positif">▲ ${montant(r.gainTotalSiTousTps, d)}</td><td class="negatif">▼ ${montant(r.perteTotaleSl, d)}</td></tr></tfoot>
          </table>
        </div>
        <p class="aide">« Gain au TP » = gain de cette portion seule (son lot × sa distance). La somme des lots des portions (${nombre(r.sommeLotsPortions, 2)}) est égale au lot total.</p>
        ${scenarios ? `<h4 class="sous-titre-bloc">Gain cumulé des portions clôturées</h4><ul class="liste-scenarios">${scenarios}</ul>` : ""}
      </div>

      ${r.avertissements.length ? `<div class="carte">${r.avertissements.map((a) => `<div class="alerte-donnees">${esc(a)}</div>`).join("")}</div>` : ""}

      <p class="note-source">Montants estimés <strong>hors frais, commissions, spread et slippage</strong>. Le SL est supposé rester au niveau initial : aucun passage à breakeven ni déplacement du stop n'est appliqué.
      ${r.tauxConversion !== 1 && taux ? ` Conversion ${esc(spec.deviseProfit)} → ${esc(d)} au taux ${taux.taux} (${taux.manuel ? "saisi manuellement" : `${esc(taux.source)}, ${window.GoldAI.utils.jourHeure(taux.horodatageMs)}`}).` : ""}
      Aucun ordre n'est envoyé : ce calcul est seulement affiché.</p>`;
  }

  function afficherBlocage(r, reglages, spec) {
    let html = "";
    if (r.aConfigurer.length) {
      html += `<div class="carte alerte-bloc"><h3 class="titre-bloc">À configurer avant de calculer</h3><ul>${r.aConfigurer.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
        <button type="button" class="bouton secondaire bouton-petit" id="aller-general">Ouvrir Profil › Général</button></div>`;
      const besoinTaux = r.aConfigurer.some((a) => a.startsWith("Taux de conversion"));
      if (besoinTaux && spec) {
        html += `<div class="carte"><div class="champ"><label for="calc-taux">1 ${esc(spec.deviseProfit)} = ? ${esc(reglages.devise)}</label>
          <input id="calc-taux" type="number" inputmode="decimal" step="any" value="${taux?.manuel ? taux.taux : ""}" /></div>
          <button type="button" class="bouton secondaire bouton-petit" id="calc-recuperer-taux">Récupérer le taux actuel (Twelve Data)</button>
          <p class="aide">Le taux saisi ou récupéré est affiché avec le résultat.</p></div>`;
      }
    }
    if (r.erreurs.length) {
      html += `<div class="carte alerte-bloc"><h3 class="titre-bloc">Calcul impossible</h3><ul>${r.erreurs.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        ${r.choixRepartition ? `<button type="button" class="bouton secondaire bouton-petit" id="calc-prorata">Répartir au prorata sur les TP chiffrés (ce calcul seulement)</button>` : ""}</div>`;
    }
    if (r.avertissements.length) html += `<div class="carte">${r.avertissements.map((a) => `<div class="alerte-donnees">${esc(a)}</div>`).join("")}</div>`;
    return html;
  }

  async function calculer({ depuisTexte }) {
    const zoneSignal = document.getElementById("zone-signal-interprete");
    const zoneResultat = document.getElementById("zone-resultat-calcul");

    if (depuisTexte) {
      const texte = document.getElementById("champ-signal").value;
      if (!texte.trim()) {
        zoneSignal.innerHTML = "";
        zoneResultat.innerHTML = `<p class="etat-vide">Colle d'abord un signal dans le champ ci-dessus.</p>`;
        return;
      }
      lectureCourante = N.lireSignal(texte);
      signalCourant = { instrument: lectureCourante.instrument, sens: lectureCourante.sens, entree: lectureCourante.entree, sl: lectureCourante.sl, tps: lectureCourante.tps, tpOuverts: lectureCourante.tpOuverts };
      repartitionForcee = null;
      zoneSignal.innerHTML = afficherSignalEditable(signalCourant, lectureCourante);
    } else {
      signalCourant = lireSignalEditable();
    }

    zoneResultat.innerHTML = `<p class="etat-vide">Calcul…</p>`;
    const reglagesBase = await window.GoldAI.reglagesCalculateur.charger();
    const reglages = repartitionForcee ? { ...reglagesBase, repartition: repartitionForcee } : reglagesBase;
    const spec = reglages.instruments?.[signalCourant.instrument];

    // Taux de conversion : seulement si la devise des gains diffère de celle du compte.
    let tauxUtilise = null;
    if (spec && spec.deviseProfit && spec.deviseProfit !== reglages.devise) {
      const saisi = document.getElementById("calc-taux")?.value;
      if (saisi && Number(saisi) > 0) taux = { taux: Number(saisi), manuel: true };
      tauxUtilise = taux?.taux ?? null;
    }

    const r = N.calculerPosition(signalCourant, reglages, tauxUtilise);
    zoneResultat.innerHTML = r.ok ? afficherResultat(r, reglages, spec) : afficherBlocage(r, reglages, spec);
    if (repartitionForcee && r.ok) {
      zoneResultat.insertAdjacentHTML("afterbegin", `<div class="alerte-donnees">Répartition au prorata utilisée pour ce calcul seulement : ${repartitionForcee.map((x) => `${nombre(x, 1)} %`).join(" / ")} (tes paramètres enregistrés ne changent pas).</div>`);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const section = document.getElementById("section-calculateur");
    if (!section) return;

    document.getElementById("bouton-calculer").addEventListener("click", () => calculer({ depuisTexte: true }));

    section.addEventListener("click", async (e) => {
      const t = e.target;
      if (t.classList.contains("puce-choix")) {
        const correspondance = { entree: "sig-entree", sl: "sig-sl", sens: "sig-sens", instrument: "sig-instrument" };
        const id = correspondance[t.dataset.champ];
        if (id) document.getElementById(id).value = t.dataset.valeur;
        t.closest(".alerte-donnees").remove();
        calculer({ depuisTexte: false });
      } else if (t.id === "sig-ajouter-tp") {
        const liste = document.getElementById("sig-liste-tps");
        const n = liste.querySelectorAll("input").length;
        liste.insertAdjacentHTML("beforeend", champ(`sig-tp-${n}`, `TP${n + 1}`, null));
      } else if (t.id === "aller-general") {
        window.GoldAI.app.allerA("profil");
        document.getElementById("bouton-ouvrir-parametres").click();
      } else if (t.id === "calc-prorata") {
        const reglages = await window.GoldAI.reglagesCalculateur.charger();
        const nb = signalCourant.tps.length + (signalCourant.tpOuverts ? 1 : 0);
        const base = reglages.repartition.slice(0, nb);
        const somme = base.reduce((s, x) => s + x, 0);
        repartitionForcee = base.map((x) => (x / somme) * 100);
        calculer({ depuisTexte: false });
      } else if (t.id === "calc-recuperer-taux") {
        const reglages = await window.GoldAI.reglagesCalculateur.charger();
        const spec = reglages.instruments?.[signalCourant?.instrument];
        t.disabled = true;
        try {
          taux = await window.GoldAI.cotations.tauxChange(spec.deviseProfit, reglages.devise);
          document.getElementById("calc-taux").value = "";
          calculer({ depuisTexte: false });
        } catch (err) {
          t.insertAdjacentHTML("afterend", `<p class="avertissement-erreur visible">Taux indisponible (${esc(err.message)}) : saisis-le manuellement.</p>`);
        } finally { t.disabled = false; }
      }
    });

    // Correction sur place : chaque modification du signal interprété relance le calcul.
    section.addEventListener("change", (e) => {
      if (e.target.closest("#zone-signal-interprete") || e.target.id === "calc-taux") calculer({ depuisTexte: false });
    });
  });

  window.addEventListener("goldai:reglages-calculateur", () => {
    if (signalCourant && document.getElementById("section-calculateur")?.classList.contains("actif")) calculer({ depuisTexte: false });
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.calculateur = { calculer };
})();
