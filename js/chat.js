// Gold AI — Chat partagé entre tous les utilisateurs de l'app (contrairement
// au reste, qui est privé par compte). Rafraîchi automatiquement toutes les
// 4 secondes tant que l'onglet Chat est affiché (pas de vraie connexion
// "temps réel" — pas besoin pour un chat entre quelques personnes, et ça
// évite d'ajouter une dépendance supplémentaire).
(() => {
  const INTERVALLE_RAFRAICHISSEMENT_MS = 4000;
  let minuteur = null;
  let dernierePileId = null; // évite de re-rendre si rien n'a changé

  function client() {
    return window.GoldAI.auth.client;
  }

  function token() {
    return window.GoldAI.auth.getToken();
  }

  function gererErreur(error) {
    if (error?.message === "SESSION_INVALIDE") {
      arreterRafraichissement();
      window.GoldAI.auth.forcerDeconnexion("Ta session a expiré, reconnecte-toi.");
      return true;
    }
    return !!error;
  }

  function formaterHeure(dateIso) {
    return new Date(dateIso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function creerBulleMessage(message, estMoi) {
    const div = document.createElement("div");
    div.className = `bulle-chat ${estMoi ? "de-moi" : "des-autres"}`;

    const avatar = message.photo_data
      ? `<img src="${message.photo_data}" alt="" />`
      : "👤";

    div.innerHTML = `
      <div class="avatar-chat">${avatar}</div>
      <div class="contenu-bulle-chat">
        ${estMoi ? "" : `<div class="nom-expediteur-chat">${message.nom}</div>`}
        <div class="texte-bulle-chat"></div>
        <div class="heure-bulle-chat">${formaterHeure(message.cree_le)}</div>
      </div>
    `;
    // textContent (pas innerHTML) pour le texte du message : évite qu'un
    // message contenant du HTML ne s'exécute dans la page de tout le monde.
    div.querySelector(".texte-bulle-chat").textContent = message.texte;

    return div;
  }

  async function rafraichir() {
    const { data, error } = await client().rpc("lister_messages_chat", { p_token: token(), p_limite: 100 });
    if (gererErreur(error)) return;

    const messages = data || [];
    const signature = messages.map((m) => m.id).join(",");
    if (signature === dernierePileId) return; // rien de nouveau, on ne re-rend pas
    dernierePileId = signature;

    const zone = document.getElementById("zone-messages-chat");
    const monNom = window.GoldAI.auth.getNom();
    const etaitEnBas = zone.scrollTop + zone.clientHeight >= zone.scrollHeight - 40;

    zone.innerHTML = "";
    if (messages.length === 0) {
      zone.innerHTML = `<p class="etat-vide">Aucun message pour l'instant. Sois le premier à écrire !</p>`;
      return;
    }

    messages.forEach((message) => {
      zone.appendChild(creerBulleMessage(message, message.nom === monNom));
    });

    if (etaitEnBas) zone.scrollTop = zone.scrollHeight;
  }

  async function envoyerMessage() {
    const champ = document.getElementById("champ-message-chat");
    const texte = champ.value.trim();
    if (!texte) return;

    champ.value = "";
    champ.disabled = true;

    const { error } = await client().rpc("envoyer_message_chat", { p_token: token(), p_texte: texte });
    champ.disabled = false;
    champ.focus();

    if (gererErreur(error)) {
      champ.value = texte; // redonne le texte pour ne pas le perdre
      return;
    }

    dernierePileId = null; // force le prochain rafraîchissement à re-rendre
    await rafraichir();
    const zone = document.getElementById("zone-messages-chat");
    zone.scrollTop = zone.scrollHeight;
  }

  function demarrerRafraichissement() {
    if (minuteur) return;
    rafraichir();
    minuteur = setInterval(rafraichir, INTERVALLE_RAFRAICHISSEMENT_MS);
  }

  function arreterRafraichissement() {
    clearInterval(minuteur);
    minuteur = null;
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("bouton-envoyer-chat").addEventListener("click", envoyerMessage);
    document.getElementById("champ-message-chat").addEventListener("keydown", (e) => {
      if (e.key === "Enter") envoyerMessage();
    });
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.chat = { demarrerRafraichissement, arreterRafraichissement };
})();
