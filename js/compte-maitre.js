// Gold AI — compte maître lu en direct dans TradeLocker (fonction Supabase « tradelocker »,
// action « maitre ») : solde, résultat du jour (frais compris), fiche de l'instrument.
//
// Utilisé par le calculateur (risque sur le vrai solde, objectif restant, lots du courtier),
// la barre d'objectif et le garde-fou. Lu au plus une fois par minute ; si TradeLocker ne
// répond pas (maintenance, réseau), tout le monde reprend le Journal et les réglages manuels.
(() => {
  const N = window.GoldAI.noyau;
  const DUREE_CACHE_MS = 60000;
  const DELAI_MAX_MS = 10000;

  let cache = null;    // { cle, symbole, quand, data, erreur }
  let enCours = null;

  function demander(cle, symbole) {
    if (enCours) return enCours;
    enCours = (async () => {
      let data = null, erreur = null;
      try {
        const appel = window.GoldAI.auth.client.functions.invoke("tradelocker", { body: { token: window.GoldAI.auth.getToken(), action: "maitre", cle, symbole } });
        const delai = new Promise((_, rejeter) => setTimeout(() => rejeter(new Error("délai dépassé")), DELAI_MAX_MS));
        const r = await Promise.race([appel, delai]);
        if (r?.data && !r.data.erreur) data = r.data;
        else erreur = r?.data?.erreur || "TradeLocker ne répond pas pour l'instant.";
      } catch (e) {
        // Réponse d'erreur de la fonction : le message est dans le corps.
        try { erreur = (await e?.context?.json?.())?.erreur; } catch { /* ignoré */ }
        erreur = erreur || "TradeLocker ne répond pas pour l'instant.";
      }
      cache = { cle, symbole, quand: Date.now(), data, erreur };
      if (data) window.dispatchEvent(new CustomEvent("goldai:compte-maitre"));
      return data;
    })().finally(() => { enCours = null; });
    return enCours;
  }

  /**
   * État TradeLocker du compte maître (null si indisponible).
   * attendre:false → renvoie tout de suite ce qui est en mémoire et lance la lecture
   * en arrière-plan (événement « goldai:compte-maitre » quand elle arrive).
   */
  async function lire(cle, symbole = "XAUUSD", { attendre = true } = {}) {
    if (!cle || !window.GoldAI.auth?.getToken?.()) return null;
    const meme = cache && cache.cle === cle && cache.symbole === symbole;
    if (meme && Date.now() - cache.quand < DUREE_CACHE_MS) return cache.data;
    const p = demander(cle, symbole);
    return attendre ? p : (meme ? cache.data : null);
  }

  // Progression de l'objectif (barre du haut, calculateur, garde-fou) : objectif « par jour »
  // → résultat du jour de TradeLocker (frais compris) s'il est connu, sinon le Journal.
  function progression(trades, reglages, aujourdhui, etat) {
    const p = N.progressionObjectif(trades, { ...(reglages.objectif || {}), compteId: "", compteTl: reglages.compteMaitre }, aujourdhui);
    const jourNet = Number(etat?.jourNet);
    if ((p.periode || "jour") !== "jour" || etat?.jourNet === null || etat?.jourNet === undefined || !Number.isFinite(jourNet)) return { ...p, source: "journal" };
    const realise = Math.round(jourNet * 100) / 100;
    return { ...p, realise, pourcentage: Math.max(0, Math.min(100, (realise / p.montant) * 100)), atteint: realise >= p.montant, source: "tradelocker" };
  }

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.compteMaitre = {
    lire, progression,
    derniereErreur: () => cache?.erreur || null,
    oublier: () => { cache = null; },
  };
})();
