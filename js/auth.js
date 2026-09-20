// Gold AI — code d'accès au site + comptes utilisateurs (Supabase).
//
// Deux barrières avant d'arriver à l'app :
//  1. Le code d'accès au site (partagé, donné à tes proches une seule fois).
//  2. Le compte personnel (nom + code, un journal de trading séparé chacun).
//
// Le vrai contrôle se fait côté serveur (fonctions Supabase) : ce fichier ne
// fait qu'appeler ces fonctions et se souvenir du résultat sur l'appareil.
window.GoldAI = window.GoldAI || {};

(() => {
  const SUPABASE_URL = "https://plbczcujtkfctzztaxzi.supabase.co";
  const SUPABASE_KEY = "sb_publishable_yWn9mUzxwJlPM2X2Cyx18w_IiKxrgGl";

  const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const CLE_GATE = "goldai_acces_site_ok";
  // Le code d'accès du site est retenu ici une fois validé, pour ne pas avoir
  // à le retaper lors de la création d'un compte (voir creerCompte ci-dessous).
  const CLE_CODE_ACCES = "goldai_code_acces_site";
  const CLE_SESSION = "goldai_session_token";
  const CLE_NOM = "goldai_nom_utilisateur";

  const MESSAGES_ERREUR = {
    NOM_VIDE: "Le nom ne peut pas être vide.",
    CODE_TROP_COURT: "Le mot de passe doit faire au moins 4 caractères.",
    NOM_DEJA_PRIS: "Ce nom est déjà utilisé — choisis-en un autre ou connecte-toi.",
    IDENTIFIANTS_INVALIDES: "Nom ou mot de passe incorrect.",
    CODE_ACCES_INVALIDE: "Code d'accès du site incorrect — retourne à l'écran précédent pour le corriger.",
    SESSION_INVALIDE: "Ta session a expiré, reconnecte-toi.",
  };

  function messageErreur(erreur) {
    return MESSAGES_ERREUR[erreur?.message] || "Une erreur est survenue. Réessaie.";
  }

  function getToken() {
    return localStorage.getItem(CLE_SESSION);
  }

  function getNom() {
    return localStorage.getItem(CLE_NOM);
  }

  function afficherEcran(id) {
    ["ecran-acces", "ecran-connexion", "app-principale"].forEach((autreId) => {
      document.getElementById(autreId).classList.toggle("hidden", autreId !== id);
    });
  }

  // Remet Journal et Profil sur leur vue d'accueil (pas une sous-vue) au
  // prochain affichage de l'app — pour ne jamais montrer les réglages ou les
  // comptes d'un utilisateur au moment où un autre vient de se connecter.
  function reinitialiserSousVues() {
    ["journal-performance", "profil-parametres", "profil-comptes", "profil-mon-compte"].forEach((id) => {
      document.getElementById(id)?.classList.add("hidden");
    });
    document.getElementById("profil-accueil")?.classList.remove("hidden");
  }

  function afficherApp(nom) {
    document.getElementById("nom-utilisateur-affiche").textContent = nom;
    afficherEcran("app-principale");
    // Marché est l'onglet par défaut : charge ses données dès l'affichage de
    // l'app, comme si on venait de cliquer dessus (les autres onglets se
    // chargent à la demande, au clic — voir app.js).
    window.GoldAI.app?.allerA("marche");
  }

  // Appelé par journal.js si une opération renvoie SESSION_INVALIDE
  // (session supprimée ou expirée) : renvoie proprement à l'écran de connexion.
  function forcerDeconnexion(message) {
    localStorage.removeItem(CLE_SESSION);
    localStorage.removeItem(CLE_NOM);
    window.GoldAI.journal?.viderCache();
    window.GoldAI.comptesTrading?.viderCache();
    window.GoldAI.parametres?.viderCache();
    window.GoldAI.profilCompte?.viderCache();
    window.GoldAI.chat?.arreterRafraichissement();
    reinitialiserSousVues();
    if (message) {
      document.getElementById("erreur-connexion").textContent = message;
      document.getElementById("erreur-connexion").classList.add("visible");
    }
    afficherEcran("ecran-connexion");
  }

  async function initialiser() {
    if (localStorage.getItem(CLE_GATE) !== "1") {
      afficherEcran("ecran-acces");
      return;
    }

    const token = getToken();
    if (!token) {
      afficherEcran("ecran-connexion");
      return;
    }

    const { data: nom, error } = await client.rpc("nom_depuis_session", { p_token: token });
    if (error || !nom) {
      forcerDeconnexion();
      return;
    }

    localStorage.setItem(CLE_NOM, nom);
    afficherApp(nom);
  }

  async function validerCodeAcces() {
    const champ = document.getElementById("code-acces-site");
    const zoneErreur = document.getElementById("erreur-acces-site");
    zoneErreur.classList.remove("visible");

    const code = champ.value.trim();
    if (!code) return;

    const { data: valide, error } = await client.rpc("verifier_code_acces", { p_code: code });
    if (error || !valide) {
      zoneErreur.textContent = "Code d'accès incorrect.";
      zoneErreur.classList.add("visible");
      return;
    }

    localStorage.setItem(CLE_GATE, "1");
    localStorage.setItem(CLE_CODE_ACCES, code);
    champ.value = "";
    afficherEcran("ecran-connexion");
  }

  async function seConnecter() {
    const nom = document.getElementById("nom-utilisateur").value.trim();
    const code = document.getElementById("code-utilisateur").value;
    const zoneErreur = document.getElementById("erreur-connexion");
    zoneErreur.classList.remove("visible");

    const { data: token, error } = await client.rpc("se_connecter", { p_nom: nom, p_code: code });
    if (error) {
      zoneErreur.textContent = messageErreur(error);
      zoneErreur.classList.add("visible");
      return;
    }

    localStorage.setItem(CLE_SESSION, token);
    localStorage.setItem(CLE_NOM, nom);
    document.getElementById("code-utilisateur").value = "";
    afficherApp(nom);
  }

  async function creerCompte() {
    const nom = document.getElementById("nom-utilisateur").value.trim();
    const code = document.getElementById("code-utilisateur").value;
    const zoneErreur = document.getElementById("erreur-connexion");
    zoneErreur.classList.remove("visible");

    // Réutilise le code d'accès du site déjà validé à l'écran précédent —
    // pas besoin de le retaper. S'il a disparu (stockage effacé...), on
    // renvoie proprement à cet écran plutôt que d'échouer sans explication.
    const codeAcces = localStorage.getItem(CLE_CODE_ACCES);
    if (!codeAcces) {
      localStorage.removeItem(CLE_GATE);
      afficherEcran("ecran-acces");
      return;
    }

    const { data: token, error } = await client.rpc("creer_compte", {
      p_nom: nom,
      p_code: code,
      p_code_acces: codeAcces,
    });
    if (error) {
      zoneErreur.textContent = messageErreur(error);
      zoneErreur.classList.add("visible");
      return;
    }

    localStorage.setItem(CLE_SESSION, token);
    localStorage.setItem(CLE_NOM, nom);
    document.getElementById("code-utilisateur").value = "";
    afficherApp(nom);
  }

  async function seDeconnecter() {
    const token = getToken();
    if (token) {
      client.rpc("se_deconnecter", { p_token: token }).catch(() => {});
    }
    localStorage.removeItem(CLE_SESSION);
    localStorage.removeItem(CLE_NOM);
    window.GoldAI.journal?.viderCache();
    window.GoldAI.comptesTrading?.viderCache();
    window.GoldAI.parametres?.viderCache();
    window.GoldAI.profilCompte?.viderCache();
    window.GoldAI.chat?.arreterRafraichissement();
    reinitialiserSousVues();
    document.getElementById("nom-utilisateur").value = "";
    document.getElementById("code-utilisateur").value = "";
    afficherEcran("ecran-connexion");
  }

  document.addEventListener("DOMContentLoaded", () => {
    initialiser();

    document.getElementById("bouton-valider-acces").addEventListener("click", validerCodeAcces);
    document.getElementById("code-acces-site").addEventListener("keydown", (e) => {
      if (e.key === "Enter") validerCodeAcces();
    });

    document.getElementById("bouton-se-connecter").addEventListener("click", seConnecter);
    document.getElementById("bouton-creer-compte").addEventListener("click", creerCompte);
    document.getElementById("bouton-deconnexion").addEventListener("click", seDeconnecter);
  });

  window.GoldAI.auth = { getToken, getNom, client, forcerDeconnexion };
})();
