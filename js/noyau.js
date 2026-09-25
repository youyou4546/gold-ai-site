// Gold AI — logique "pure" (sans affichage) partagée par plusieurs sections :
// lecture d'un signal, calcul de position, tendances, fusion du calendrier,
// classement des annonces, méthode "Impact probable".
//
// Aucune fonction ici ne touche à la page ni au réseau : elles reçoivent des
// données et renvoient un résultat. C'est ce qui permet de les vérifier
// automatiquement (tests/noyau.test.cjs, lancé avec Node).
(function (racine) {
  "use strict";

  // =====================================================================
  // 1. LECTURE D'UN SIGNAL COLLÉ
  // =====================================================================

  const CODES_DEVISES = ["XAU", "XAG", "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "BTC", "ETH"];
  const ALIAS_INSTRUMENTS = { GOLD: "XAUUSD", SILVER: "XAGUSD", "US30": "US30", NAS100: "NAS100", US100: "NAS100", SPX500: "SPX500", GER40: "GER40" };

  // "4 335,50" / "4335.5" / "1.0850" → nombre
  const MOTIF_NOMBRE = /\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

  function versNombre(texte) {
    const propre = String(texte).replace(/[   ]/g, "").replace(",", ".");
    const n = Number(propre);
    return Number.isFinite(n) ? n : null;
  }

  function nombresDans(texte) {
    return (String(texte).match(MOTIF_NOMBRE) || []).map(versNombre).filter((n) => n !== null);
  }

  // Retire emojis et symboles décoratifs, garde lettres/chiffres/ponctuation utile.
  function nettoyerLigne(ligne) {
    return ligne
      .normalize("NFC")
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function detecterInstrument(texte) {
    const maj = texte.toUpperCase();
    const trouves = new Set();
    const motifPaire = /\b([A-Z]{3})\s*\/?\s*([A-Z]{3})\b/g;
    let m;
    while ((m = motifPaire.exec(maj))) {
      if (CODES_DEVISES.includes(m[1]) && CODES_DEVISES.includes(m[2]) && m[1] !== m[2]) trouves.add(m[1] + m[2]);
    }
    Object.keys(ALIAS_INSTRUMENTS).forEach((alias) => {
      if (new RegExp(`\\b${alias}\\b`).test(maj)) trouves.add(ALIAS_INSTRUMENTS[alias]);
    });
    return [...trouves];
  }

  const MOTIF_ACHAT = /\b(buy|achat|acheter|achete|achète|long)\b/i;
  const MOTIF_VENTE = /\b(sell|vente|vendre|vends|short)\b/i;
  const MOTIF_ENTREE = /(point\s*d.?\s*entr[ée]e|entr[ée]e|entry|prix\s*d.?\s*entr[ée]e|open\s*price|@)/i;
  const MOTIF_SL = /\b(sl|s\/l|stop[\s-]*loss|stop)\b/i;
  const MOTIF_TP = /\b(?:tp|take[\s-]*profit|objectif|target)\s*(\d{1,2}(?![\d.,]))?\s*[:=\-–>]*\s*/i;
  const MOTIF_TP_OUVERT = /\b(ouvert|open|runner|libre|illimit[ée])\b/i;

  /**
   * Lit un signal texte. Ne devine jamais un prix : tout ce qui n'est pas
   * trouvé clairement est listé dans `aPreciser`, les doublons dans `ambiguites`.
   */
  function lireSignal(texte) {
    const resultat = {
      instrument: null, sens: null, entree: null, sl: null,
      tps: [],            // [{ numero, prix }]
      tpOuverts: 0,       // "TP OUVERT" : objectif sans prix
      aPreciser: [], ambiguites: [], lignesIgnorees: [],
      candidatsEntree: [], candidatsSl: [],
    };
    const lignes = String(texte || "").split(/\r?\n/).map(nettoyerLigne).filter(Boolean);

    const instruments = detecterInstrument(lignes.join(" "));
    if (instruments.length === 1) resultat.instrument = instruments[0];
    else if (instruments.length > 1) resultat.ambiguites.push({ champ: "instrument", message: `Plusieurs instruments trouvés : ${instruments.join(", ")}.`, options: instruments });

    const achat = lignes.some((l) => MOTIF_ACHAT.test(l));
    const vente = lignes.some((l) => MOTIF_VENTE.test(l));
    if (achat && !vente) resultat.sens = "BUY";
    else if (vente && !achat) resultat.sens = "SELL";
    else if (achat && vente) resultat.ambiguites.push({ champ: "sens", message: "Le texte contient à la fois achat et vente.", options: ["BUY", "SELL"] });

    let numeroAuto = 0;
    lignes.forEach((ligne) => {
      const tp = ligne.match(MOTIF_TP);
      if (tp) {
        const reste = ligne.slice(tp.index + tp[0].length);
        const prix = nombresDans(reste);
        const numero = tp[1] ? Number(tp[1]) : null;
        if (prix.length > 0) {
          numeroAuto = numero || numeroAuto + 1;
          resultat.tps.push({ numero: numeroAuto, prix: prix[0] });
          if (prix.length > 1) resultat.ambiguites.push({ champ: `tp${numeroAuto}`, message: `TP${numeroAuto} : plusieurs nombres sur la ligne « ${ligne} » — le premier (${prix[0]}) est retenu, vérifie-le.` });
        } else if (MOTIF_TP_OUVERT.test(reste) || reste.trim() === "") {
          resultat.tpOuverts += 1;
        }
        return;
      }
      if (MOTIF_SL.test(ligne)) {
        const apres = ligne.slice(ligne.search(MOTIF_SL));
        const prix = nombresDans(apres);
        if (prix.length) resultat.candidatsSl.push(...prix);
        return;
      }
      if (MOTIF_ENTREE.test(ligne)) {
        const apres = ligne.slice(ligne.search(MOTIF_ENTREE));
        const prix = nombresDans(apres);
        if (prix.length) resultat.candidatsEntree.push(...prix);
        return;
      }
      // "Sell XAUUSD 4335" : prix sur la ligne du sens.
      if ((MOTIF_ACHAT.test(ligne) || MOTIF_VENTE.test(ligne))) {
        const sansInstrument = ligne.replace(/\b[A-Z]{3}\s*\/?\s*[A-Z]{3}\b/gi, " ");
        const prix = nombresDans(sansInstrument);
        if (prix.length) resultat.candidatsEntree.push(...prix);
        return;
      }
      resultat.lignesIgnorees.push(ligne);
    });

    const uniques = (liste) => [...new Set(liste)];
    const entrees = uniques(resultat.candidatsEntree);
    if (entrees.length === 1) resultat.entree = entrees[0];
    else if (entrees.length > 1) resultat.ambiguites.push({ champ: "entree", message: `Plusieurs entrées possibles : ${entrees.join(" / ")}. Choisis celle à utiliser.`, options: entrees });

    const sls = uniques(resultat.candidatsSl);
    if (sls.length === 1) resultat.sl = sls[0];
    else if (sls.length > 1) resultat.ambiguites.push({ champ: "sl", message: `Plusieurs stop-loss possibles : ${sls.join(" / ")}.`, options: sls });

    // Numéros de TP en double (ex. deux "TP2")
    const numeros = resultat.tps.map((t) => t.numero);
    if (new Set(numeros).size !== numeros.length) resultat.ambiguites.push({ champ: "tps", message: "Deux TP portent le même numéro : vérifie la liste des TP." });
    resultat.tps.sort((a, b) => a.numero - b.numero);

    if (!resultat.instrument && instruments.length === 0) resultat.aPreciser.push("instrument");
    if (!resultat.sens && !(achat && vente)) resultat.aPreciser.push("sens");
    if (resultat.entree === null && entrees.length === 0) resultat.aPreciser.push("entree");
    if (resultat.sl === null && sls.length === 0) resultat.aPreciser.push("sl");
    if (resultat.tps.length === 0) resultat.aPreciser.push("tps");
    return resultat;
  }

  // =====================================================================
  // 2. CALCUL DE POSITION
  // =====================================================================

  const EPS = 1e-9;

  function nbDecimales(x) {
    const s = String(x);
    if (s.includes("e-")) return Number(s.split("e-")[1]);
    return s.includes(".") ? s.split(".")[1].length : 0;
  }

  function arrondir(x, decimales) {
    const f = 10 ** decimales;
    return Math.round(x * f) / f;
  }

  /** Répartit `unites` entières selon des pourcentages (méthode du plus fort reste). */
  function repartirUnites(unites, pourcentages) {
    const bruts = pourcentages.map((p) => (unites * p) / 100);
    const base = bruts.map((b) => Math.floor(b + EPS));
    let reste = unites - base.reduce((s, x) => s + x, 0);
    const ordre = bruts.map((b, i) => ({ i, frac: b - Math.floor(b + EPS) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; reste > 0 && k < ordre.length; k++, reste--) base[ordre[k].i] += 1;
    return base;
  }

  /**
   * signal : { instrument, sens, entree, sl, tps:[{numero, prix}], tpOuverts }
   * reglages : { solde, devise, risqueMode:"pourcentage"|"montant", risqueValeur,
   *              repartition:[%...], instruments:{ SYMBOLE: spec } }
   * spec : { tailleContrat, tailleTick, valeurTick, deviseProfit, lotMin, lotMax, pasLot }
   * tauxConversion : combien d'unités de la devise du compte vaut 1 unité de
   *                  deviseProfit (null si pas besoin / inconnu).
   */
  function calculerPosition(signal, reglages, tauxConversion) {
    const erreurs = [];
    const avertissements = [];
    const aConfigurer = [];

    const spec = reglages?.instruments?.[signal.instrument];
    if (!signal.instrument) erreurs.push("Instrument non précisé.");
    else if (!spec) aConfigurer.push(`Spécifications de ${signal.instrument} (Profil › Général › Paramètres du calculateur).`);

    if (!(reglages?.solde > 0) && reglages?.risqueMode !== "montant") aConfigurer.push("Solde du compte.");
    if (!(reglages?.risqueValeur > 0)) aConfigurer.push("Risque par trade.");
    if (!reglages?.devise) aConfigurer.push("Devise du compte.");
    const repartition = (reglages?.repartition || []).map(Number);
    const sommeRep = repartition.reduce((s, x) => s + x, 0);
    if (repartition.length === 0) aConfigurer.push("Répartition entre les TP.");
    else if (Math.abs(sommeRep - 100) > 1e-6) aConfigurer.push(`Répartition des TP : le total fait ${arrondir(sommeRep, 4)} % au lieu de 100 %.`);
    if (repartition.some((p) => !(p > 0))) aConfigurer.push("Répartition des TP : chaque portion doit être supérieure à 0 %.");

    if (spec) {
      ["tailleTick", "valeurTick", "lotMin", "lotMax", "pasLot"].forEach((cle) => {
        if (!(Number(spec[cle]) > 0)) aConfigurer.push(`${signal.instrument} : « ${LIBELLES_SPEC[cle]} » manquant.`);
      });
      if (!spec.deviseProfit) aConfigurer.push(`${signal.instrument} : devise des gains/pertes manquante.`);
      if (spec.tailleContrat > 0 && spec.tailleTick > 0 && spec.valeurTick > 0) {
        const attendu = spec.tailleContrat * spec.tailleTick;
        if (Math.abs(attendu - spec.valeurTick) / spec.valeurTick > 0.001) {
          avertissements.push(`${signal.instrument} : taille du contrat × taille du tick = ${arrondir(attendu, 6)}, différent de la valeur du tick (${spec.valeurTick}). Le calcul utilise la valeur du tick (définition du courtier) — vérifie tes réglages.`);
        }
      }
    }

    ["entree", "sl"].forEach((c) => { if (!(signal[c] > 0)) erreurs.push(c === "entree" ? "Prix d'entrée manquant." : "Stop-loss manquant."); });
    if (!signal.sens) erreurs.push("Sens (BUY/SELL) manquant.");
    if (!signal.tps || signal.tps.length === 0) erreurs.push("Aucun TP chiffré.");

    if (erreurs.length || aConfigurer.length) return { ok: false, erreurs, aConfigurer, avertissements };

    // --- Cohérence du sens ---
    const vente = signal.sens === "SELL";
    if (vente && !(signal.sl > signal.entree)) erreurs.push(`SELL : le SL (${signal.sl}) doit être AU-DESSUS de l'entrée (${signal.entree}).`);
    if (!vente && !(signal.sl < signal.entree)) erreurs.push(`BUY : le SL (${signal.sl}) doit être EN DESSOUS de l'entrée (${signal.entree}).`);
    signal.tps.forEach((tp) => {
      if (vente && !(tp.prix < signal.entree)) erreurs.push(`SELL : TP${tp.numero} (${tp.prix}) doit être en dessous de l'entrée (${signal.entree}).`);
      if (!vente && !(tp.prix > signal.entree)) erreurs.push(`BUY : TP${tp.numero} (${tp.prix}) doit être au-dessus de l'entrée (${signal.entree}).`);
    });
    const distances = signal.tps.map((t) => Math.abs(t.prix - signal.entree));
    if (distances.some((d, i) => i > 0 && d < distances[i - 1])) avertissements.push("Les TP ne sont pas rangés du plus proche au plus éloigné : vérifie leur ordre.");
    if (erreurs.length) return { ok: false, erreurs, aConfigurer, avertissements };

    // --- Conversion de devise ---
    let taux = 1;
    if (spec.deviseProfit !== reglages.devise) {
      if (!(tauxConversion > 0)) {
        return { ok: false, erreurs: [], avertissements, aConfigurer: [`Taux de conversion ${spec.deviseProfit} → ${reglages.devise} (indisponible : saisis-le dans le calculateur).`] };
      }
      taux = tauxConversion;
    }

    // --- Risque demandé ---
    const risqueDemande = reglages.risqueMode === "montant"
      ? Number(reglages.risqueValeur)
      : (Number(reglages.solde) * Number(reglages.risqueValeur)) / 100;

    const valeurTickCompte = spec.valeurTick * taux;          // par lot, devise du compte
    const ticksSl = Math.abs(signal.entree - signal.sl) / spec.tailleTick;
    const pertePourUnLot = ticksSl * valeurTickCompte;
    const lotBrut = risqueDemande / pertePourUnLot;

    // --- Lot total : arrondi VERS LE BAS au pas du courtier (jamais au-dessus du risque) ---
    const pas = Number(spec.pasLot);
    const decimalesLot = Math.max(nbDecimales(pas), nbDecimales(spec.lotMin));
    let unites = Math.floor(lotBrut / pas + EPS);
    let lotTotal = arrondir(unites * pas, decimalesLot);

    // Portions : chaque portion est un ordre séparé → soumise au lot min / max.
    const nbTps = signal.tps.length;
    const nbPortions = repartition.length;
    const portionsDef = [];
    for (let i = 0; i < nbPortions; i++) {
      if (i < nbTps) portionsDef.push({ type: "tp", numero: signal.tps[i].numero, prix: signal.tps[i].prix, pct: repartition[i] });
      else if (i === nbTps && signal.tpOuverts > 0) portionsDef.push({ type: "ouvert", numero: null, prix: null, pct: repartition[i] });
      else portionsDef.push({ type: "sans_objectif", numero: null, prix: null, pct: repartition[i] });
    }
    const sansObjectif = portionsDef.filter((p) => p.type === "sans_objectif").length;
    if (sansObjectif > 0) {
      return {
        ok: false, avertissements, aConfigurer: [],
        erreurs: [`La répartition configurée prévoit ${nbPortions} portions mais le signal ne donne que ${nbTps} TP chiffré(s)${signal.tpOuverts ? " + 1 TP ouvert" : ""}. Choisis comment répartir (bouton ci-dessous) ou ajuste la répartition dans Général.`],
        choixRepartition: true,
      };
    }
    if (nbTps > nbPortions) avertissements.push(`Le signal contient ${nbTps} TP chiffrés mais ta répartition n'en prévoit que ${nbPortions} : ${signal.tps.slice(nbPortions).map((t) => `TP${t.numero}`).join(", ")} ignoré(s).`);
    if (signal.tpOuverts > 0 && !portionsDef.some((p) => p.type === "ouvert")) {
      avertissements.push("« TP ouvert » (sans prix) : aucune portion ne lui est attribuée, car ta répartition est entièrement utilisée par les TP chiffrés. Aucun prix ni gain n'est inventé pour lui.");
    }

    const unitesMin = Math.round(spec.lotMin / pas);
    const unitesMax = Math.floor(spec.lotMax / pas + EPS);
    if (unites < unitesMin * nbPortions) {
      const lotMinTotal = arrondir(unitesMin * nbPortions * pas, decimalesLot);
      const risqueMinimal = lotMinTotal * pertePourUnLot;
      return {
        ok: false, avertissements, aConfigurer: [],
        erreurs: [lotBrut < spec.lotMin
          ? `Impossible : pour ne pas dépasser ${risqueDemande.toFixed(2)} ${reglages.devise} de risque, il faudrait ${lotBrut.toFixed(4)} lot, sous le lot minimum (${spec.lotMin}).`
          : `Impossible de répartir ${lotTotal} lot en ${nbPortions} portions d'au moins ${spec.lotMin} lot : il faudrait au minimum ${lotMinTotal} lot, soit ${risqueMinimal.toFixed(2)} ${reglages.devise} de risque (plus que les ${risqueDemande.toFixed(2)} demandés). Réduis le nombre de portions ou augmente le risque.`],
        details: { risqueDemande, lotBrut, lotTotal, pertePourUnLot },
      };
    }

    let unitesPortions = repartirUnites(unites, portionsDef.map((p) => p.pct));
    // Si une portion tombe sous le lot minimum, on remonte-la en prenant aux plus grosses
    // (le total ne change pas, donc le risque non plus).
    for (let i = 0; i < unitesPortions.length; i++) {
      while (unitesPortions[i] < unitesMin) {
        const donneur = unitesPortions.map((u, j) => ({ u, j })).filter((x) => x.j !== i && x.u > unitesMin).sort((a, b) => b.u - a.u)[0];
        if (!donneur) break;
        unitesPortions[donneur.j] -= 1;
        unitesPortions[i] += 1;
      }
    }
    if (unitesPortions.some((u) => u < unitesMin)) {
      return { ok: false, avertissements, aConfigurer: [], erreurs: [`Impossible de respecter le lot minimum (${spec.lotMin}) pour chaque portion avec ${lotTotal} lot au total.`] };
    }
    if (unitesPortions.some((u) => u > unitesMax)) {
      return { ok: false, avertissements, aConfigurer: [], erreurs: [`Une portion dépasserait le lot maximum par ordre (${spec.lotMax}). Il faudrait découper cette portion en plusieurs ordres : le calculateur ne le fait pas automatiquement.`] };
    }
    if (unitesPortions.some((u, i) => Math.abs(u * pas - (lotTotal * portionsDef[i].pct) / 100) > pas * 0.5 + EPS)) {
      avertissements.push("Répartition ajustée pour respecter le lot minimum : les pourcentages réels diffèrent un peu de ceux configurés.");
    }

    const lotsPortions = unitesPortions.map((u) => arrondir(u * pas, decimalesLot));
    const perteParPortion = lotsPortions.map((lot) => lot * pertePourUnLot);
    const perteTotale = lotTotal * pertePourUnLot;

    let cumul = 0;
    const portions = portionsDef.map((p, i) => {
      const lot = lotsPortions[i];
      let gain = null;
      if (p.type === "tp") {
        const ticks = Math.abs(p.prix - signal.entree) / spec.tailleTick;
        gain = lot * ticks * valeurTickCompte;
        cumul += gain;
      }
      return {
        objectif: p.type === "tp" ? `TP${p.numero}` : "TP ouvert",
        type: p.type,
        prix: p.prix,
        pctConfigure: p.pct,
        pctReel: lotTotal > 0 ? (lot / lotTotal) * 100 : 0,
        lot,
        gainAuTp: gain,                          // gain de CETTE portion uniquement
        gainCumuleSiCloturee: p.type === "tp" ? cumul : null, // portions clôturées jusqu'ici
        perteAuSl: perteParPortion[i],
      };
    });

    // Scénarios "TPk atteint, puis le reste revient au SL initial" (sans breakeven).
    const scenarios = [];
    let cumulGain = 0, lotsFermes = 0;
    portions.forEach((p) => {
      if (p.type !== "tp") return;
      cumulGain += p.gainAuTp;
      lotsFermes += p.lot;
      const perteReste = (lotTotal - lotsFermes) * pertePourUnLot;
      scenarios.push({ jusqua: p.objectif, gainCumule: cumulGain, perteRestantAuSl: perteReste, net: cumulGain - perteReste });
    });

    const gainTotalTps = portions.filter((p) => p.type === "tp").reduce((s, p) => s + p.gainAuTp, 0);

    return {
      ok: true, erreurs: [], aConfigurer: [], avertissements,
      devise: reglages.devise,
      risqueDemande,
      lotBrut,
      lotTotal,
      sommeLotsPortions: arrondir(lotsPortions.reduce((s, x) => s + x, 0), decimalesLot),
      perteTotaleSl: perteTotale,
      risqueEffectif: perteTotale,
      risqueNonUtilise: risqueDemande - perteTotale,
      tauxConversion: taux,
      ticksSl,
      portions,
      gainTotalSiTousTps: gainTotalTps,
      contientTpOuvert: portions.some((p) => p.type === "ouvert"),
      scenarios,
    };
  }

  const LIBELLES_SPEC = {
    tailleContrat: "taille du contrat", tailleTick: "taille du tick", valeurTick: "valeur du tick",
    lotMin: "lot minimum", lotMax: "lot maximum", pasLot: "pas de lot",
  };

  // =====================================================================
  // 3. TENDANCES (bougies CLÔTURÉES uniquement)
  // =====================================================================
  //
  // Méthode (identique pour 30 min, 1 h, 4 h et 1 semaine) :
  //   - EMA20 des clôtures, ATR14 (amplitude moyenne) comme unité de mesure.
  //   - Signal A (position) : clôture vs EMA20, compté si l'écart > 0,25 ATR.
  //   - Signal B (pente)    : EMA20 maintenant vs il y a 5 bougies, si > 0,1 ATR.
  //   - Signal C (structure): clôture vs clôture d'il y a 10 bougies, si > 0,5 ATR.
  //   Chaque signal vaut +1 / 0 / −1. Somme ≥ +2 → haussier, ≤ −2 → baissier,
  //   sinon neutre. Moins de 30 bougies clôturées → "insuffisant".

  function ema(valeurs, periode) {
    const k = 2 / (periode + 1);
    const sortie = [];
    let prec = null;
    valeurs.forEach((v, i) => {
      if (i < periode - 1) { sortie.push(null); return; }
      if (prec === null) prec = valeurs.slice(0, periode).reduce((s, x) => s + x, 0) / periode;
      else prec = v * k + prec * (1 - k);
      sortie.push(prec);
    });
    return sortie;
  }

  function atr(bougies, periode = 14) {
    const trs = bougies.map((b, i) => {
      if (i === 0) return b.haut - b.bas;
      const pc = bougies[i - 1].cloture;
      return Math.max(b.haut - b.bas, Math.abs(b.haut - pc), Math.abs(b.bas - pc));
    });
    const recents = trs.slice(-periode);
    return recents.reduce((s, x) => s + x, 0) / recents.length;
  }

  function signe(x, seuil) {
    return x > seuil ? 1 : x < -seuil ? -1 : 0;
  }

  function calculerTendance(bougiesCloturees) {
    const b = bougiesCloturees || [];
    if (b.length < 30) return { etat: "insuffisant", score: null, raison: `${b.length} bougies clôturées (30 nécessaires)` };
    const closes = b.map((x) => x.cloture);
    const e = ema(closes, 20);
    const a = atr(b, 14);
    const n = b.length - 1;
    const sA = signe(closes[n] - e[n], 0.25 * a);
    const sB = signe(e[n] - e[n - 5], 0.1 * a);
    const sC = signe(closes[n] - closes[n - 10], 0.5 * a);
    const score = sA + sB + sC;
    return {
      etat: score >= 2 ? "haussier" : score <= -2 ? "baissier" : "neutre",
      score, details: { position: sA, pente: sB, structure: sC },
      ema20: e[n], atr14: a, derniereCloture: closes[n],
      plusHaut10: Math.max(...b.slice(-10).map((x) => x.haut)),
      plusBas10: Math.min(...b.slice(-10).map((x) => x.bas)),
    };
  }

  // Sépare bougies clôturées / en cours à partir de leur heure de début + durée.
  function separerBougies(bougies, dureeMs, maintenantMs) {
    const cloturees = [], enCours = [];
    bougies.forEach((b) => ((b.debut + dureeMs <= maintenantMs) ? cloturees : enCours).push(b));
    return { cloturees, enCours: enCours[enCours.length - 1] || null };
  }

  // =====================================================================
  // 4. CALENDRIER : fusion multi-sources + écart résultat/prévision
  // =====================================================================

  function normaliserTitre(t) {
    return String(t || "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").replace(/\b(m m|y y|q q|mom|yoy|qoq)\b/g, "").trim();
  }

  /**
   * listes : { "Forex Factory": [ev...], "Autre source": [ev...] }
   * Deux événements sont "le même" si même devise, titres normalisés égaux et
   * horaires à moins de 30 min. Les valeurs de chaque source sont gardées ;
   * une divergence est signalée, jamais tranchée silencieusement.
   */
  function fusionnerCalendriers(listes) {
    const fusion = [];
    Object.entries(listes).forEach(([source, evs]) => {
      (evs || []).forEach((ev) => {
        const t = ev.horodatage_utc ? Date.parse(ev.horodatage_utc) : null;
        const cle = normaliserTitre(ev.titre);
        const existant = fusion.find((f) => f.devise === ev.devise && f._cle === cle &&
          ((t === null && f._t === null && f.date_utc === ev.date_utc) || (t !== null && f._t !== null && Math.abs(f._t - t) <= 30 * 60000)));
        const valeurs = (ev.valeurs || []).map((v) => ({ ...v, source: v.source || source }));
        if (existant) {
          existant.valeurs.push(...valeurs);
          existant.sources = [...new Set([...existant.sources, source])];
          if (existant.impact !== ev.impact) existant.divergences.push(`importance : ${existant.impact} (${existant.sources[0]}) vs ${ev.impact} (${source})`);
          if (existant._t !== t) existant.divergences.push(`heure différente selon ${source}`);
        } else {
          fusion.push({ ...ev, valeurs, sources: [source], divergences: [], _cle: cle, _t: t });
        }
      });
    });
    fusion.forEach((f) => {
      ["prevision", "precedent", "resultat"].forEach((champ) => {
        const vals = [...new Set(f.valeurs.map((v) => v[champ]).filter((v) => v !== null && v !== undefined && v !== ""))];
        if (vals.length > 1) f.divergences.push(`${champ} : ${f.valeurs.filter((v) => v[champ]).map((v) => `${v[champ]} (${v.source})`).join(" vs ")}`);
      });
      delete f._cle; delete f._t;
    });
    return fusion;
  }

  function valeurNumerique(v) {
    if (v === null || v === undefined || v === "") return null;
    const m = String(v).trim().match(/^([<>]?)(-?\d+(?:[.,]\d+)?)\s*(%|[KMBT])?$/i);
    if (!m) return null;
    return { nombre: Number(m[2].replace(",", ".")), unite: (m[3] || "").toUpperCase() };
  }

  /** Écart résultat − prévision seulement si les deux existent avec la même unité. */
  function ecartResultatPrevision(resultat, prevision) {
    const r = valeurNumerique(resultat), p = valeurNumerique(prevision);
    if (!r || !p || r.unite !== p.unite) return null;
    return { ecart: Math.round((r.nombre - p.nombre) * 10000) / 10000, unite: r.unite };
  }

  // =====================================================================
  // 5. CLASSEMENT DES ANNONCES ET ACTUALITÉS
  // =====================================================================
  //
  // Score de priorité (sert uniquement à ORDONNER, pas une probabilité) :
  //   importance  : haute/high 3 · moyenne/medium 2 · faible/low 1
  //   pertinence  : XAUUSD +2 · USD +1.5 (annonce en USD ou actif USD)
  //   fraîcheur   : actualité < 2 h +1.5 · < 6 h +1 · < 24 h +0.5
  //                 annonce dans < 2 h +1.5 · < 24 h +0.75 · publiée < 2 h +1
  //   fiabilité   : source officielle +1 · confirmé +1 · en développement +0.25
  //                 non confirmé −0.5

  function scorePriorite(item, maintenantMs) {
    const raisons = [];
    let s = 0;
    const imp = { haute: 3, high: 3, moyenne: 2, medium: 2, faible: 1, low: 1 }[item.importance] || 0;
    s += imp;
    if (imp === 3) raisons.push("importance forte");

    const actifs = item.actifs || [];
    if (actifs.includes("XAUUSD")) { s += 2; raisons.push("concerne l'or"); }
    if (actifs.includes("USD") || item.devise === "USD") { s += 1.5; raisons.push("concerne le dollar"); }

    if (item.type === "actualite") {
      const ageH = (maintenantMs - Date.parse(item.publie_le)) / 3600000;
      if (ageH < 2) { s += 1.5; raisons.push("très récente"); } else if (ageH < 6) s += 1; else if (ageH < 24) s += 0.5;
      if (item.officiel) { s += 1; raisons.push("source officielle"); }
      if (item.statut === "confirmé") { s += 1; raisons.push("confirmée"); } else if (item.statut === "en développement") s += 0.25; else s -= 0.5;
    } else if (item.horodatage_utc) {
      const dH = (Date.parse(item.horodatage_utc) - maintenantMs) / 3600000;
      if (dH >= 0 && dH < 2) { s += 1.5; raisons.push("publication imminente"); } else if (dH >= 0 && dH < 24) { s += 0.75; raisons.push("dans les 24 h"); } else if (dH < 0 && dH > -2) { s += 1; raisons.push("vient de sortir"); }
    }
    return { score: Math.round(s * 100) / 100, raisons };
  }

  // =====================================================================
  // 6. "IMPACT PROBABLE" — combinaison des signaux
  // =====================================================================
  //
  // Voir docs/METHODE_IMPACT.md pour la version détaillée. En bref :
  //   Signaux (+1 favorable à la hausse de l'actif, −1 à la baisse, 0 neutre) :
  //     - tendances 30 min, 1 h, 4 h (poids 1 chacune)          → court terme
  //     - tendance 1W (poids 1)                                 → contexte seulement
  //     - dollar et taux US : variation du jour × signe de la corrélation
  //       OBSERVÉE sur 60 séances (si |corrélation| ≥ 0,3 et variation
  //       significative) — poids 1 chacun. L'argent n'est PAS compté (il
  //       réagit aux mêmes causes : le compter doublerait l'information).
  //     - actualités urgentes confirmées, pertinentes pour l'or, < 6 h :
  //       interprétation haussière/baissière, plafonnée à ±1 AU TOTAL (un
  //       même événement repris par plusieurs médias n'est compté qu'une fois
  //       car les articles sont déjà regroupés par événement).
  //   Règles :
  //     - cotation trop ancienne (marché ouvert) → "Analyse insuffisante".
  //     - < 3 signaux disponibles → "Analyse insuffisante".
  //     - ≥ 2 signaux haussiers ET ≥ 2 baissiers avec |somme| ≤ 1 → "incertaine".
  //     - concordance = somme / nombre de signaux disponibles.
  //       ≥ +0,25 → hausse ; ≤ −0,25 → baisse ; sinon neutre.
  //     - confiance : élevée si |concordance| ≥ 0,6, ≥ 5 signaux, données
  //       fraîches, pas d'annonce majeure dans les 2 h ; moyenne si ≥ 0,4 ;
  //       sinon faible. Annonce majeure dans < 2 h → confiance plafonnée à faible
  //       et horizon "réaction immédiate" traité par scénarios conditionnels.
  //   La concordance n'est PAS une probabilité (aucune calibration historique).

  function analyserImpact(entrees) {
    const {
      actif = "XAUUSD", maintenantMs, tendances = {}, cotation, marche = {}, correlations = {},
      actualites = [], annonceProchaine = null, annonceRecente = null,
    } = entrees;

    const favorables = [], contraires = [], neutres = [], manquants = [];
    const signaux = [];
    const ajouter = (nom, valeur, texte) => {
      signaux.push({ nom, valeur });
      if (valeur > 0) favorables.push(texte); else if (valeur < 0) contraires.push(texte); else neutres.push(texte);
    };

    const coteeFraiche = cotation && cotation.fraicheur === "direct";
    const marcheFerme = cotation && cotation.fraicheur === "marché fermé";

    ["30min", "1h", "4h"].forEach((tf) => {
      const t = tendances[tf];
      if (!t || t.etat === "insuffisant" || t.perimee) { manquants.push(`tendance ${LIBELLE_TF[tf]}`); return; }
      const v = t.etat === "haussier" ? 1 : t.etat === "baissier" ? -1 : 0;
      ajouter(tf, v, `Tendance ${LIBELLE_TF[tf]} ${t.etat}`);
    });
    const t1w = tendances["1week"];
    let contexte = null;
    if (t1w && t1w.etat !== "insuffisant") {
      contexte = t1w.etat;
      const v = t1w.etat === "haussier" ? 1 : t1w.etat === "baissier" ? -1 : 0;
      ajouter("1week", v, `Contexte hebdomadaire ${t1w.etat} (contexte, ne prouve pas la réaction à une annonce)`);
    } else manquants.push("tendance 1W");

    [["dollar", "Dollar (DXY)", 0.15, "pct"], ["rendement10ans", "Taux US 10 ans", 3, "bps"]].forEach(([cle, nom, seuil, unite]) => {
      const a = marche[cle];
      const c = correlations[cle];
      if (!a || a.perime || a.variation === null || a.variation === undefined) { manquants.push(`${nom} (donnée absente ou ancienne)`); return; }
      if (!c || Math.abs(c.coefficient) < 0.3) { neutres.push(`${nom} : corrélation récente faible (${c ? c.coefficient : "n/d"}), non comptée`); return; }
      const mouvement = Math.abs(a.variation) >= seuil ? Math.sign(a.variation) : 0;
      const v = mouvement * Math.sign(c.coefficient);
      const fr = (x, d) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d).replace(".", ",")}`;
      const txtVar = unite === "bps" ? `${fr(a.variation, 1)} pb` : `${fr(a.variation, 2)} %`;
      ajouter(cle, v, `${nom} ${txtVar} (corrélation 60 séances ${fr(c.coefficient, 2)})${v === 0 ? " — mouvement trop faible" : ""}`);
    });

    const recentes = actualites.filter((n) => n.statut === "confirmé" && (n.actifs || []).includes("XAUUSD") &&
      n.interpretation && (maintenantMs - Date.parse(n.publie_le)) < 6 * 3600000 && n.importance !== "faible");
    if (recentes.length) {
      const somme = recentes.reduce((s, n) => s + (n.interpretation.direction_or === "haussier" ? 1 : n.interpretation.direction_or === "baissier" ? -1 : 0), 0);
      const v = Math.max(-1, Math.min(1, somme));
      ajouter("actualites", v, `${recentes.length} actualité(s) confirmée(s) < 6 h, interprétation ${v > 0 ? "plutôt haussière" : v < 0 ? "plutôt baissière" : "partagée"} (compté une seule fois)`);
    }
    const nonConfirmees = actualites.filter((n) => n.statut !== "confirmé" && n.importance === "haute" && (n.actifs || []).includes("XAUUSD") && (maintenantMs - Date.parse(n.publie_le)) < 6 * 3600000);
    if (nonConfirmees.length) neutres.push(`${nonConfirmees.length} actualité(s) importante(s) non confirmée(s) : non comptée(s), source d'incertitude`);

    const annonceImminente = annonceProchaine && (Date.parse(annonceProchaine.horodatage_utc) - maintenantMs) < 2 * 3600000;
    const horizon = annonceImminente || (annonceRecente && (maintenantMs - Date.parse(annonceRecente.horodatage_utc)) < 3600000)
      ? "réaction immédiate" : "prochaines heures";

    const base = {
      actif, horizon, contexteFond: contexte, favorables, contraires, neutres, manquants,
      signaux, analyseLe: new Date(maintenantMs).toISOString(),
    };

    if (!cotation || (!coteeFraiche && !marcheFerme)) {
      return { ...base, direction: "analyse insuffisante", confiance: "—", concordance: null,
        raisonInsuffisance: "La cotation de l'or n'est pas à jour : conclusion suspendue tant que le prix actuel n'est pas disponible." };
    }
    const tendancesCourtTerme = signaux.filter((x) => ["30min", "1h", "4h"].includes(x.nom)).length;
    if (tendancesCourtTerme < 2) {
      return { ...base, direction: "analyse insuffisante", confiance: "—", concordance: null,
        raisonInsuffisance: `Tendances court terme indisponibles (${tendancesCourtTerme} sur 3 : bougies non chargées ou anciennes).` };
    }
    if (signaux.length < 3) {
      return { ...base, direction: "analyse insuffisante", confiance: "—", concordance: null,
        raisonInsuffisance: `Seulement ${signaux.length} signal(aux) disponible(s) (3 minimum).` };
    }

    const somme = signaux.reduce((s, x) => s + x.valeur, 0);
    const nbPos = signaux.filter((x) => x.valeur > 0).length;
    const nbNeg = signaux.filter((x) => x.valeur < 0).length;
    const concordance = somme / signaux.length;

    let direction;
    if (nbPos >= 2 && nbNeg >= 2 && Math.abs(somme) <= 1) direction = "incertaine";
    else if (concordance >= 0.25) direction = "hausse";
    else if (concordance <= -0.25) direction = "baisse";
    else direction = "neutre";

    let confiance = "faible";
    if (direction === "hausse" || direction === "baisse") {
      if (Math.abs(concordance) >= 0.6 && signaux.length >= 5 && coteeFraiche && !annonceImminente) confiance = "élevée";
      else if (Math.abs(concordance) >= 0.4) confiance = "moyenne";
      if (annonceImminente || marcheFerme) confiance = "faible";
    }

    // Scénario alternatif + invalidation à partir de niveaux réels (bougies 1 h).
    const t1h = tendances["1h"];
    let alternatif = null, invalidation = null;
    if (direction === "hausse" || direction === "baisse") {
      const inverse = direction === "hausse" ? "baisse" : "hausse";
      alternatif = `Scénario inverse (${inverse}) si les signaux contraires prennent le dessus${contraires.length ? ` : ${contraires.join(" ; ")}` : ""}.`;
      if (t1h && t1h.plusBas10 && t1h.plusHaut10) {
        invalidation = direction === "hausse"
          ? `Clôture 1 h sous ${t1h.plusBas10.toFixed(2)} (plus bas des 10 dernières bougies 1 h) ou retournement baissier de la tendance 4 h.`
          : `Clôture 1 h au-dessus de ${t1h.plusHaut10.toFixed(2)} (plus haut des 10 dernières bougies 1 h) ou retournement haussier de la tendance 4 h.`;
      } else invalidation = "Retournement des tendances 1 h et 4 h.";
    } else if (direction === "neutre") {
      alternatif = "Une sortie franche de la zone récente (bougies 1 h) donnerait une direction ; à surveiller.";
    } else {
      alternatif = "Signaux contradictoires : attendre qu'une majorité claire se dégage.";
    }

    return { ...base, direction, confiance, concordance: Math.round(concordance * 100) / 100, somme,
      nbSignaux: signaux.length, alternatif, invalidation };
  }

  const LIBELLE_TF = { "30min": "30 min", "1h": "1 h", "4h": "4 h", "1week": "1W" };

  const api = {
    lireSignal, nombresDans, versNombre, detecterInstrument,
    calculerPosition, repartirUnites,
    ema, atr, calculerTendance, separerBougies,
    fusionnerCalendriers, ecartResultatPrevision, valeurNumerique,
    scorePriorite, analyserImpact, LIBELLE_TF, LIBELLES_SPEC,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  racine.GoldAI = racine.GoldAI || {};
  racine.GoldAI.noyau = api;
})(typeof window !== "undefined" ? window : globalThis);
