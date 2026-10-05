"""
Lit les comptes MT5 de config.ini (sections [mt5_...], ex. [mt5_fundednext]) en
LECTURE SEULE (mot de passe investisseur : impossible de passer un ordre) et
publie leurs chiffres dans l'app (Supabase › publier_compte_mt5).

Lancé par sync_site.py (tâche planifiée "gold-ai site", toutes les 15 min).
Le terminal MT5 doit être installé sur ce PC (chemin `terminal` de la section).
Rien n'est publié si la connexion échoue : l'app garde les derniers chiffres
et affiche leur heure.
"""

import configparser
import datetime as dt
import sys
from collections import defaultdict

import requests

import publication

sys.stdout.reconfigure(encoding="utf-8")

TYPES_TRADES = (0, 1)  # DEAL_TYPE_BUY / SELL (le reste : dépôts, crédits…)


def utc(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).replace(tzinfo=None)


def lire_compte(mt5, sec):
    if not mt5.initialize(path=sec["terminal"], login=int(sec["login"]), password=sec["mot_de_passe_investisseur"],
                          server=sec["serveur"], timeout=60000):
        raise RuntimeError(f"connexion MT5 impossible : {mt5.last_error()}")
    try:
        a = mt5.account_info()
        if a is None:
            raise RuntimeError(f"compte illisible : {mt5.last_error()}")
        # Heure du serveur (les heures MT5 sont codées en heure du serveur) : dernier tick de l'or.
        tick = mt5.symbol_info_tick("XAUUSD")
        maintenant_serveur = utc(tick.time) if tick else dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
        jour_serveur = maintenant_serveur.date()

        deals = mt5.history_deals_get(dt.datetime(2000, 1, 1), dt.datetime.now() + dt.timedelta(days=2)) or []
        par_jour = defaultdict(float)
        trades_jour = 0
        for d in deals:
            if d.type not in TYPES_TRADES:
                continue
            net = d.profit + d.commission + d.swap + getattr(d, "fee", 0.0)
            jour = utc(d.time).date()
            par_jour[jour] += net
            if jour == jour_serveur and d.entry == 1:  # DEAL_ENTRY_OUT : une position fermée
                trades_jour += 1
        positions = mt5.positions_get() or []
        flottant = sum(p.profit + p.swap for p in positions)
        jour_ferme = round(par_jour.get(jour_serveur, 0.0), 2)

        depart = float(sec.get("depart", 0) or 0)
        return {
            "login": a.login, "nom": sec.get("nom", f"MT5 {a.login}"), "serveur": a.server, "devise": a.currency,
            "solde": round(a.balance, 2), "equite": round(a.equity, 2),
            "depart": depart, "perteMax": float(sec.get("perte_max", 0) or 0), "perteJour": float(sec.get("perte_jour", 0) or 0),
            "objectifPct": float(sec.get("objectif_pct", 0) or 0),
            # Solde au début de la journée du serveur (base habituelle de la perte max par jour).
            "soldeDebutJour": round(a.balance - jour_ferme, 2),
            "jourFerme": jour_ferme, "flottant": round(flottant, 2), "jourNet": round(jour_ferme + flottant, 2),
            "tradesJour": trades_jour, "positionsOuvertes": len(positions), "jourServeur": jour_serveur.isoformat(),
            "jours": [{"date": k.isoformat(), "net": round(v, 2)} for k, v in sorted(par_jour.items())][-90:],
            "lectureSeule": not a.trade_allowed,
            "luLe": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        }
    finally:
        mt5.shutdown()


def publier(utilisateur, cle, contenu):
    cfg = publication._config()
    if not cfg:
        return False, "section [site_supabase] absente"
    r = requests.post(f"{cfg['url']}/rest/v1/rpc/publier_compte_mt5",
                      headers={"apikey": cfg["cle_publique"], "Authorization": f"Bearer {cfg['cle_publique']}",
                               "Content-Type": "application/json"},
                      json={"p_secret": cfg["secret_publication"], "p_utilisateur": utilisateur, "p_cle": cle, "p_contenu": contenu},
                      timeout=20)
    return r.status_code < 400, (r.text[:200] if r.status_code >= 400 else "OK")


def main():
    config = configparser.ConfigParser(interpolation=None)
    config.read(publication.CONFIG_PATH, encoding="utf-8")
    sections = [s for s in config.sections() if s.startswith("mt5_")]
    if not sections:
        return
    try:
        import MetaTrader5 as mt5
    except ImportError:
        print("MT5 : module MetaTrader5 absent (pip install MetaTrader5)")
        return
    for nom in sections:
        sec = config[nom]
        try:
            contenu = lire_compte(mt5, sec)
            ok, msg = publier(sec.get("utilisateur_app", ""), f"mt5|{contenu['login']}", contenu)
            print(f"MT5 {contenu['nom']} : solde {contenu['solde']} · publication {msg}")
        except Exception as erreur:  # un compte en échec n'empêche pas les autres
            print(f"MT5 {nom} : ÉCHEC — {erreur}")


if __name__ == "__main__":
    main()
