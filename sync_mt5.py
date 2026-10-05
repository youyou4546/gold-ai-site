"""
Lit des comptes MT5 en LECTURE SEULE (mot de passe investisseur : impossible de
passer un ordre) et publie leurs chiffres dans l'app (Supabase › publier_compte_mt5).
Deux sources :
  - les comptes ajoutés DANS L'APP par chaque utilisateur (Profil › Mes comptes ›
    « Ajouter un compte MetaTrader 5 », RPC connexions_mt5_a_lire) ;
  - les sections [mt5_...] de config.ini (ex. [mt5_fundednext]).

Lancé toutes les 5 min par la tâche planifiée "gold-ai mt5" (scripts/lancer_mt5.bat).
Le terminal MT5 doit être installé sur ce PC (chemin `terminal` de la section).
Rien n'est publié si la connexion échoue : l'app garde les derniers chiffres
et affiche leur heure.
"""

import configparser
import datetime as dt
import sys
from collections import defaultdict
from zoneinfo import ZoneInfo

import requests

import publication

sys.stdout.reconfigure(encoding="utf-8")

TYPES_TRADES = (0, 1)  # DEAL_TYPE_BUY / SELL (le reste : dépôts, crédits…)


def utc(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).replace(tzinfo=None)


TERMINAL_PAR_DEFAUT = "C:/Program Files/MetaTrader 5/terminal64.exe"
ECART_SIGNAL_S = 120  # positions ouvertes à ≤ 2 min d'écart (même instrument, même sens) = un seul signal
NEW_YORK = ZoneInfo("America/New_York")


def heure_serveur_vers_utc(ts):
    """Les heures MT5 sont l'heure du SERVEUR codée comme de l'UTC. Convention des
    courtiers forex (FundedNext compris) : serveur = New York + 7 h (UTC+2 l'hiver,
    UTC+3 l'été américain)."""
    approx = dt.datetime.fromtimestamp(ts, dt.timezone.utc)
    decalage = approx.astimezone(NEW_YORK).utcoffset() + dt.timedelta(hours=7)
    return (approx - decalage).replace(tzinfo=dt.timezone.utc)


def trades_fermes(deals, positions_ouvertes, login, nom):
    """Positions fermées regroupées en SIGNAUX (comme l'import TradeLocker) pour le Journal."""
    pos = defaultdict(lambda: {"in": [], "out": []})
    for d in deals:
        if d.type not in TYPES_TRADES or not d.position_id:
            continue
        pos[d.position_id]["in" if d.entry == 0 else "out"].append(d)
    ouvertes = {p.ticket for p in positions_ouvertes}
    liste = []
    for pid, x in pos.items():
        if not x["in"] or not x["out"] or pid in ouvertes:
            continue
        vol_in = sum(d.volume for d in x["in"])
        if sum(d.volume for d in x["out"]) + 1e-9 < vol_in:
            continue  # encore partiellement ouverte
        tous = x["in"] + x["out"]
        couts = sum(d.commission + d.swap + getattr(d, "fee", 0.0) for d in tous)
        liste.append({
            "pid": pid, "symbole": x["in"][0].symbol, "sens": "buy" if x["in"][0].type == 0 else "sell",
            "ouvert": min(d.time for d in x["in"]), "ferme": max(d.time for d in x["out"]),
            "lots": vol_in, "profit": sum(d.profit for d in x["out"]), "couts": couts,
            "entree": sum(d.price * d.volume for d in x["in"]) / vol_in,
            "sortie": sum(d.price * d.volume for d in x["out"]) / max(1e-9, sum(d.volume for d in x["out"])),
            "vol_out": sum(d.volume for d in x["out"]),
        })
    liste.sort(key=lambda p: p["ouvert"])
    # Signaux : même instrument + sens, ouverts à ≤ 2 min du début du signal.
    signaux = []
    for p in liste:
        g = next((g for g in signaux if g[0]["symbole"] == p["symbole"] and g[0]["sens"] == p["sens"]
                  and 0 <= p["ouvert"] - g[0]["ouvert"] <= ECART_SIGNAL_S), None)
        (g.append(p) if g else signaux.append([p]))
    # Un signal dont une position est encore ouverte attend d'être complet.
    ouvertes_info = [(o.symbol, "buy" if o.type == 0 else "sell", o.time) for o in positions_ouvertes]
    r = lambda v, n=2: round(v, n)
    trades = []
    for g in signaux:
        if any(s == g[0]["symbole"] and se == g[0]["sens"] and abs(t - g[0]["ouvert"]) <= ECART_SIGNAL_S for s, se, t in ouvertes_info):
            continue
        g.sort(key=lambda p: p["ferme"])
        profit = sum(p["profit"] for p in g)
        couts = sum(p["couts"] for p in g)
        frais = r(max(0.0, -couts))
        resultat = r(profit + max(0.0, couts))  # un swap POSITIF s'ajoute au résultat
        lots = r(sum(p["lots"] for p in g))
        entree = sum(p["entree"] * p["lots"] for p in g) / sum(p["lots"] for p in g)
        sortie = sum(p["sortie"] * p["vol_out"] for p in g) / sum(p["vol_out"] for p in g)
        detail = f" en {len(g)} positions (" + " · ".join(f"{i + 1} : {'+' if p['profit'] >= 0 else ''}{r(p['profit'])}" for i, p in enumerate(g)) + ")" if len(g) > 1 else ""
        trades.append({
            "ref": f"mt5|{login}|{g[0]['pid']}",
            "ouvert_le": heure_serveur_vers_utc(g[0]["ouvert"]).isoformat(),
            "ferme_le": heure_serveur_vers_utc(max(p["ferme"] for p in g)).isoformat(),
            "instrument": g[0]["symbole"], "sens": g[0]["sens"],
            "resultat": resultat, "frais": frais,
            "prix_entree": r(entree, 5), "prix_sortie": r(sortie, 5),
            "note": f"Importé de MT5 · {nom} #{login} · {'Achat' if g[0]['sens'] == 'buy' else 'Vente'} {lots} lot{detail}"
                    + (f" · frais MT5 : {frais}" if frais else ""),
        })
    return trades


def lire_compte(mt5, terminal, sec):
    """sec : login, serveur, mdp, nom, depart, perte_max, perte_jour, objectif_pct."""
    if not mt5.initialize(path=terminal, login=int(sec["login"]), password=sec["mdp"],
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

        depart = float(sec.get("depart") or 0) or round(a.balance - sum(par_jour.values()), 2)  # sinon : dépôt de départ
        nom = sec.get("nom") or f"MT5 {a.login}"
        return {
            "_trades": trades_fermes(deals, positions, a.login, nom),
            "login": a.login, "nom": sec.get("nom") or f"MT5 {a.login}", "serveur": a.server, "devise": a.currency,
            "solde": round(a.balance, 2), "equite": round(a.equity, 2),
            "depart": depart, "perteMax": float(sec.get("perte_max") or 0), "perteJour": float(sec.get("perte_jour") or 0),
            "objectifPct": float(sec.get("objectif_pct") or 0),
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


def _rpc(nom, corps):
    cfg = publication._config()
    if not cfg:
        raise RuntimeError("section [site_supabase] absente de config.ini")
    r = requests.post(f"{cfg['url']}/rest/v1/rpc/{nom}",
                      headers={"apikey": cfg["cle_publique"], "Authorization": f"Bearer {cfg['cle_publique']}",
                               "Content-Type": "application/json"},
                      json={"p_secret": cfg["secret_publication"], **corps}, timeout=20)
    if r.status_code >= 400:
        raise RuntimeError(f"{nom} refusé (HTTP {r.status_code}) : {r.text[:200]}")
    return r.json() if r.text else None


def comptes_a_lire(config):
    """Comptes de l'app + sections [mt5_...] de config.ini (sans doublon utilisateur/login)."""
    comptes = []
    try:
        for c in _rpc("connexions_mt5_a_lire", {}) or []:
            comptes.append({"id": c["id"], "utilisateur": c["utilisateur"], "login": c["login"], "serveur": c["serveur"],
                            "mdp": c["mdp"], "nom": c["nom"], "depart": c["depart"], "perte_max": c["perte_max"],
                            "perte_jour": c["perte_jour"], "objectif_pct": c["objectif_pct"]})
    except Exception as erreur:
        print(f"MT5 : liste des comptes de l'app illisible — {erreur}")
    deja = {(c["utilisateur"], int(c["login"])) for c in comptes}
    for nom in [s for s in config.sections() if s.startswith("mt5_")]:
        sec = config[nom]
        cle = (sec.get("utilisateur_app", ""), int(sec["login"]))
        if cle in deja:
            continue
        comptes.append({"id": None, "utilisateur": cle[0], "login": cle[1], "serveur": sec["serveur"],
                        "mdp": sec["mot_de_passe_investisseur"], "nom": sec.get("nom"), "depart": sec.get("depart"),
                        "perte_max": sec.get("perte_max"), "perte_jour": sec.get("perte_jour"), "objectif_pct": sec.get("objectif_pct"),
                        "terminal": sec.get("terminal")})
    return comptes


def main():
    config = configparser.ConfigParser(interpolation=None)
    config.read(publication.CONFIG_PATH, encoding="utf-8")
    comptes = comptes_a_lire(config)
    if not comptes:
        return
    try:
        import MetaTrader5 as mt5
    except ImportError:
        print("MT5 : module MetaTrader5 absent (pip install MetaTrader5)")
        return
    for c in comptes:
        try:
            contenu = lire_compte(mt5, c.get("terminal") or TERMINAL_PAR_DEFAUT, c)
            trades = contenu.pop("_trades")
            _rpc("publier_compte_mt5", {"p_utilisateur": c["utilisateur"], "p_cle": f"mt5|{contenu['login']}", "p_contenu": contenu})
            # Trades fermés → Journal (Calendrier, Performance, Analyse) ; seuls les nouveaux sont ajoutés.
            n = _rpc("importer_trades_mt5", {"p_utilisateur": c["utilisateur"], "p_cle": f"mt5|{contenu['login']}",
                                             "p_nom": f"{contenu['nom']} #{contenu['login']}", "p_trades": trades})
            if n:
                print(f"MT5 {contenu['nom']} : {n} trade(s) ajouté(s) au Journal")
            if c["id"]:
                _rpc("signaler_connexion_mt5", {"p_id": c["id"], "p_erreur": None})
            print(f"MT5 {contenu['nom']} ({c['utilisateur']}) : solde {contenu['solde']} · publié")
        except Exception as erreur:  # un compte en échec n'empêche pas les autres
            print(f"MT5 {c['login']} ({c['utilisateur']}) : ÉCHEC — {erreur}")
            if c["id"]:
                try:
                    _rpc("signaler_connexion_mt5", {"p_id": c["id"], "p_erreur": "Connexion refusée : vérifie le numéro, le serveur et le mot de passe investisseur."})
                except Exception:
                    pass


if __name__ == "__main__":
    main()
