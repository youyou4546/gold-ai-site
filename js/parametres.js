// Gold AI — Profil > Paramètres : réglages de trading personnels (par
// utilisateur), stockés dans Supabase. Pré-remplit le formulaire avec les
// valeurs déjà enregistrées, ou des valeurs par défaut raisonnables sinon.
(() => {
  const VALEURS_PAR_DEFAUT = {
    solde_compte: "",
    pourcentage_risque: "0.3",
    repartition_tp1: "33",
    repartition_tp2: "33",
    repartition_runner: "34",
    max_trades_jour: "",
    seuil_gain_arret: "",
    nombre_pertes_arret: "",
    heure_debut_session: "",
    heure_fin_session: "",
  };

  const CHAMPS = Object.keys(VALEURS_PAR_DEFAUT);

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

  function idChamp(cle) {
    return `param-${cle.replace(/_/g, "-")}`;
  }

  let dejaCharge = false;

  function viderCache() {
    dejaCharge = false;
  }

  async function charger() {
    const { data, error } = await client().rpc("obtenir_mes_parametres", { p_token: token() });
    if (gererErreur(error)) return;

    CHAMPS.forEach((cle) => {
      const valeur = data && data[cle] !== null && data[cle] !== undefined ? data[cle] : VALEURS_PAR_DEFAUT[cle];
      const champ = document.getElementById(idChamp(cle));
      if (champ) champ.value = valeur;
    });
  }

  async function sauvegarder() {
    const valeurs = {};
    CHAMPS.forEach((cle) => {
      const champ = document.getElementById(idChamp(cle));
      const brut = champ.value.trim();
      if (cle === "heure_debut_session" || cle === "heure_fin_session") {
        valeurs[cle] = brut || null;
      } else if (cle === "max_trades_jour" || cle === "nombre_pertes_arret") {
        valeurs[cle] = brut === "" ? null : parseInt(brut, 10);
      } else {
        valeurs[cle] = brut === "" ? null : parseFloat(brut);
      }
    });

    const zoneMessage = document.getElementById("message-parametres");
    zoneMessage.textContent = "Sauvegarde…";
    zoneMessage.classList.remove("succes-visible");

    const { error } = await client().rpc("sauvegarder_mes_parametres", {
      p_token: token(),
      p_solde_compte: valeurs.solde_compte,
      p_pourcentage_risque: valeurs.pourcentage_risque,
      p_repartition_tp1: valeurs.repartition_tp1,
      p_repartition_tp2: valeurs.repartition_tp2,
      p_repartition_runner: valeurs.repartition_runner,
      p_max_trades_jour: valeurs.max_trades_jour,
      p_seuil_gain_arret: valeurs.seuil_gain_arret,
      p_nombre_pertes_arret: valeurs.nombre_pertes_arret,
      p_heure_debut_session: valeurs.heure_debut_session,
      p_heure_fin_session: valeurs.heure_fin_session,
    });

    if (gererErreur(error)) {
      zoneMessage.textContent = "";
      return;
    }

    zoneMessage.textContent = "✓ Réglages sauvegardés";
    zoneMessage.classList.add("succes-visible");
    setTimeout(() => zoneMessage.classList.remove("succes-visible"), 2500);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("bouton-ouvrir-parametres")?.addEventListener("click", async () => {
      document.getElementById("profil-accueil").classList.add("hidden");
      document.getElementById("profil-parametres").classList.remove("hidden");
      window.GoldAI.reglagesCalculateur?.ouvrir();
      if (!dejaCharge) {
        dejaCharge = true;
        await charger();
      }
    });

    document.getElementById("bouton-retour-parametres")?.addEventListener("click", () => {
      document.getElementById("profil-parametres").classList.add("hidden");
      document.getElementById("profil-accueil").classList.remove("hidden");
    });

    document.getElementById("bouton-sauvegarder-parametres")?.addEventListener("click", sauvegarder);
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.parametres = { viderCache };
})();
