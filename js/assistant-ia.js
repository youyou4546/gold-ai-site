// Gold AI — Analyse › Pose ta question (assistant trading gratuit, Google Gemini).
// La conversation est gardée sur ce téléphone seulement (localStorage) ; chaque
// question envoie les derniers messages à la fonction Supabase « assistant-trading »
// (supabase/functions/assistant-trading), qui garde la clé et appelle l'IA.
(() => {
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  const CLE_STOCKAGE = "goldai-assistant-conversation";
  const MAX_GARDES = 30;

  let messages = []; // [{ role: "user" | "assistant", texte }]
  let enCours = false;

  function charger() {
    try { messages = JSON.parse(localStorage.getItem(CLE_STOCKAGE) || "[]").filter((m) => m && m.texte); } catch { messages = []; }
  }
  function sauver() {
    try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(messages.slice(-MAX_GARDES))); } catch { /* stockage indisponible */ }
  }

  // Petite mise en forme sûre : on échappe tout, puis **gras** et listes "- ".
  function miseEnForme(texte) {
    const blocs = [];
    let liste = [];
    const fermerListe = () => { if (liste.length) { blocs.push(`<ul>${liste.join("")}</ul>`); liste = []; } };
    for (const brute of texte.split("\n")) {
      const ligne = esc(brute.trim()).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      const puce = ligne.match(/^[-*•]\s+(.*)$/) || ligne.match(/^\d+[.)]\s+(.*)$/);
      if (puce) { liste.push(`<li>${puce[1]}</li>`); continue; }
      fermerListe();
      if (ligne) blocs.push(`<p>${ligne.replace(/^#+\s*/, "")}</p>`);
    }
    fermerListe();
    return blocs.join("");
  }

  function afficher() {
    const zone = $("assistant-messages");
    zone.innerHTML = messages.length
      ? messages.map((m) => m.role === "user"
        ? `<div class="bulle-assistant moi">${esc(m.texte)}</div>`
        : `<div class="bulle-assistant ia">${miseEnForme(m.texte)}</div>`).join("")
        + (enCours ? `<div class="bulle-assistant ia attente">L'assistant réfléchit…</div>` : "")
      : `<p class="texte-attenue petit">Exemples : « C'est quoi un pip sur l'or ? », « Comment calculer mon lot pour risquer 1 % ? », « Pourquoi le NFP fait bouger l'or ? »</p>`;
    $("assistant-effacer").classList.toggle("hidden", !messages.length || enCours);
    $("assistant-envoyer").disabled = enCours;
    $("assistant-envoyer").textContent = enCours ? "…" : "Envoyer";
    zone.scrollTop = zone.scrollHeight;
  }

  function erreur(message) {
    $("assistant-erreur").textContent = message || "";
    $("assistant-erreur").classList.toggle("visible", Boolean(message));
  }

  async function envoyer() {
    const champ = $("assistant-question");
    const question = champ.value.trim();
    if (enCours || !question) return;
    erreur("");
    messages.push({ role: "user", texte: question });
    champ.value = "";
    enCours = true;
    afficher();
    let message = "";
    try {
      const r = await window.GoldAI.auth.client.functions.invoke("assistant-trading", {
        body: { token: window.GoldAI.auth.getToken(), messages: messages.slice(-12) },
      });
      if (r.error) {
        let corps = null;
        try { corps = await r.error.context?.json(); } catch { /* pas de JSON */ }
        if (corps?.erreur === "SESSION_INVALIDE") { window.GoldAI.auth.forcerDeconnexion("Ta session a expiré, reconnecte-toi."); return; }
        message = corps?.erreur || "Connexion au serveur impossible. Vérifie ta connexion.";
      } else {
        messages.push({ role: "assistant", texte: r.data.reponse });
      }
    } catch {
      message = "Connexion au serveur impossible. Vérifie ta connexion.";
    } finally {
      enCours = false;
    }
    if (message) {
      // La question non répondue revient dans le champ pour pouvoir la renvoyer.
      messages.pop();
      champ.value = question;
      erreur(message);
    }
    sauver();
    afficher();
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("carte-assistant-ia")) return;
    charger();
    afficher();
    $("assistant-envoyer").addEventListener("click", envoyer);
    $("assistant-question").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoyer(); }
    });
    $("assistant-effacer").addEventListener("click", () => { messages = []; sauver(); erreur(""); afficher(); });
  });
})();
