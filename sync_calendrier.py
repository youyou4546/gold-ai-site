"""
Prépare les données du calendrier économique pour le site :

1. calendrier_du_jour.json — copié depuis data/AAAA-MM-JJ.json (déjà collecté
   par scripts/collecte_quotidienne.py), inchangé.
2. calendrier_semaine.json — récupéré directement depuis forexfactory pour
   avoir tous les jours restants de la semaine (pas seulement aujourd'hui).

⚠️ Limite de la source gratuite (forexfactory) : le flux ne contient que la
semaine calendaire EN COURS (dimanche→samedi), pas une vraie fenêtre glissante
de 7 jours. Lancé un samedi, il ne reste donc quasiment plus rien à afficher —
il se remplit à nouveau le dimanche suivant avec toute la nouvelle semaine.

À exécuter juste après la collecte quotidienne (déjà ajouté à
scripts/lancer_quotidien.bat) :

    python "%~dp0..\\site\\sync_calendrier.py"

Aucun coût, aucune API payante : lecture de fichiers locaux + un appel au
flux public forexfactory déjà utilisé par collecte_quotidienne.py.
"""

import datetime
import json
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
DATA_DIR = RACINE / "data"
SCRIPTS_DIR = RACINE / "scripts"
SITE_DATA_DIR = Path(__file__).resolve().parent / "data"

sys.path.insert(0, str(SCRIPTS_DIR))


def synchroniser_jour():
    aujourdhui = datetime.date.today().isoformat()
    fichier_source = DATA_DIR / f"{aujourdhui}.json"

    if not fichier_source.exists():
        print(f"Rien à synchroniser pour aujourd'hui : {fichier_source} n'existe pas encore.")
        return

    contenu = json.loads(fichier_source.read_text(encoding="utf-8"))
    evenements = contenu.get("calendrier", [])

    sortie = {
        "date": aujourdhui,
        "genere_le": datetime.datetime.now().isoformat(timespec="seconds"),
        "evenements": evenements,
    }
    (SITE_DATA_DIR / "calendrier_du_jour.json").write_text(
        json.dumps(sortie, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"OK : {len(evenements)} annonce(s) du jour copiée(s) vers calendrier_du_jour.json")


def synchroniser_semaine():
    import collecte_quotidienne as cq

    config = cq.charger_config()
    try:
        evenements = cq.recuperer_calendrier_semaine(config["devises_liste"], config["impact_min"])
    except Exception as erreur:
        print(f"Impossible de récupérer le calendrier de la semaine : {erreur}")
        return

    sortie = {
        "genere_le": datetime.datetime.now().isoformat(timespec="seconds"),
        "evenements": evenements,
    }
    (SITE_DATA_DIR / "calendrier_semaine.json").write_text(
        json.dumps(sortie, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"OK : {len(evenements)} annonce(s) de la semaine copiée(s) vers calendrier_semaine.json")


def main():
    SITE_DATA_DIR.mkdir(exist_ok=True)
    synchroniser_jour()
    synchroniser_semaine()


if __name__ == "__main__":
    main()
