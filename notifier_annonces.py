"""
Envoie une notification sur le téléphone ~15 minutes avant chaque annonce
économique en DOLLAR (USD) à FORT impact — même quand l'app est fermée.

Lancé toutes les 5 minutes par la tâche planifiée Windows
"gold-ai notifications" (scripts/lancer_notifications.bat). Lit le calendrier
déjà téléchargé par sync_calendrier.py (site/data/calendrier_semaine.json).

- Plusieurs annonces à la même heure (ex. NFP + chômage à 8 h 30) = UNE seule
  notification qui les liste toutes.
- Chaque annonce n'est notifiée qu'une fois (mémoire : data/notifications_envoyees.json).
- Si le PC est éteint ou en veille, rien n'est envoyé.
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

import notifications_push

ICI = Path(__file__).resolve().parent
CALENDRIER = ICI / "data" / "calendrier_semaine.json"
MEMOIRE = ICI.parent / "data" / "notifications_envoyees.json"

AVANCE = timedelta(minutes=15)
# La tâche tourne toutes les 5 min : on envoie dès que l'annonce est à 16 min
# ou moins (donc entre ~11 et 16 min avant), jamais une fois l'annonce passée.
FENETRE = AVANCE + timedelta(minutes=1)


def lire_memoire():
    try:
        return json.loads(MEMOIRE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def ecrire_memoire(memoire, maintenant):
    # On oublie ce qui a plus de 3 jours.
    limite = (maintenant - timedelta(days=3)).isoformat()
    memoire = {k: v for k, v in memoire.items() if v >= limite}
    MEMOIRE.parent.mkdir(parents=True, exist_ok=True)
    MEMOIRE.write_text(json.dumps(memoire, indent=1), encoding="utf-8")


def main():
    maintenant = datetime.now(timezone.utc)
    try:
        evenements = json.loads(CALENDRIER.read_text(encoding="utf-8")).get("evenements", [])
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"{maintenant:%Y-%m-%d %H:%M} calendrier illisible : {e}")
        return

    memoire = lire_memoire()
    a_notifier = []
    for e in evenements:
        if e.get("devise") != "USD" or e.get("impact") != "high" or not e.get("horodatage_utc"):
            continue
        quand = datetime.fromisoformat(e["horodatage_utc"].replace("Z", "+00:00"))
        if timedelta(0) < quand - maintenant <= FENETRE and e["id"] not in memoire:
            a_notifier.append((quand, e))

    if not a_notifier:
        return

    # Regroupe par heure de publication.
    par_heure = {}
    for quand, e in a_notifier:
        par_heure.setdefault(quand, []).append(e)

    for quand, groupe in sorted(par_heure.items()):
        minutes = max(1, round((quand - maintenant).total_seconds() / 60))
        heure_locale = quand.astimezone().strftime("%H:%M")
        if len(groupe) == 1:
            e = groupe[0]
            v = (e.get("valeurs") or [{}])[0]
            details = " · ".join(x for x in (
                f"prévision {v['prevision']}" if v.get("prevision") else "",
                f"précédent {v['precedent']}" if v.get("precedent") else "",
            ) if x)
            titre = f"⚠️ Annonce USD dans {minutes} min"
            texte = f"{e['titre']} à {heure_locale}" + (f" — {details}" if details else "")
        else:
            titre = f"⚠️ {len(groupe)} annonces USD dans {minutes} min"
            texte = f"À {heure_locale} : " + ", ".join(e["titre"] for e in groupe)
        texte += ". Attends la publication avant d'entrer."

        try:
            envoyes, echecs = notifications_push.envoyer_a_tous(titre, texte, etiquette=f"annonce-{quand:%Y%m%d%H%M}")
        except Exception as erreur:  # réseau, Supabase…
            print(f"{maintenant:%Y-%m-%d %H:%M} envoi impossible : {erreur}")
            continue  # pas mémorisé : nouvel essai 5 min plus tard (tant qu'on est avant l'annonce)
        print(f"{maintenant:%Y-%m-%d %H:%M} « {titre} » → {envoyes} téléphone(s), {echecs} échec(s)")
        for e in groupe:
            memoire[e["id"]] = maintenant.isoformat()

    ecrire_memoire(memoire, maintenant)


if __name__ == "__main__":
    main()
