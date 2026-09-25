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
