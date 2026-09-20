// Gold AI — Comptes de trading (Profil > Mes comptes), utilisé aussi par le
// journal (lier un trade à un compte) et Performance (filtrer par compte).
//
// Calcule automatiquement, pour chaque compte :
// - Daily Loss Limit ($) = taille du compte × son % de perte quotidienne max
// - Perte déjà prise aujourd'hui sur ce compte (somme des trades du jour liés à ce compte)
// - Marge restante avant la Daily Loss Limit
// - Seuil de Max Drawdown ($) = taille × (1 − % de drawdown max)
// - Marge restante avant le Max Drawdown (solde actuel − seuil)
(() => {
  let cacheComptes = null;

  function client() {
    return window.GoldAI.auth.client;
  }

  function token() {
    return window.GoldAI.auth.getToken();
  }

  function gererErreur(error) {
    if (error?.message === "SESSION_INVALIDE") {
      window.GoldAI.auth.forcerDeconnexion("Ta session a expiré, reconnecte-toi.");
      return true;
    }
    if (error) {
      alert("Impossible de contacter le serveur pour l'instant. Vérifie ta connexion et réessaie.");
      return true;
    }
    return false;
  }

  function formaterDollars(valeur) {
    const signe = valeur < 0 ? "-" : "";
    return `${signe}$${Math.abs(valeur).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  async function chargerComptes(forcerRechargement = false) {
    if (cacheComptes && !forcerRechargement) return cacheComptes;

    const { data, error } = await client().rpc("lister_mes_comptes_trading", { p_token: token() });
    if (gererErreur(error)) return [];

    cacheComptes = (data || []).map((c) => ({
      id: c.id,
      nom: c.nom,
      taille: Number(c.taille),
      soldeActuel: Number(c.solde_actuel),
      statut: c.statut,
      dateActivation: c.date_activation,
      limitePerteQuotidiennePct: Number(c.limite_perte_quotidienne_pct),
      limiteDrawdownMaxPct: Number(c.limite_drawdown_max_pct),
    }));
    return cacheComptes;
  }

  function viderCache() {
    cacheComptes = null;
  }

  // Calcule les limites d'un compte. `perteAujourdhui` est la somme (négative,
  // ou 0) des trades du jour déjà liés à ce compte — à fournir par l'appelant
  // (journal-performance.js / profil-comptes.js ont accès aux trades).
  function calculerLimites(compte, perteAujourdhui) {
    const dailyLossLimit = compte.taille * (compte.limitePerteQuotidiennePct / 100);
    const perteAbsolueAujourdhui = Math.abs(Math.min(0, perteAujourdhui || 0));
    const margeAvantDLL = Math.max(0, dailyLossLimit - perteAbsolueAujourdhui);

    const seuilMaxDrawdown = compte.taille * (1 - compte.limiteDrawdownMaxPct / 100);
    const margeAvantMaxDD = Math.max(0, compte.soldeActuel - seuilMaxDrawdown);

    return {
      dailyLossLimit,
      perteAbsolueAujourdhui,
      margeAvantDLL,
      seuilMaxDrawdown,
      margeAvantMaxDD,
    };
  }

  async function creerCompte(champs) {
    const { data, error } = await client().rpc("creer_compte_trading", {
      p_token: token(),
      p_nom: champs.nom,
      p_taille: champs.taille,
      p_solde_actuel: champs.soldeActuel,
      p_statut: champs.statut,
      p_date_activation: champs.dateActivation || null,
      p_limite_perte_quotidienne_pct: champs.limitePerteQuotidiennePct ?? 5,
      p_limite_drawdown_max_pct: champs.limiteDrawdownMaxPct ?? 10,
    });
    if (gererErreur(error)) return null;
    await chargerComptes(true);
    return data;
  }

  async function modifierCompte(id, champs) {
    const { error } = await client().rpc("modifier_compte_trading", {
      p_token: token(),
      p_id: id,
      p_nom: champs.nom,
      p_taille: champs.taille,
      p_solde_actuel: champs.soldeActuel,
      p_statut: champs.statut,
      p_date_activation: champs.dateActivation || null,
      p_limite_perte_quotidienne_pct: champs.limitePerteQuotidiennePct ?? 5,
      p_limite_drawdown_max_pct: champs.limiteDrawdownMaxPct ?? 10,
    });
    if (gererErreur(error)) return false;
    await chargerComptes(true);
    return true;
  }

  async function supprimerCompte(id) {
    const { error } = await client().rpc("supprimer_compte_trading", { p_token: token(), p_id: id });
    if (gererErreur(error)) return false;
    await chargerComptes(true);
    return true;
  }

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.comptesTrading = {
    chargerComptes,
    viderCache,
    calculerLimites,
    creerCompte,
    modifierCompte,
    supprimerCompte,
    formaterDollars,
  };
})();
