// Gold AI — TEMPORAIRE : trades de test pour essayer Calendrier et Performance.
//
// Deux carrés dans le Journal :
//  - « Remplir (test) » : ajoute ~1 mois de faux trades (jours ouvrés, jusqu'à
//    hier — jamais aujourd'hui, pour ne pas déclencher le garde-fou du jour),
//    tous avec une note qui commence par « [TEST] », sans compte de trading.
//  - « Effacer le test » : supprime tous les trades dont la note commence par « [TEST] ».
// À retirer (ce fichier + les 2 carrés d'index.html) quand les tests sont finis.
(() => {
  const MARQUE = "[TEST]";
  const $ = (id) => document.getElementById(id);
  const client = () => window.GoldAI.auth.client;
  const token = () => window.GoldAI.auth.getToken();

  // Hasard reproductible : le même « mois de test » à chaque remplissage.
  function hasard(graine) {
    let s = graine;
    return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  }

  const cle = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function genererTrades() {
    const r = hasard(20260928);
    const trades = [];
    for (let j = 35; j >= 1; j--) {
      const d = new Date();
      d.setDate(d.getDate() - j);
      if (d.getDay() === 0 || d.getDay() === 6) continue; // pas le week-end
      const nb = [0, 1, 1, 2, 2, 3][Math.floor(r() * 6)];
      for (let k = 0; k < nb; k++) {
        const gagnant = r() < 0.56;
        const sens = r() < 0.5 ? "Achat" : "Vente";
        const entree = Math.round((4050 + r() * 150) * 100) / 100;
        const risque = 3 + r() * 5;                        // distance du SL en $
        const rr = gagnant ? Math.round((1 + r() * 2.5) * 10) / 10 : -1;
        const resultat = Math.round((gagnant ? 60 + r() * 260 : -(40 + r() * 140)) * 100) / 100;
        const mouvement = rr * risque * (sens === "Achat" ? 1 : -1);
        trades.push({
          date: cle(d), resultat, frais: Math.round(r() * 7 * 100) / 100,
          prixEntree: entree, prixSortie: Math.round((entree + mouvement) * 100) / 100, rr,
          note: `${MARQUE} ${sens} XAUUSD — trade fictif pour tester le journal`,
        });
      }
    }
    return trades;
  }

  function etat(texte) {
    const z = $("etat-trades-test");
    if (z) z.textContent = texte;
  }

  async function rafraichirJournal() {
    await window.GoldAI.journal.chargerTousLesTrades(true);
    window.dispatchEvent(new CustomEvent("goldai:trades"));
  }

  async function mesTradesTest() {
    const { data, error } = await client().rpc("lister_mes_trades", { p_token: token() });
    if (error) throw error;
    return (data || []).filter((t) => (t.note || "").startsWith(MARQUE));
  }

  // Envoie les requêtes par groupes de 5 en parallèle (plus rapide, sans surcharger le serveur).
  async function parGroupes(liste, action, progression) {
    let faits = 0;
    for (let i = 0; i < liste.length; i += 5) {
      await Promise.all(liste.slice(i, i + 5).map(async (x) => { await action(x); progression(++faits, liste.length); }));
    }
    return faits;
  }

  let occupe = false;
  async function remplir() {
    if (occupe) return;
    occupe = true;
    try {
      if ((await mesTradesTest()).length) { etat("Des trades de test sont déjà là : efface-les d'abord."); return; }
      const trades = genererTrades();
      const faits = await parGroupes(trades, async (t) => {
        let { error } = await client().rpc("enregistrer_mon_trade", {
          p_token: token(), p_trade_id: null, p_date: t.date, p_resultat: t.resultat, p_note: t.note,
          p_compte_trading_id: null, p_instrument: "XAUUSD", p_frais: t.frais,
          p_prix_entree: t.prixEntree, p_prix_sortie: t.prixSortie, p_rr: t.rr,
        });
        if (error && (error.code === "PGRST202" || /could not find the function/i.test(error.message || ""))) {
          ({ error } = await client().rpc("ajouter_mon_trade", {
            p_token: token(), p_date: t.date, p_resultat: t.resultat, p_note: t.note,
            p_compte_trading_id: null, p_instrument: "XAUUSD", p_frais: t.frais,
          }));
        }
        if (error) throw error;
      }, (n, total) => etat(`Ajout… ${n} / ${total}`));
      await rafraichirJournal();
      etat(`✓ ${faits} trades de test ajoutés. Ouvre Calendrier ou Performance.`);
    } catch (e) {
      etat(`Erreur : ${e.message || e}`);
    } finally { occupe = false; }
  }

  async function effacer() {
    if (occupe) return;
    occupe = true;
    try {
      const liste = await mesTradesTest();
      if (!liste.length) { etat("Aucun trade de test à effacer."); return; }
      const faits = await parGroupes(liste, async (t) => {
        const { error } = await client().rpc("supprimer_mon_trade", { p_token: token(), p_trade_id: t.id });
        if (error) throw error;
      }, (n, total) => etat(`Suppression… ${n} / ${total}`));
      await rafraichirJournal();
      etat(`✓ ${faits} trades de test effacés.`);
    } catch (e) {
      etat(`Erreur : ${e.message || e}`);
    } finally { occupe = false; }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("bouton-remplir-test")?.addEventListener("click", remplir);
    $("bouton-effacer-test")?.addEventListener("click", effacer);
  });
})();
