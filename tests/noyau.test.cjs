// Tests automatiques de js/noyau.js — lancer avec :  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../js/noyau.js");

const SIGNAL_EXEMPLE = `Sell XAUUSD

📊 Point d’entrée: 4335

💥 TP1 : 4329
💥 TP2 : 4320
💥 TP3 : 4312
💥 TP OUVERT

🔓 SL : 4339

(J’ouvre quelques swings aussi)⏳`;

const REGLAGES_TEST = {
  solde: 100000, devise: "USD", risqueMode: "pourcentage", risqueValeur: 0.3,
  repartition: [40, 30, 30],
  instruments: { XAUUSD: { tailleContrat: 100, tailleTick: 0.01, valeurTick: 1, deviseProfit: "USD", lotMin: 0.01, lotMax: 100, pasLot: 0.01 } },
};

test("lecture du signal d'exemple", () => {
  const s = N.lireSignal(SIGNAL_EXEMPLE);
  assert.equal(s.instrument, "XAUUSD");
  assert.equal(s.sens, "SELL");
  assert.equal(s.entree, 4335);
  assert.equal(s.sl, 4339);
  assert.deepEqual(s.tps, [{ numero: 1, prix: 4329 }, { numero: 2, prix: 4320 }, { numero: 3, prix: 4312 }]);
  assert.equal(s.tpOuverts, 1);
  assert.deepEqual(s.aPreciser, []);
  assert.deepEqual(s.ambiguites, []);
  assert.ok(s.lignesIgnorees.some((l) => l.includes("swings")));
});

test("cas de test : 0,75 lot, 0,30/0,23/0,22, gains 180/345/506, total 1031, perte 300", () => {
  const s = N.lireSignal(SIGNAL_EXEMPLE);
  const r = N.calculerPosition(s, REGLAGES_TEST, null);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.risqueDemande, 300);
  assert.equal(r.lotTotal, 0.75);
  assert.deepEqual(r.portions.map((p) => p.lot), [0.3, 0.23, 0.22]);
  assert.equal(r.sommeLotsPortions, r.lotTotal);
  assert.deepEqual(r.portions.map((p) => Math.round(p.gainAuTp)), [180, 345, 506]);
  assert.equal(Math.round(r.gainTotalSiTousTps), 1031);
  assert.equal(Math.round(r.perteTotaleSl), 300);
  assert.ok(r.risqueEffectif <= r.risqueDemande + 1e-9);
  assert.deepEqual(r.portions.map((p) => Math.round(p.gainCumuleSiCloturee)), [180, 525, 1031]);
  // TP ouvert : aucune portion inventée
  assert.equal(r.portions.length, 3);
  assert.ok(r.avertissements.some((a) => a.includes("TP ouvert")));
});

test("variantes de formulation (anglais, minuscules, virgule décimale)", () => {
  const s = N.lireSignal("buy gold now\nentry 2 345,50\nstop loss: 2340\ntake profit 1 = 2350\ntp2 2360");
  assert.equal(s.instrument, "XAUUSD");
  assert.equal(s.sens, "BUY");
  assert.equal(s.entree, 2345.5);
  assert.equal(s.sl, 2340);
  assert.deepEqual(s.tps.map((t) => t.prix), [2350, 2360]);
  const s2 = N.lireSignal("EUR/USD SELL @ 1.0850\nSL 1.0880\nTP 1.0800");
  assert.equal(s2.instrument, "EURUSD");
  assert.equal(s2.entree, 1.085);
  assert.deepEqual(s2.tps, [{ numero: 1, prix: 1.08 }]);
});

test("données manquantes et entrées ambiguës signalées, rien d'inventé", () => {
  const s = N.lireSignal("Sell XAUUSD\nEntrée 4335\nEntry 4338\nTP1 4320");
  assert.equal(s.entree, null);
  assert.ok(s.ambiguites.some((a) => a.champ === "entree"));
  assert.ok(s.aPreciser.includes("sl"));
  const r = N.calculerPosition(s, REGLAGES_TEST, null);
  assert.equal(r.ok, false);
});

test("cohérence du sens : SELL avec SL sous l'entrée refusé", () => {
  const s = { instrument: "XAUUSD", sens: "SELL", entree: 4335, sl: 4330, tps: [{ numero: 1, prix: 4320 }], tpOuverts: 0 };
  const r = N.calculerPosition(s, { ...REGLAGES_TEST, repartition: [100] }, null);
  assert.equal(r.ok, false);
  assert.ok(r.erreurs[0].includes("AU-DESSUS"));
  const b = { instrument: "XAUUSD", sens: "BUY", entree: 4335, sl: 4330, tps: [{ numero: 1, prix: 4320 }], tpOuverts: 0 };
  assert.ok(N.calculerPosition(b, { ...REGLAGES_TEST, repartition: [100] }, null).erreurs.some((e) => e.includes("au-dessus")));
});

test("jamais au-dessus du risque demandé (arrondi vers le bas)", () => {
  for (const dist of [3.7, 4.1, 5.55, 7.3, 11.9]) {
    const s = { instrument: "XAUUSD", sens: "BUY", entree: 4000, sl: 4000 - dist, tps: [{ numero: 1, prix: 4010 }, { numero: 2, prix: 4020 }, { numero: 3, prix: 4030 }], tpOuverts: 0 };
    const r = N.calculerPosition(s, REGLAGES_TEST, null);
    assert.equal(r.ok, true);
    assert.ok(r.perteTotaleSl <= r.risqueDemande + 1e-6, `${dist}: ${r.perteTotaleSl} > ${r.risqueDemande}`);
    assert.equal(r.sommeLotsPortions, r.lotTotal);
  }
});

test("lot minimum trop grand : calcul impossible expliqué", () => {
  const s = { instrument: "XAUUSD", sens: "BUY", entree: 4000, sl: 3900, tps: [{ numero: 1, prix: 4010 }, { numero: 2, prix: 4020 }, { numero: 3, prix: 4030 }], tpOuverts: 0 };
  const r = N.calculerPosition(s, { ...REGLAGES_TEST, risqueValeur: 0.01 }, null);
  assert.equal(r.ok, false);
  assert.match(r.erreurs[0], /Impossible/);
});

test("répartition qui ne fait pas 100 % → demande de configuration", () => {
  const s = N.lireSignal(SIGNAL_EXEMPLE);
  const r = N.calculerPosition(s, { ...REGLAGES_TEST, repartition: [40, 30, 20] }, null);
  assert.equal(r.ok, false);
  assert.ok(r.aConfigurer.some((a) => a.includes("90")));
});

test("4 portions configurées + TP ouvert : la 4e portion va au TP ouvert, sans gain inventé", () => {
  const s = N.lireSignal(SIGNAL_EXEMPLE);
  const r = N.calculerPosition(s, { ...REGLAGES_TEST, repartition: [40, 20, 20, 20] }, null);
  assert.equal(r.ok, true);
  assert.equal(r.portions[3].type, "ouvert");
  assert.equal(r.portions[3].gainAuTp, null);
  assert.equal(r.portions[3].prix, null);
  assert.equal(r.sommeLotsPortions, r.lotTotal);
});

test("répartition sur plus de portions que de TP : choix demandé", () => {
  const s = { instrument: "XAUUSD", sens: "SELL", entree: 4335, sl: 4339, tps: [{ numero: 1, prix: 4329 }], tpOuverts: 0 };
  const r = N.calculerPosition(s, REGLAGES_TEST, null);
  assert.equal(r.ok, false);
  assert.equal(r.choixRepartition, true);
});

test("devise différente : conversion exigée, jamais supposée", () => {
  const s = N.lireSignal(SIGNAL_EXEMPLE);
  const reg = { ...REGLAGES_TEST, devise: "CAD" };
  const sans = N.calculerPosition(s, reg, null);
  assert.equal(sans.ok, false);
  assert.ok(sans.aConfigurer[0].includes("USD → CAD"));
  const avec = N.calculerPosition(s, reg, 1.4);
  assert.equal(avec.ok, true);
  assert.ok(avec.perteTotaleSl <= avec.risqueDemande + 1e-6);
});

test("instrument non configuré → demande de configuration", () => {
  const s = N.lireSignal("Buy EURUSD\nEntry 1.08\nSL 1.07\nTP1 1.09");
  const r = N.calculerPosition(s, REGLAGES_TEST, null);
  assert.equal(r.ok, false);
  assert.ok(r.aConfigurer[0].includes("EURUSD"));
});

test("répartition au plus fort reste : somme exacte", () => {
  assert.deepEqual(N.repartirUnites(75, [40, 30, 30]), [30, 23, 22]);
  assert.equal(N.repartirUnites(101, [33.33, 33.33, 33.34]).reduce((a, b) => a + b), 101);
});

test("tendances : série montante → haussier, descendante → baissier, trop courte → insuffisant", () => {
  const mk = (f) => Array.from({ length: 60 }, (_, i) => { const c = f(i); return { debut: i, ouverture: c, haut: c + 1, bas: c - 1, cloture: c }; });
  assert.equal(N.calculerTendance(mk((i) => 100 + i)).etat, "haussier");
  assert.equal(N.calculerTendance(mk((i) => 200 - i)).etat, "baissier");
  assert.equal(N.calculerTendance(mk(() => 100)).etat, "neutre");
  assert.equal(N.calculerTendance(mk((i) => i).slice(0, 10)).etat, "insuffisant");
});

test("bougies en cours / clôturées", () => {
  const h = 3600000;
  const r = N.separerBougies([{ debut: 0 }, { debut: h }, { debut: 2 * h }], h, 2.5 * h);
  assert.equal(r.cloturees.length, 2);
  assert.equal(r.enCours.debut, 2 * h);
});

test("fusion du calendrier : doublons fusionnés, divergences signalées", () => {
  const a = [{ titre: "CPI m/m", devise: "USD", horodatage_utc: "2026-10-14T12:30:00Z", impact: "high", valeurs: [{ prevision: "0.3%", precedent: "0.2%" }] }];
  const b = [{ titre: "CPI m/m", devise: "USD", horodatage_utc: "2026-10-14T12:30:00Z", impact: "high", valeurs: [{ prevision: "0.4%", precedent: "0.2%" }] },
             { titre: "CPI m/m", devise: "EUR", horodatage_utc: "2026-10-14T09:00:00Z", impact: "medium", valeurs: [] }];
  const f = N.fusionnerCalendriers({ "Source A": a, "Source B": b });
  assert.equal(f.length, 2);
  const usd = f.find((e) => e.devise === "USD");
  assert.deepEqual(usd.sources, ["Source A", "Source B"]);
  assert.ok(usd.divergences.some((d) => d.startsWith("prevision")));
  assert.ok(!usd.divergences.some((d) => d.startsWith("precedent")));
});

test("écart résultat − prévision seulement si comparable", () => {
  assert.deepEqual(N.ecartResultatPrevision("0.4%", "0.3%"), { ecart: 0.1, unite: "%" });
  assert.equal(N.ecartResultatPrevision("180K", "0.3%"), null);
  assert.equal(N.ecartResultatPrevision(null, "0.3%"), null);
});

test("impact probable : données anciennes → analyse insuffisante ; concordance ≠ probabilité", () => {
  const t = (etat) => ({ etat, plusBas10: 4300, plusHaut10: 4350 });
  const base = { maintenantMs: Date.parse("2026-09-25T12:00:00Z"), tendances: { "30min": t("haussier"), "1h": t("haussier"), "4h": t("haussier"), "1week": t("haussier") },
    marche: { dollar: { variation: -0.4 }, rendement10ans: { variation: -5 } }, correlations: { dollar: { coefficient: -0.6 }, rendement10ans: { coefficient: -0.37 } } };
  const ancien = N.analyserImpact({ ...base, cotation: { fraicheur: "ancien" } });
  assert.equal(ancien.direction, "analyse insuffisante");
  const frais = N.analyserImpact({ ...base, cotation: { fraicheur: "direct" } });
  assert.equal(frais.direction, "hausse");
  assert.equal(frais.confiance, "élevée");
  assert.equal(frais.concordance, 1);
  const imminent = N.analyserImpact({ ...base, cotation: { fraicheur: "direct" }, annonceProchaine: { horodatage_utc: "2026-09-25T13:00:00Z" } });
  assert.equal(imminent.horizon, "réaction immédiate");
  assert.equal(imminent.confiance, "faible");
  const contradictoire = N.analyserImpact({ ...base, cotation: { fraicheur: "direct" },
    tendances: { "30min": t("haussier"), "1h": t("haussier"), "4h": t("baissier"), "1week": t("baissier") }, marche: {} });
  assert.equal(contradictoire.direction, "incertaine");
});

test("actualités : un même événement ne compte qu'une fois (plafond ±1)", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const news = Array.from({ length: 5 }, () => ({ statut: "confirmé", actifs: ["XAUUSD"], importance: "haute", publie_le: "2026-09-25T11:00:00Z", interpretation: { direction_or: "haussier" } }));
  const r = N.analyserImpact({ maintenantMs: now, cotation: { fraicheur: "direct" }, tendances: { "30min": { etat: "neutre" }, "1h": { etat: "neutre" }, "4h": { etat: "neutre" } }, actualites: news });
  assert.equal(r.signaux.find((s) => s.nom === "actualites").valeur, 1);
});

test("priorité : annonce USD forte imminente avant annonce faible", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const fort = N.scorePriorite({ type: "annonce", importance: "high", devise: "USD", horodatage_utc: "2026-09-25T12:30:00Z" }, now);
  const faible = N.scorePriorite({ type: "annonce", importance: "low", devise: "JPY", horodatage_utc: "2026-09-25T12:30:00Z" }, now);
  assert.ok(fort.score > faible.score);
  assert.ok(fort.raisons.includes("concerne le dollar"));
});

test("impact : sans tendances court terme → analyse insuffisante (même avec d'autres signaux)", () => {
  const r = N.analyserImpact({ maintenantMs: Date.parse("2026-09-25T12:00:00Z"), cotation: { fraicheur: "direct" },
    tendances: {}, marche: { dollar: { variation: -0.1 }, rendement10ans: { variation: 5 } },
    correlations: { dollar: { coefficient: -0.6 }, rendement10ans: { coefficient: -0.37 } } });
  assert.equal(r.direction, "analyse insuffisante");
});

test("SL du runner : par défaut un cran derrière le dernier TP touché", () => {
  const s = N.lireSignal(SIGNAL_EXEMPLE); // SELL 4335, TP 4329/4320/4312, SL 4339
  const plan = N.planSlRunner(s, null);
  assert.deepEqual(plan.map((p) => p.sl), [4335, 4329, 4320]);
  assert.ok(plan.every((p) => p.bouge));
});

test("SL du runner : breakeven seulement après TP2, puis TP1", () => {
  const s = N.lireSignal(SIGNAL_EXEMPLE);
  const plan = N.planSlRunner(s, ["garder", "entree", "tp1"]);
  assert.deepEqual(plan.map((p) => p.sl), [4339, 4335, 4329]);
  assert.deepEqual(plan.map((p) => p.bouge), [false, true, true]);
});

test("SL du runner : ne recule jamais et n'utilise pas un TP pas encore touché", () => {
  const s = N.lireSignal(SIGNAL_EXEMPLE);
  const plan = N.planSlRunner(s, ["entree", "entree", "tp3"]);
  assert.deepEqual(plan.map((p) => p.sl), [4335, 4335, 4335]);
  const achat = { sens: "BUY", entree: 100, sl: 95, tps: [{ numero: 1, prix: 105 }, { numero: 2, prix: 110 }] };
  assert.deepEqual(N.planSlRunner(achat, null).map((p) => p.sl), [100, 105]);
});

test("biais d'une annonce pour l'or (badge)", () => {
  const cpi = { or_affecte: true, si_superieur: { direction: "baisse", court: "Fed reste ferme" }, si_inferieur: { direction: "hausse", court: "Fed peut baisser ses taux" } };
  const ev = (valeurs, devise = "USD") => ({ devise, valeurs: [valeurs] });
  // Résultat publié plus fort que prévu → baissier, ligne "Plus fort que prévu".
  let b = N.biaisAnnonceOr(ev({ prevision: "0.3%", precedent: "0.2%", resultat: "0.5%" }), cpi);
  assert.equal(b.biais, "baissier");
  assert.equal(b.base, "resultat");
  assert.equal(b.ligne, "Plus fort que prévu → Fed reste ferme");
  // Pas de résultat : prévision vs précédent.
  b = N.biaisAnnonceOr(ev({ prevision: "0.1%", precedent: "0.2%", resultat: null }), cpi);
  assert.equal(b.biais, "haussier");
  assert.equal(b.base, "prevision");
  // Égalité → neutre ; hors dollar → neutre ; pas de fiche → neutre ; unités différentes → neutre.
  assert.equal(N.biaisAnnonceOr(ev({ prevision: "0.3%", precedent: "0.3%" }), cpi).biais, "neutre");
  assert.equal(N.biaisAnnonceOr(ev({ prevision: "0.4%", precedent: "0.3%" }, "EUR"), cpi).biais, "neutre");
  assert.equal(N.biaisAnnonceOr(ev({ prevision: "0.4%", precedent: "0.3%" }), null).biais, "neutre");
  assert.equal(N.biaisAnnonceOr(ev({ prevision: "98K", precedent: "0.3%" }), cpi).biais, "neutre");
});

test("garde-fou du jour", () => {
  const t = (resultat, frais = 0) => ({ resultat, frais });
  const regles = { maxTrades: 3, pertesArret: 2, seuilGain: 1000 };
  // Journée normale.
  let g = N.evaluerGardeFou({ trades: [t(200)], regles, limitePerte: 1000 });
  assert.equal(g.niveau, "ok");
  assert.equal(g.resteAvantLimite, 1000);
  // 2 trades sur 3 → attention ; 3 sur 3 → bloqué.
  assert.equal(N.evaluerGardeFou({ trades: [t(100), t(50)], regles }).niveau, "attention");
  assert.equal(N.evaluerGardeFou({ trades: [t(100), t(50), t(20)], regles }).niveau, "bloque");
  // 2 pertes → bloqué, même avec des trades restants.
  g = N.evaluerGardeFou({ trades: [t(-100), t(-50)], regles: { pertesArret: 2 } });
  assert.equal(g.niveau, "bloque");
  assert.equal(g.alertes[0].cle, "pertes");
  // Frais comptés : +5 de résultat avec 7 de frais = une perte.
  assert.equal(N.evaluerGardeFou({ trades: [t(5, 7)], regles: { pertesArret: 1 } }).niveau, "bloque");
  // Objectif de gain atteint → bloqué.
  assert.equal(N.evaluerGardeFou({ trades: [t(1200)], regles }).alertes[0].cle, "gain");
  // Limite de perte : 70 % → attention, 100 % → bloqué, reste calculé.
  g = N.evaluerGardeFou({ trades: [t(-450)], limitePerte: 1000 });
  assert.equal(g.niveau, "ok");
  assert.equal(g.resteAvantLimite, 550);
  assert.equal(N.evaluerGardeFou({ trades: [t(-750)], limitePerte: 1000 }).niveau, "attention");
  assert.equal(N.evaluerGardeFou({ trades: [t(-1000)], limitePerte: 1000 }).niveau, "bloque");
  // Aucune règle : jamais bloqué.
  g = N.evaluerGardeFou({ trades: [t(-5000), t(-1), t(-1), t(-1)] });
  assert.equal(g.niveau, "ok");
  assert.equal(g.aucuneRegle, true);
});

test("objectif de profit : périodes, frais, compte", () => {
  assert.equal(N.debutPeriode("2026-09-30", "jour"), "2026-09-30");
  assert.equal(N.debutPeriode("2026-09-30", "semaine"), "2026-09-28"); // mercredi → lundi
  assert.equal(N.debutPeriode("2026-09-28", "semaine"), "2026-09-28"); // lundi
  assert.equal(N.debutPeriode("2026-10-04", "semaine"), "2026-09-28"); // dimanche → lundi précédent
  assert.equal(N.debutPeriode("2026-09-30", "mois"), "2026-09-01");
  const trades = [
    { date: "2026-09-30", resultat: 80, frais: 20, compteTradingId: "a" },
    { date: "2026-09-29", resultat: 50, frais: 0, compteTradingId: "b" },
    { date: "2026-09-10", resultat: 200, frais: 0, compteTradingId: "a" },
    { date: "2026-08-31", resultat: 999, frais: 0, compteTradingId: "a" },
  ];
  let p = N.progressionObjectif(trades, null, "2026-09-30"); // défaut : 150 $ / jour
  assert.equal(p.realise, 60);
  assert.equal(p.montant, 150);
  assert.equal(p.atteint, false);
  assert.equal(Math.round(p.pourcentage), 40);
  assert.equal(N.progressionObjectif(trades, { montant: 100, periode: "semaine" }, "2026-09-30").realise, 110);
  p = N.progressionObjectif(trades, { montant: 250, periode: "mois", compteId: "a" }, "2026-09-30");
  assert.equal(p.realise, 260);
  assert.equal(p.atteint, true);
  assert.equal(p.pourcentage, 100);
  assert.equal(N.progressionObjectif([{ date: "2026-09-30", resultat: -40 }], null, "2026-09-30").pourcentage, 0);
});

test("prochaine annonce à impact élevé du jour", () => {
  const jourDe = (ms) => new Date(ms).toISOString().slice(0, 10); // fuseau UTC pour le test
  const maintenant = Date.parse("2026-09-30T12:00:00Z");
  const evs = [
    { id: "passee", impact: "high", horodatage_utc: "2026-09-30T11:00:00Z" },
    { id: "moyenne", impact: "medium", horodatage_utc: "2026-09-30T12:30:00Z" },
    { id: "b", impact: "high", horodatage_utc: "2026-09-30T18:00:00Z" },
    { id: "a", impact: "high", horodatage_utc: "2026-09-30T14:00:00Z" },
    { id: "demain", impact: "high", horodatage_utc: "2026-10-01T08:00:00Z" },
  ];
  assert.equal(N.prochaineAnnonceDuJour(evs, maintenant, jourDe).e.id, "a");
  assert.equal(N.prochaineAnnonceDuJour(evs, Date.parse("2026-09-30T19:00:00Z"), jourDe), null);
});

test("trade en cours : TP touchés, SL qui suit le plan, gain estimé", () => {
  const trade = {
    sens: "SELL", entree: 4335, sl: 4339,
    tps: [{ numero: 1, prix: 4329 }, { numero: 2, prix: 4320 }],
    plan: [{ apres: "TP1", sl: 4335 }, { apres: "TP2", sl: 4329 }],
    portions: [{ objectif: "TP1", type: "tp", prix: 4329, lot: 1 }, { objectif: "TP2", type: "tp", prix: 4320, lot: 1 }, { objectif: "TP ouvert", type: "ouvert", prix: null, lot: 1 }],
    valeurPoint: 100, touches: [], slTouche: false,
  };
  assert.equal(N.slCourant(trade), 4339);
  assert.equal(N.pnlEstime(trade, 4333), 600); // 3 lots × 2 points × 100
  // Le prix descend à 4328 : TP1 touché, SL → entrée.
  let r = N.evaluerTouches(trade, 4334, 4328);
  assert.deepEqual(r.nouveauxTps, ["TP1"]);
  assert.equal(r.slTouche, false);
  assert.equal(r.slApres, 4335);
  assert.equal(r.trade.statut, "ouvert");
  // Gain estimé à 4330 : TP1 fermé à 4329 (+600), 2 lots à 4330 (+1000).
  assert.equal(N.pnlEstime(r.trade, 4330), 1600);
  // Remontée à 4335 : SL (breakeven) touché.
  r = N.evaluerTouches(r.trade, 4335, 4331);
  assert.equal(r.slTouche, true);
  assert.equal(r.trade.statut, "sl");
  // Pas de runner : tous les TP touchés → terminé.
  const sansRunner = { ...trade, portions: trade.portions.slice(0, 2) };
  assert.equal(N.evaluerTouches(sansRunner, 4330, 4319).trade.statut, "termine");
  // Achat : sens inversé.
  const achat = { ...trade, sens: "BUY", entree: 4300, sl: 4295, tps: [{ numero: 1, prix: 4310 }], plan: [{ apres: "TP1", sl: 4300 }], touches: [] };
  assert.deepEqual(N.evaluerTouches(achat, 4311, 4299).nouveauxTps, ["TP1"]);
  assert.equal(N.evaluerTouches(achat, 4305, 4294).slTouche, true);
});

test("situation d'un compte : solde automatique avec un seul compte", () => {
  const compte = { id: "c1", taille: 100000, soldeActuel: 99000, dateActivation: "2026-09-01" };
  const trades = [
    { date: "2026-08-30", resultat: 500, frais: 0, compteTradingId: null },   // avant activation
    { date: "2026-09-10", resultat: 300, frais: 10, compteTradingId: null },
    { date: "2026-09-28", resultat: -450, frais: 0, compteTradingId: null },
    { date: "2026-09-28", resultat: 100, frais: 0, compteTradingId: "autre" }, // autre compte
  ];
  let s = N.situationCompte(compte, 1, trades, "2026-09-28");
  assert.equal(s.auto, true);
  assert.equal(s.solde, 100000 + 290 - 450);
  assert.equal(s.resultatAujourdhui, -450);
  // Plusieurs comptes : seulement les trades liés, solde saisi.
  s = N.situationCompte(compte, 2, trades, "2026-09-28");
  assert.equal(s.auto, false);
  assert.equal(s.solde, 99000);
  assert.equal(s.resultatAujourdhui, 0);
});

test("alertes de prix : prix unique et zone touchés par une mèche", () => {
  const prix = { bas: 2650, haut: 2650 };
  assert.equal(N.alerteTouchee(prix, 2651, 2645), true);   // passe à travers
  assert.equal(N.alerteTouchee(prix, 2650, 2640), true);   // mèche pile au niveau
  assert.equal(N.alerteTouchee(prix, 2649.9, 2640), false);
  const zone = { bas: 2660, haut: 2670 };
  assert.equal(N.alerteTouchee(zone, 2661, 2655), true);   // entre par le bas
  assert.equal(N.alerteTouchee(zone, 2680, 2671), false);  // reste au-dessus
  assert.equal(N.alerteTouchee(zone, 2665, 2664), true);   // déjà dedans
  assert.deepEqual(N.distanceAlerte(zone, 2675), { distance: 5, position: "dessus" });
  assert.deepEqual(N.distanceAlerte(zone, 2650), { distance: 10, position: "dessous" });
  assert.equal(N.distanceAlerte(zone, 2662).position, "dedans");
});

test("arrêt après le premier trade gagnant : profit net > 0 $ seulement", () => {
  assert.equal(N.aUnTradeGagnant([]), false);
  assert.equal(N.aUnTradeGagnant([{ resultat: -120 }, { resultat: 0 }]), false);
  assert.equal(N.aUnTradeGagnant([{ resultat: -120 }, { resultat: 0.5 }]), true);   // peu importe le montant
  assert.equal(N.aUnTradeGagnant([{ resultat: 5, frais: 7 }]), false);               // net négatif après frais
  assert.equal(N.aUnTradeGagnant([{ resultat: null }, { resultat: "" }]), false);    // pas encore de résultat
  assert.equal(N.aUnTradeGagnant([{ resultat: "250" }]), true);
});

test("challenge prop firm : perte max fixe / suiveuse et objectif (exemple Top One 100k)", () => {
  // Capture Top One : départ 100 001, perte max 6 000,06, solde 98 492,74.
  const fixe = N.etatChallenge({ depart: 100001, perteMax: 6000.06, objectif: 5000.05 }, 98492.74);
  assert.equal(fixe.perte.perdu, 1508.26);
  assert.equal(fixe.perte.niveau, 94000.94);
  assert.equal(fixe.objectif.profit, -1508.26);
  assert.equal(fixe.objectif.niveau, 105001.05);
  assert.equal(fixe.objectif.restant, 6508.31);
  // Suiveuse : monte avec le plus haut, bloquée au départ.
  const s1 = N.etatChallenge({ depart: 100000, perteMax: 5000, suiveuse: true, plusHaut: 102000 }, 101000);
  assert.equal(s1.perte.niveau, 97000);
  assert.equal(s1.perte.perdu, 1000);
  const s2 = N.etatChallenge({ depart: 100000, perteMax: 5000, suiveuse: true, plusHaut: 108000 }, 107000);
  assert.equal(s2.perte.niveau, 100000); // bloqué au départ
  assert.equal(N.etatChallenge({ depart: 0 }, 100), null);
});

test("garde-fou : un signal copié sur 2 comptes compte pour 1 trade", () => {
  const imp = (compte, min, resultat) => ({ resultat, instrument: "XAUUSD", sens: "sell", compteTl: compte, ouvertLe: `2026-09-28T14:0${min}:00Z` });
  const trades = [imp("live|2", 0, 120), imp("live|3", 1, 118), imp("live|2", 5, -60), imp("live|3", 5, -61), { resultat: 40 }];
  assert.equal(N.regrouperSignaux(trades).length, 3);          // 2 signaux copiés + 1 trade à la main
  const g = N.evaluerGardeFou({ trades, regles: { maxTrades: 3, pertesArret: 2 } });
  assert.equal(g.nb, 3);
  assert.equal(g.pertes, 1);                                    // la perte copiée sur 2 comptes = 1 perte
  assert.equal(g.niveau, "bloque");                             // 3 sur 3
});

test("garde-fou : trade ressaisi à la main sur l'autre compte = même signal (29/09 : 1 trade, pas 2)", () => {
  const imp = { date: "2026-09-29", resultat: 23.75, instrument: "XAUUSD", sens: "buy", compteTl: "demo|2501722", ouvertLe: "2026-09-29T07:16:37Z" };
  const main = { date: "2026-09-29", resultat: 179, instrument: "XAUUSD", compteTl: "demo|2501723" };
  assert.equal(N.regrouperSignaux([imp, main]).length, 1);
  assert.equal(N.evaluerGardeFou({ trades: [imp, main], regles: { maxTrades: 2 } }).nb, 1);
  // Sur le MÊME compte : deux trades distincts.
  assert.equal(N.regrouperSignaux([imp, { ...main, compteTl: "demo|2501722" }]).length, 2);
  // Sans compte : un trade à part.
  assert.equal(N.regrouperSignaux([imp, { ...main, compteTl: null }]).length, 2);
});

test("objectif sur le compte maître seulement", () => {
  const trades = [
    { date: "2026-09-29", resultat: 23.75, compteTl: "demo|1" },
    { date: "2026-09-29", resultat: 179, compteTl: "demo|2" },
  ];
  const p = N.progressionObjectif(trades, { montant: 150, periode: "jour", compteTl: "demo|2" }, "2026-09-29");
  assert.equal(p.realise, 179);
  assert.equal(p.atteint, true);
  assert.equal(N.progressionObjectif(trades, { montant: 150, periode: "jour", compteTl: "demo|1" }, "2026-09-29").atteint, false);
});

test("ESS : exemples officiels Top One Trader", () => {
  const jours = (liste) => liste.map((r, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, resultat: r }));
  // 400 / -350 / total 3750 → 20 % pile → qualifié
  let e = N.calculerEss(jours([400, -350, 390, 380, 370, 360, 350, 340, 330, 320, 310, 300, 250]), 20);
  assert.equal(e.total, 3750);
  assert.equal(e.maxGain, 400);
  assert.equal(e.maxPerte, 350);
  assert.equal(Math.round(e.ess * 100) / 100, 20);
  assert.equal(e.eligible, true);
  assert.equal(e.marge, 0);
  // 1200 / -800 / total 11000 → 18,18 %
  e = N.calculerEss(jours([1200, -800, 1100, 1100, 1100, 1100, 1100, 1100, 1100, 1100, 1100, 700]), 20);
  assert.equal(e.total, 11000);
  assert.equal(Math.round(e.ess * 100) / 100, 18.18);
  assert.equal(e.eligible, true);
  assert.equal(e.requis, 10000);
  assert.equal(e.marge, 1000);
  // Au-dessus : 1000 / -500 / total 5000 → 30 %, il faut 7500 → manque 2500
  e = N.calculerEss(jours([1000, -500, 900, 900, 900, 900, 900]), 20);
  assert.equal(e.ess, 30);
  assert.equal(e.eligible, false);
  assert.equal(e.manque, 2500);
  // Plusieurs trades le même jour = une journée
  e = N.calculerEss([{ date: "2026-09-01", resultat: 300 }, { date: "2026-09-01", resultat: -100, frais: 10 }, { date: "2026-09-02", resultat: 810 }], 20);
  assert.equal(e.maxGain, 810);
  assert.equal(e.nbJours, 2);
  // Pas de bénéfice : non calculable
  assert.equal(N.calculerEss([{ date: "2026-09-01", resultat: -50 }], 20).calculable, false);
});
