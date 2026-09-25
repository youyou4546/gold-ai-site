// BANC D'ESSAI LOCAL UNIQUEMENT — remplace la bibliothèque Supabase par une
// base factice stockée dans le navigateur (localStorage "banc_*"), pour tester
// l'interface sans toucher à la vraie base. Jamais chargé par index.html.
//
// Options (à régler dans la console du navigateur, puis recharger) :
//   localStorage.banc_cle_td = "<clé Twelve Data>"     → cotations réelles
//   localStorage.banc_echec_suppression = "1"          → simule un refus serveur
//   localStorage.banc_patch_absent = "1"               → simule le patch SQL non installé
(() => {
  const lire = (cle, defaut) => { try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch { return defaut; } };
  const ecrire = (cle, v) => localStorage.setItem(cle, JSON.stringify(v));
  const absent = () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function (banc d'essai)" } });
  const FONCTIONS_PATCH = ["obtenir_parametres_calculateur", "sauvegarder_parametres_calculateur", "lire_donnees", "obtenir_cle_cotations", "enregistrer_analyse", "lister_mes_analyses"];

  const rpcs = {
    nom_depuis_session: () => "Testeur",
    lister_mes_trades: () => lire("banc_trades", []),
    ajouter_mon_trade: (p) => {
      if (localStorage.banc_patch_absent === "1" && ("p_instrument" in p)) return absent();
      const t = { id: crypto.randomUUID(), date_trade: p.p_date, resultat: p.p_resultat, note: p.p_note, compte_trading_id: p.p_compte_trading_id, instrument: p.p_instrument || null, frais: p.p_frais ?? null };
      ecrire("banc_trades", [...lire("banc_trades", []), t]);
      return t.id;
    },
    supprimer_mon_trade: (p) => {
      if (localStorage.banc_echec_suppression === "1") return { data: null, error: { message: "erreur simulée" } };
      const avant = lire("banc_trades", []);
      const apres = avant.filter((t) => t.id !== p.p_trade_id);
      ecrire("banc_trades", apres);
      return localStorage.banc_patch_absent === "1" ? null : apres.length < avant.length;
    },
    obtenir_mes_parametres: () => lire("banc_params", null),
    sauvegarder_mes_parametres: (p) => { ecrire("banc_params", p); return null; },
    obtenir_parametres_calculateur: () => lire("banc_calc", null),
    sauvegarder_parametres_calculateur: (p) => { ecrire("banc_calc", p.p_parametres); return null; },
    lister_mes_comptes_trading: () => [],
    lire_donnees: () => absent(),
    obtenir_cle_cotations: () => localStorage.banc_cle_td || null,
    enregistrer_analyse: (p) => { const l = lire("banc_analyses", []); l.unshift({ ...p, cree_le: new Date().toISOString(), actif: p.p_actif, horizon: p.p_horizon, direction: p.p_direction, confiance: p.p_confiance, prix_reference: p.p_prix_reference }); ecrire("banc_analyses", l); return "id"; },
    lister_mes_analyses: () => lire("banc_analyses", []),
  };

  window.supabase = {
    createClient: () => ({
      rpc: async (nom, params) => {
        await new Promise((r) => setTimeout(r, 60));
        if (localStorage.banc_patch_absent === "1" && FONCTIONS_PATCH.includes(nom)) return absent();
        const f = rpcs[nom];
        if (!f) return { data: null, error: null };
        const r = f(params || {});
        if (r && typeof r === "object" && "error" in r && "data" in r) return r;
        return { data: r, error: null };
      },
      from: () => ({ select: async () => ({ data: [], error: null }) }),
      storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    }),
  };
  localStorage.setItem("goldai_acces_site_ok", "1");
  localStorage.setItem("goldai_session_token", "00000000-0000-0000-0000-000000000000");
})();
