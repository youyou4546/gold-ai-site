"""
Copie le calendrier économique du jour (déjà collecté par
scripts/collecte_quotidienne.py dans data/AAAA-MM-JJ.json) vers
site/data/calendrier_du_jour.json, dans le format attendu par le site.

À exécuter juste après la collecte quotidienne (ajouter une ligne dans la
tâche planifiée "gold-ai quotidien" de 07:00, ou dans lancer_quotidien.bat) :

    python "%~dp0..\\site\\sync_calendrier.py"

Aucun coût, aucune API : lecture d'un fichier local + écriture d'un autre.
"""

import datetime
import json
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
DATA_DIR = RACINE / "data"
SITE_DATA_DIR = Path(__file__).resolve().parent / "data"


def main():
    aujourdhui = datetime.date.today().isoformat()
    fichier_source = DATA_DIR / f"{aujourdhui}.json"

    if not fichier_source.exists():
        print(f"Rien à synchroniser : {fichier_source} n'existe pas encore (collecte pas encore lancée aujourd'hui ?).")
        return

    contenu = json.loads(fichier_source.read_text(encoding="utf-8"))
    evenements = contenu.get("calendrier", [])

    SITE_DATA_DIR.mkdir(exist_ok=True)
    sortie = {
        "date": aujourdhui,
        "genere_le": datetime.datetime.now().isoformat(timespec="seconds"),
        "evenements": evenements,
    }
    (SITE_DATA_DIR / "calendrier_du_jour.json").write_text(
        json.dumps(sortie, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"OK : {len(evenements)} annonce(s) du {aujourdhui} copiée(s) vers site/data/calendrier_du_jour.json")


if __name__ == "__main__":
    main()
