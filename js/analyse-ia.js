// Gold AI — Analyse › Analyse de graphique par l'IA (Claude Sonnet 5.5, payant).
//
// La capture est réduite sur le téléphone (1568 px max, JPEG) puis envoyée à la
// fonction Supabase « analyse-graphique » (supabase/functions/analyse-graphique),
// qui vérifie les limites du jour (5 par personne, 10 au total, journée de
// Toronto), appelle l'IA avec la clé gardée côté serveur et renvoie l'analyse
// + son coût. Compteurs et historique : fonction SQL mes_analyses_graphique
// (supabase/patch_analyse_graphique.sql).
(() => {
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  const TAILLE_MAX_PX = 1568; // au-delà, l'IA réduit l'image de toute façon (et on paierait plus d'envoi)

  let image = null;       // data URL de la capture choisie
  let etat = null;        // { moi, total, limite_moi, limite_total, historique }
  let enCours = false;

  function compresser(fichier) {
    return new Promise((resoudre, rejeter) => {
      const url = URL.createObjectURL(fichier);
      const img = new Image();
      img.onload = () => {
        const echelle = Math.min(1, TAILLE_MAX_PX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * echelle);
        canvas.height = Math.round(img.height * echelle);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resoudre(canvas.toDataURL("image/jpeg", 0.88));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rejeter(new Error("image illisible")); };
      img.src = url;
    });
  }

  function erreur(message) {
    $("ia-erreur").textContent = message || "";
    $("ia-erreur").classList.toggle("visible", Boolean(message));
  }

  function restantes() {
    if (!etat) return 0;
    return Math.max(0, Math.min(etat.limite_moi - etat.moi, etat.limite_total - etat.total));
  }

  function afficherCompteurs() {
    const zone = $("compteur-ia");
    if (!etat) { zone.textContent = "Compteurs indisponibles pour l'instant."; return; }
    const r = restantes();
    zone.className = `compteur-ia ${r === 0 ? "epuise" : r <= 1 ? "bientot" : ""}`;
    zone.innerHTML = `Toi : <strong>${etat.moi} / ${etat.limite_moi}</strong> aujourd'hui · Tous les utilisateurs : <strong>${etat.total} / ${etat.limite_total}</strong>
      <span class="texte-attenue petit">· environ 0,02 $ US par analyse · remis à zéro à minuit</span>`;
    majBouton();
  }

  function majBouton() {
    const bouton = $("ia-analyser");
    const r = restantes();
    bouton.disabled = enCours || !image || r === 0;
    bouton.textContent = enCours ? "Analyse en cours… (jusqu'à 1 min)"
      : r === 0 ? (etat && etat.moi >= etat.limite_moi ? "Tes 5 analyses du jour sont utilisées" : "Les 10 analyses du jour sont utilisées")
      : !image ? "Choisis d'abord une capture" : `Analyser ce graphique (${r} restante${r > 1 ? "s" : ""})`;
  }

  // Rendu d'une analyse (réponse JSON de l'IA).
  function rendu(a, cout, date) {
    if (!a) return "";
    if (a.lisible === false) {
      return `<div class="resultat-ia"><p class="alerte-donnees">🤔 ${esc(a.resume || "Ce n'est pas un graphique lisible.")}</p></div>`;
    }
    const fleche = { "haussière": "📈", "baissière": "📉", neutre: "➡️" }[a.tendance?.direction] || "📊";
    const scen = (titre, s, classe) => s ? `<div class="scenario-ia ${classe}"><strong>${titre}</strong>
      <p><span class="texte-attenue">Si :</span> ${esc(s.conditions)}</p>
      <p><span class="texte-attenue">Entrée :</span> ${esc(s.entree)} · <span class="texte-attenue">Stop :</span> ${esc(s.stop)}</p>
      <p><span class="texte-attenue">Objectifs :</span> ${esc(s.objectifs)}</p></div>` : "";
    return `<div class="resultat-ia">
      <p class="entete-ia">${[a.instrument, a.unite_de_temps].filter(Boolean).map(esc).join(" · ")}
        ${date ? ` <span class="texte-attenue petit">· ${esc(U.jourHeure(date))}</span>` : ""}</p>
      <p class="resume-ia">${esc(a.resume || "")}</p>
      ${a.tendance ? `<p><strong>${fleche} Tendance ${esc(a.tendance.direction)}</strong> — ${esc(a.tendance.explication)}</p>` : ""}
      ${(a.zones || []).length ? `<div class="zones-ia"><strong>Zones clés</strong><ul>${a.zones.map((z) => `<li><span class="type-zone ${/résistance|offre/.test(z.type) ? "haut" : /support|demande/.test(z.type) ? "bas" : ""}">${esc(z.type)}</span> <strong>${esc(z.prix)}</strong> — ${esc(z.commentaire)}</li>`).join("")}</ul></div>` : ""}
      ${scen("🟢 Scénario d'achat", a.scenario_achat, "achat")}
      ${scen("🔴 Scénario de vente", a.scenario_vente, "vente")}
      ${a.invalidation ? `<p><strong>❌ Invalidation :</strong> ${esc(a.invalidation)}</p>` : ""}
      ${a.prudence ? `<p class="texte-attenue petit">⚠️ ${esc(a.prudence)}</p>` : ""}
      ${cout !== null && cout !== undefined ? `<p class="texte-attenue petit">Coût de cette analyse : ${U.nombre(Number(cout), 3)} $ US · analyse automatique, pas un conseil financier.</p>` : ""}
    </div>`;
  }

  function afficherHistorique() {
    const liste = etat?.historique || [];
    $("ia-historique").classList.toggle("hidden", !liste.length);
    $("ia-liste-historique").innerHTML = liste.map((h) => `
      <details class="element-historique-ia">
        <summary>${esc(U.jourHeure(h.cree_le))} — ${esc((h.reponse?.resume || "").slice(0, 90))}${(h.reponse?.resume || "").length > 90 ? "…" : ""}</summary>
        ${h.question ? `<p class="texte-attenue petit">Ta question : ${esc(h.question)}</p>` : ""}
        ${rendu(h.reponse, h.cout_usd, null)}
      </details>`).join("");
  }

  async function rafraichir() {
    if (!window.GoldAI.auth?.getToken()) return;
    const { data, error } = await window.GoldAI.auth.client.rpc("mes_analyses_graphique", { p_token: window.GoldAI.auth.getToken() });
    etat = error ? null : data;
    afficherCompteurs();
    afficherHistorique();
  }

  async function analyser() {
    if (enCours || !image) return;
    erreur("");
    enCours = true;
    majBouton();
    $("ia-resultat").innerHTML = `<p class="etat-vide">🤖 L'IA lit ton graphique…</p>`;
    let data = null, message = "";
    try {
      const r = await window.GoldAI.auth.client.functions.invoke("analyse-graphique", {
        body: { token: window.GoldAI.auth.getToken(), image, question: $("ia-question").value.trim() },
      });
      data = r.data;
      if (r.error) {
        let corps = null;
        try { corps = await r.error.context?.json(); } catch { /* pas de JSON */ }
        if (corps?.erreur === "SESSION_INVALIDE") { window.GoldAI.auth.forcerDeconnexion("Ta session a expiré, reconnecte-toi."); return; }
        message = corps?.erreur || "Connexion au serveur impossible. Vérifie ta connexion.";
      }
    } catch {
      message = "Connexion au serveur impossible. Vérifie ta connexion.";
    } finally {
      enCours = false;
    }
    if (message) {
      $("ia-resultat").innerHTML = "";
      erreur(message);
    } else {
      $("ia-resultat").innerHTML = rendu(data.analyse, data.cout_usd, null);
    }
    await rafraichir();
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("carte-analyse-ia")) return;
    $("ia-choisir").addEventListener("click", () => $("ia-fichier").click());
    $("ia-fichier").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      erreur("");
      try {
        image = await compresser(f);
        $("ia-apercu").src = image;
        $("ia-apercu").classList.remove("hidden");
        $("ia-choisir").textContent = "📷 Changer de capture";
        $("ia-resultat").innerHTML = "";
      } catch { image = null; erreur("Image illisible : choisis une autre capture."); }
      majBouton();
    });
    $("ia-analyser").addEventListener("click", analyser);
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.analyseIa = { rafraichir, rendu };
})();
