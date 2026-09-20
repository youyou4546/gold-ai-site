// Gold AI — Profil > Mon compte : changer sa photo, son nom et son mot de
// passe. La photo est réduite et compressée dans le navigateur avant l'envoi
// (petite image, jamais l'original) pour rester légère en base de données.
(() => {
  const TAILLE_PHOTO = 160; // pixels, carré

  let photoDataActuelle = null;
  let dejaCharge = false;

  const MESSAGES_ERREUR = {
    NOM_VIDE: "Le nom ne peut pas être vide.",
    NOM_DEJA_PRIS: "Ce nom est déjà utilisé.",
    ANCIEN_MOT_DE_PASSE_INCORRECT: "Mot de passe actuel incorrect.",
    CODE_TROP_COURT: "Le nouveau mot de passe doit faire au moins 4 caractères.",
    SESSION_INVALIDE: "Ta session a expiré, reconnecte-toi.",
  };

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

  function messageErreur(erreur) {
    return MESSAGES_ERREUR[erreur?.message] || "Une erreur est survenue. Réessaie.";
  }

  function afficherAvatar(photoData) {
    photoDataActuelle = photoData || null;
    const html = photoDataActuelle
      ? `<img src="${photoDataActuelle}" alt="Photo de profil" />`
      : "👤";

    document.querySelectorAll(".avatar-profil, .icone-profil").forEach((el) => {
      el.innerHTML = html;
    });
  }

  // Appelé au premier affichage de l'onglet Profil (voir app.js) pour que
  // l'avatar de l'accueil soit déjà à jour sans avoir besoin d'ouvrir "Mon compte".
  async function charger() {
    if (dejaCharge) return;
    dejaCharge = true;

    const { data, error } = await client().rpc("obtenir_mon_profil", { p_token: token() });
    if (gererErreur(error)) return;
    if (data) afficherAvatar(data.photo_data);
  }

  // Appelé par auth.js à la déconnexion pour ne pas garder la photo de
  // l'utilisateur précédent affichée au prochain compte connecté.
  function viderCache() {
    dejaCharge = false;
    afficherAvatar(null);
  }

  function redimensionnerEtCompresser(fichier) {
    return new Promise((resoudre, rejeter) => {
      const lecteur = new FileReader();
      lecteur.onerror = () => rejeter(new Error("Lecture du fichier impossible"));
      lecteur.onload = () => {
        const image = new Image();
        image.onerror = () => rejeter(new Error("Image invalide"));
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = TAILLE_PHOTO;
          canvas.height = TAILLE_PHOTO;
          const ctx = canvas.getContext("2d");

          // Recadrage carré centré (cover), pour ne pas déformer l'image
          const cote = Math.min(image.width, image.height);
          const decalageX = (image.width - cote) / 2;
          const decalageY = (image.height - cote) / 2;
          ctx.drawImage(image, decalageX, decalageY, cote, cote, 0, 0, TAILLE_PHOTO, TAILLE_PHOTO);

          resoudre(canvas.toDataURL("image/jpeg", 0.75));
        };
        image.src = lecteur.result;
      };
      lecteur.readAsDataURL(fichier);
    });
  }

  async function changerPhoto(fichier) {
    if (!fichier) return;
    if (!fichier.type.startsWith("image/")) {
      alert("Choisis un fichier image.");
      return;
    }

    try {
      const photoData = await redimensionnerEtCompresser(fichier);
      const { error } = await client().rpc("modifier_ma_photo", { p_token: token(), p_photo_data: photoData });
      if (gererErreur(error)) return;
      afficherAvatar(photoData);
    } catch (erreur) {
      alert("Impossible de traiter cette image. Essaie avec une autre.");
    }
  }

  async function modifierNom() {
    const champ = document.getElementById("champ-nouveau-nom");
    const zoneMessage = document.getElementById("message-nom");
    const nouveauNom = champ.value.trim();

    const { error } = await client().rpc("modifier_mon_nom", { p_token: token(), p_nouveau_nom: nouveauNom });
    if (error) {
      zoneMessage.textContent = messageErreur(error);
      zoneMessage.classList.remove("succes-visible");
      zoneMessage.style.color = "var(--rouge)";
      return;
    }

    localStorage.setItem("goldai_nom_utilisateur", nouveauNom);
    document.querySelectorAll(".nom-connecte, #nom-utilisateur-affiche").forEach((el) => (el.textContent = nouveauNom));
    zoneMessage.textContent = "✓ Nom mis à jour";
    zoneMessage.style.color = "var(--vert)";
    zoneMessage.classList.add("succes-visible");
    setTimeout(() => zoneMessage.classList.remove("succes-visible"), 2500);
  }

  async function modifierMotDePasse() {
    const champAncien = document.getElementById("champ-ancien-mdp");
    const champNouveau = document.getElementById("champ-nouveau-mdp");
    const zoneMessage = document.getElementById("message-mdp");

    const { error } = await client().rpc("modifier_mon_mot_de_passe", {
      p_token: token(),
      p_ancien_mot_de_passe: champAncien.value,
      p_nouveau_mot_de_passe: champNouveau.value,
    });

    if (error) {
      zoneMessage.textContent = messageErreur(error);
      zoneMessage.style.color = "var(--rouge)";
      zoneMessage.classList.add("succes-visible");
      return;
    }

    champAncien.value = "";
    champNouveau.value = "";
    zoneMessage.textContent = "✓ Mot de passe mis à jour";
    zoneMessage.style.color = "var(--vert)";
    zoneMessage.classList.add("succes-visible");
    setTimeout(() => zoneMessage.classList.remove("succes-visible"), 2500);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("bouton-ouvrir-mon-compte")?.addEventListener("click", () => {
      document.getElementById("profil-accueil").classList.add("hidden");
      document.getElementById("profil-mon-compte").classList.remove("hidden");
      document.getElementById("champ-nouveau-nom").value = window.GoldAI.auth.getNom() || "";
    });

    document.getElementById("bouton-retour-mon-compte")?.addEventListener("click", () => {
      document.getElementById("profil-mon-compte").classList.add("hidden");
      document.getElementById("profil-accueil").classList.remove("hidden");
    });

    document.getElementById("bouton-changer-photo")?.addEventListener("click", () => {
      document.getElementById("champ-photo-profil").click();
    });

    document.getElementById("champ-photo-profil")?.addEventListener("change", (e) => {
      changerPhoto(e.target.files[0]);
    });

    document.getElementById("bouton-modifier-nom")?.addEventListener("click", modifierNom);
    document.getElementById("bouton-modifier-mdp")?.addEventListener("click", modifierMotDePasse);
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.profilCompte = { charger, viderCache };
})();
