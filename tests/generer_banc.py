"""Génère banc-essai.html (ignoré par git) : copie d'index.html où Supabase est
remplacé par tests/faux-supabase.js. Usage : python tests/generer_banc.py
puis python -m http.server 8765 dans site/ et ouvrir http://localhost:8765/banc-essai.html"""
from pathlib import Path
ici = Path(__file__).resolve().parent.parent
html = (ici / "index.html").read_text(encoding="utf-8")
cdn = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>'
assert cdn in html
html = html.replace(cdn, '<script src="tests/faux-supabase.js"></script>')
html = html.replace("<title>Trading Tool</title>", "<title>BANC D'ESSAI — Trading Tool</title>")
(ici / "banc-essai.html").write_text(html, encoding="utf-8")
print("banc-essai.html généré")
