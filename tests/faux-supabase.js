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
    sauvegarder_mes_parametres: (p) => { ecrire("banc_params", Object.fromEntries(Object.entries(p).filter(([k]) => k !== "p_token").map(([k, v]) => [k.replace(/^p_/, ""), v]))); return null; },
    obtenir_parametres_calculateur: () => lire("banc_calc", null),
    sauvegarder_parametres_calculateur: (p) => { ecrire("banc_calc", p.p_parametres); return null; },
    lister_mes_comptes_trading: () => [{ id: "c1", nom: "FTMO 100k", taille: 100000, solde_actuel: 100000, statut: "challenge", limite_perte_quotidienne_pct: 5, limite_drawdown_max_pct: 10 }],
    enregistrer_mon_trade: (p) => {
      if (localStorage.banc_patch_absent === "1") return absent();
      const liste = lire("banc_trades", []);
      const t = { id: p.p_trade_id || crypto.randomUUID(), date_trade: p.p_date, resultat: p.p_resultat, note: p.p_note, compte_trading_id: p.p_compte_trading_id,
        instrument: p.p_instrument || null, frais: p.p_frais ?? null, prix_entree: p.p_prix_entree, prix_sortie: p.p_prix_sortie, rr: p.p_rr,
        compte_tl: p.p_compte_tl || null, compte_tl_nom: p.p_compte_tl ? p.p_compte_tl_nom : null };
      ecrire("banc_trades", [...liste.filter((x) => x.id !== t.id), t]);
      return t.id;
    },
    lister_images_trade: (p) => lire("banc_images", []).filter((i) => i.trade_id === p.p_trade_id),
    ajouter_image_trade: (p) => { const i = { id: crypto.randomUUID(), trade_id: p.p_trade_id, image_data: p.p_image_data }; ecrire("banc_images", [...lire("banc_images", []), i]); return i.id; },
    supprimer_image_trade: (p) => { ecrire("banc_images", lire("banc_images", []).filter((i) => i.id !== p.p_image_id)); return true; },
    compter_images_mes_trades: () => {
      if (localStorage.banc_patch_absent === "1") return absent();
      const n = {}; lire("banc_images", []).forEach((i) => { n[i.trade_id] = (n[i.trade_id] || 0) + 1; });
      return Object.entries(n).map(([trade_id, nombre]) => ({ trade_id, nombre }));
    },
    definir_mon_trade_en_cours: (p) => { if (localStorage.banc_patch_absent === "1") return absent(); ecrire("banc_trade_en_cours", p.p_contenu); return null; },
    obtenir_mon_trade_en_cours: () => (localStorage.banc_patch_absent === "1" ? absent() : lire("banc_trade_en_cours", null)),
    lister_mes_alertes_prix: () => (localStorage.banc_patch_absent === "1" ? absent() : lire("banc_alertes", [])),
    ajouter_alerte_prix: (p) => {
      if (localStorage.banc_patch_absent === "1") return absent();
      const a = { id: crypto.randomUUID(), bas: p.p_bas, haut: p.p_haut, note: p.p_note, prix_creation: p.p_prix_creation, cree_le: new Date().toISOString(), touchee_le: null, prix_touche: null };
      ecrire("banc_alertes", [a, ...lire("banc_alertes", [])]);
      return a.id;
    },
    supprimer_alerte_prix: (p) => { ecrire("banc_alertes", lire("banc_alertes", []).filter((a) => a.id !== p.p_id)); return true; },
    lire_donnees: () => absent(),
    obtenir_cle_cotations: () => localStorage.banc_cle_td || null,
    enregistrer_analyse: (p) => { const l = lire("banc_analyses", []); l.unshift({ ...p, cree_le: new Date().toISOString(), actif: p.p_actif, horizon: p.p_horizon, direction: p.p_direction, confiance: p.p_confiance, prix_reference: p.p_prix_reference }); ecrire("banc_analyses", l); return "id"; },
    lister_mes_analyses: () => lire("banc_analyses", []),
    lister_positions_importees: () => lire("banc_positions", []),
    mes_analyses_graphique: () => ({ moi: lire("banc_ia", []).length, total: lire("banc_ia", []).length + 3, limite_moi: 5, limite_total: 10, historique: lire("banc_ia", []) }),
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
      // Fonction « tradelocker » simulée (localStorage.banc_tl = connexions enregistrées).
      functions: {
        invoke: async (nom, { body }) => {
          await new Promise((r) => setTimeout(r, 300));
          const cx = lire("banc_tl", []);
          if (body.action === "ajouter") {
            if (body.motDePasse === "faux") return { data: null, error: { context: { json: async () => ({ erreur: "TradeLocker refuse ces identifiants : vérifie l'email, le mot de passe, le serveur et Démo / Réel." }) } } };
            ecrire("banc_tl", [...cx, { id: crypto.randomUUID(), email: body.email, serveur: body.serveur, environnement: body.environnement }]);
            return { data: { ok: true }, error: null };
          }
          if (body.action === "comptes") return { data: { comptes: cx.flatMap(() => [{ cle: "live|1", nom: "NOVA 100K #1", solde: 98492.74, devise: "USD" }, { cle: "live|2", nom: "NOVA 50K (copie) #2", solde: 50880, devise: "USD" }]) }, error: null };
          if (nom === "assistant-trading") {
            const q = body.messages?.[body.messages.length - 1]?.texte || "";
            if (/erreur/i.test(q)) return { data: null, error: { context: { json: async () => ({ erreur: "Limite gratuite atteinte pour le moment. Réessaie dans une minute." }) } } };
            return { data: { ok: true, modele: "banc", reponse: "Sur l'or (XAUUSD), **1 pip = 0,10 $** de mouvement de prix.\n\n- Avec **1 lot** (100 onces), 1 pip vaut **10 $**\n- Avec **0,10 lot**, 1 pip vaut **1 $**\n- Avec **0,01 lot**, 1 pip vaut **0,10 $**\n\nExemple : l'or passe de 2650,00 à 2652,00 = **20 pips**. Avec 0,10 lot, ça fait **20 $** de gain ou de perte." }, error: null };
          }
          if (nom === "analyse-graphique") {
            const liste = lire("banc_ia", []);
            if (liste.length >= 5) return { data: null, error: { context: { json: async () => ({ erreur: "Tu as déjà utilisé tes 5 analyses d'aujourd'hui. Reviens demain." }) } } };
            const analyse = { lisible: true, instrument: "XAUUSD", unite_de_temps: "15 min", tendance: { direction: "haussière", explication: "Creux ascendants." },
              zones: [{ type: "résistance", prix: "4388", commentaire: "Sommet" }, { type: "support", prix: "4350", commentaire: "Creux" }],
              scenario_achat: { conditions: "Cassure de 4388", entree: "4390", stop: "4375", objectifs: "4400" },
              scenario_vente: { conditions: "Cassure de 4375", entree: "4374", stop: "4390", objectifs: "4360" },
              invalidation: "Clôture sous 4350", resume: "Tendance haussière nette.", prudence: "Pas un conseil financier." };
            ecrire("banc_ia", [{ id: String(liste.length), cree_le: new Date().toISOString(), question: body.question, reponse: analyse, cout_usd: 0.017 }, ...liste]);
            return { data: { ok: true, analyse, cout_usd: 0.017 }, error: null };
          }
          // « Actualiser les trades » : 1 trade à importer la première fois, plus rien ensuite (anti-doublon).
          if (body.action === "importer") {
            if (!cx.length) return { data: null, error: { context: { json: async () => ({ erreur: "Aucun compte TradeLocker relié : ajoute-le d'abord dans Profil › Mes comptes TradeLocker." }) } } };
            if (localStorage.banc_importe === "1") return { data: { ok: true, importes: 0, erreurs: [] }, error: null };
            localStorage.banc_importe = "1";
            ecrire("banc_trades", [...lire("banc_trades", []), { id: crypto.randomUUID(), date_trade: new Date().toISOString().slice(0, 10), resultat: 179.53, compte_tl: "live|1", compte_tl_nom: "NOVA 100K #1", ouvert_le: new Date().toISOString(), instrument: "XAUUSD" }]);
            return { data: { ok: true, importes: 1, erreurs: [] }, error: null };
          }
          if (body.action === "supprimes") return { data: { trades: lire("banc_supprimes", []) }, error: null };
          if (body.action === "reimporter") {
            const t = lire("banc_supprimes", []).find((x) => x.tradeId === body.tradeId);
            ecrire("banc_supprimes", lire("banc_supprimes", []).filter((x) => x.tradeId !== body.tradeId));
            if (t) ecrire("banc_trades", [...lire("banc_trades", []), { id: t.tradeId, date_trade: t.fermeLe.slice(0, 10), resultat: t.resultat, compte_tl: t.compteTl, compte_tl_nom: "Réimporté", ouvert_le: t.fermeLe }]);
            return { data: { ok: true, importes: t ? 1 : 0 }, error: null };
          }
          if (body.action === "supprimer") { ecrire("banc_tl", cx.filter((c) => c.id !== body.id)); return { data: { ok: true }, error: null }; }
          const alea = () => Math.round((Math.random() - 0.4) * 30000) / 100;
          return { data: { lu_le: new Date().toISOString(), importes24h: 3, connexions: cx.map((c) => ({ ...c, comptes: [
            { id: 1, accNum: 1, nom: "NOVA 50K", devise: "USD", statut: "ACTIVE", solde: 50412.5, equite: 50520.1, jourNet: 412.5, jourTrades: 2, ouvertNet: 107.6,
              positions: [{ id: "p1", symbole: "XAUUSD", sens: "buy", lots: 0.5, prixEntree: 4131.2, pnl: alea() }] },
            { id: 2, accNum: 2, nom: "NOVA 50K (copie)", devise: "USD", statut: "ACTIVE", solde: 49880, equite: 49880, jourNet: -120, jourTrades: 1, ouvertNet: 0, positions: [] },
          ] })) }, error: null };
        },
      },
      storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    }),
  };
  localStorage.setItem("goldai_acces_site_ok", "1");
  localStorage.setItem("goldai_session_token", "00000000-0000-0000-0000-000000000000");
})();
