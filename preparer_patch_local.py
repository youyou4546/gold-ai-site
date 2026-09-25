"""
Prépare la version "remplie" du patch Supabase (supabase/patch_calculateur_cotations.sql)
avec les vraies valeurs secrètes, dans un fichier ignoré par git :
    supabase/_A_EXECUTER_patch_rempli.sql

- Crée (une seule fois) un secret de publication aléatoire dans config/config.ini,
  section [site_supabase] : c'est lui qui autorise les scripts du PC à publier les
  prix / le calendrier / les actualités sur le site.
- Reprend la clé Twelve Data de config/config.ini, section [api].

Rien n'est envoyé nulle part : il faut ensuite coller le fichier généré dans
Supabase → SQL Editor → Run.
"""

import configparser
import secrets
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ICI = Path(__file__).resolve().parent
CONFIG_PATH = ICI.parent / "config" / "config.ini"
MODELE = ICI / "supabase" / "patch_calculateur_cotations.sql"
SORTIE = ICI / "supabase" / "_A_EXECUTER_patch_rempli.sql"

SUPABASE_URL = "https://plbczcujtkfctzztaxzi.supabase.co"
SUPABASE_CLE_PUBLIQUE = "sb_publishable_yWn9mUzxwJlPM2X2Cyx18w_IiKxrgGl"


def assurer_section_config():
    """Ajoute la section [site_supabase] à config.ini si elle n'existe pas
    (ajout en fin de fichier, pour ne pas toucher aux commentaires existants)."""
    config = configparser.ConfigParser()
    config.read(CONFIG_PATH, encoding="utf-8")
    if config.has_section("site_supabase") and config.get("site_supabase", "secret_publication", fallback=""):
        return config.get("site_supabase", "secret_publication")

    secret = secrets.token_urlsafe(32)
    with CONFIG_PATH.open("a", encoding="utf-8") as f:
        f.write(
            "\n[site_supabase]\n"
            "; Utilisé par site/publication.py : publie les prix, le calendrier et les\n"
            "; actualités sur le site en ligne (base Supabase). Le secret ne doit jamais\n"
            "; être partagé ni committé ; sa version hachée est dans Supabase.\n"
            f"url = {SUPABASE_URL}\n"
            f"cle_publique = {SUPABASE_CLE_PUBLIQUE}\n"
            f"secret_publication = {secret}\n"
        )
    return secret


def main():
    secret = assurer_section_config()
    config = configparser.ConfigParser()
    config.read(CONFIG_PATH, encoding="utf-8")
    cle_td = config.get("api", "twelvedata_api_key", fallback="").strip()
    if not cle_td or cle_td == "VOTRE_CLE_ICI":
        print("⚠️ Pas de clé Twelve Data dans config.ini [api] — les cotations en direct ne marcheront pas.")

    sql = MODELE.read_text(encoding="utf-8")
    sql = sql.replace("COLLE_ICI_LA_CLE_TWELVE_DATA", cle_td.replace("'", "''"))
    sql = sql.replace("COLLE_ICI_LE_SECRET_PUBLICATION", secret.replace("'", "''"))
    SORTIE.write_text(sql, encoding="utf-8")
    print(f"OK : patch rempli écrit dans {SORTIE}")
    print("→ Ouvre ce fichier, copie tout, colle dans Supabase → SQL Editor → Run.")


if __name__ == "__main__":
    main()
