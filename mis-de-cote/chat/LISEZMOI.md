# Section Chat — mise de côté (2026-09-28)

Le chat entre utilisateurs a été retiré de l'application, **sans être supprimé** :
tout ce qu'il faut pour le remettre est dans ce dossier. Rien de ce dossier n'est
chargé par le site tant qu'on ne le rebranche pas.

| Fichier | Rôle |
|---|---|
| `chat.js` | Le fonctionnement du chat (charger / envoyer les messages, rafraîchissement). |
| `chat.css` | Son apparence (bulles, barre d'envoi). |
| `chat.html` | Les 3 morceaux de page : la section, le bouton du menu, la ligne de script. |
| `../../supabase/patch_chat.sql` | La partie base de données (déjà installée dans Supabase, rien à refaire). |

## Pour remettre le chat

1. Déplacer `chat.js` dans `js/`.
2. Recoller les 3 morceaux de `chat.html` dans `index.html` aux endroits indiqués.
3. Recoller le contenu de `chat.css` à la fin de `css/style.css`.
4. Dans `service-worker.js`, rajouter `"./js/chat.js",` dans la liste des fichiers
   et augmenter le numéro de `VERSION`.
5. Dans `js/app.js`, fonction `allerA`, remettre :
   ```js
   if (cible === "chat") window.GoldAI?.chat?.demarrerRafraichissement();
   else window.GoldAI?.chat?.arreterRafraichissement();
   ```

`js/auth.js` appelle déjà `window.GoldAI.chat?.arreterRafraichissement()` à la
déconnexion : ce code ne fait rien quand le chat est absent, et reprend tout seul
quand il revient.
