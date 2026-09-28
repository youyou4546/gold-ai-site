"""
Prépare le passage des alertes (annonces, TP / SL) sur Supabase, pour qu'elles
marchent même PC éteint. Rien n'est envoyé nulle part par ce script.

Crée (hors du dépôt public, dans config/) :
  - config/supabase_secrets.env : les 2 secrets de la fonction Supabase
      VAPID_KEYS_B64 = la clé de signature des notifications (la même que celle
                       du PC, config/vapid_prive.pem, convertie au format attendu)
      CRON_SECRET    = mot de passe qui réserve la fonction à l'horloge Supabase
Et (ignoré par git) :
  - supabase/_A_EXECUTER_alertes_cloud.sql : le SQL à coller dans Supabase
    (mémoire des alertes + horloge « chaque minute » avec ce mot de passe).

Relancer ce script ne change rien : les valeurs existantes sont réutilisées.
"""

import base64
import json
import secrets
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization

sys.stdout.reconfigure(encoding="utf-8")

ICI = Path(__file__).resolve().parent
CONFIG = ICI.parent / "config"
PEM = CONFIG / "vapid_prive.pem"
ENV = CONFIG / "supabase_secrets.env"
SQL = ICI / "supabase" / "_A_EXECUTER_alertes_cloud.sql"
URL_FONCTION = "https://plbczcujtkfctzztaxzi.supabase.co/functions/v1/verifications"


def b64url(n, taille=32):
    return base64.urlsafe_b64encode(n.to_bytes(taille, "big")).rstrip(b"=").decode()


def jwk_depuis_pem():
    cle = serialization.load_pem_private_key(PEM.read_bytes(), password=None)
    pub = cle.public_key().public_numbers()
    base = {"kty": "EC", "crv": "P-256", "x": b64url(pub.x), "y": b64url(pub.y), "ext": True}
    return {
        "publicKey": {**base, "key_ops": ["verify"]},
        "privateKey": {**base, "d": b64url(cle.private_numbers().private_value), "key_ops": ["sign"]},
    }


def lire_env():
    if not ENV.exists():
        return {}
    return dict(l.split("=", 1) for l in ENV.read_text(encoding="utf-8").splitlines() if "=" in l)


def main():
    valeurs = lire_env()
    valeurs["VAPID_KEYS_B64"] = base64.b64encode(json.dumps(jwk_depuis_pem()).encode()).decode()
    valeurs.setdefault("CRON_SECRET", secrets.token_urlsafe(32))
    ENV.write_text("".join(f"{k}={v}\n" for k, v in valeurs.items()), encoding="utf-8")

    modele = (ICI / "supabase" / "patch_alertes_cloud.sql").read_text(encoding="utf-8")
    SQL.write_text(modele.replace("COLLE_ICI_LE_CRON_SECRET", valeurs["CRON_SECRET"]).replace("URL_DE_LA_FONCTION", URL_FONCTION), encoding="utf-8")
    print(f"Secrets : {ENV}")
    print(f"SQL à coller dans Supabase : {SQL}")


if __name__ == "__main__":
    main()
