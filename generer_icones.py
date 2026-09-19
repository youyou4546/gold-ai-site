"""
Génère les icônes PWA (icon-192.png et icon-512.png) : un simple médaillon
doré sur fond sombre avec "Au" (symbole chimique de l'or) dessus.
À relancer si tu veux changer le style de l'icône (aucun coût, tourne en local).
"""

from PIL import Image, ImageDraw, ImageFont

FOND = (9, 13, 21)        # bleu-noir très sombre (thème "sombre néon fintech")
ACCENT = (34, 211, 238)   # cyan néon
ACCENT_CLAIR = (126, 232, 250)


def generer(taille, chemin):
    img = Image.new("RGB", (taille, taille), FOND)
    draw = ImageDraw.Draw(img)

    marge = int(taille * 0.08)
    draw.ellipse(
        [marge, marge, taille - marge, taille - marge],
        outline=ACCENT,
        width=max(2, int(taille * 0.03)),
    )

    rayon_interieur = int(taille * 0.36)
    centre = taille // 2
    draw.ellipse(
        [centre - rayon_interieur, centre - rayon_interieur, centre + rayon_interieur, centre + rayon_interieur],
        fill=ACCENT,
    )

    texte = "Au"
    taille_police = int(taille * 0.32)
    try:
        police = ImageFont.truetype("arialbd.ttf", taille_police)
    except Exception:
        police = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), texte, font=police)
    largeur_texte = bbox[2] - bbox[0]
    hauteur_texte = bbox[3] - bbox[1]
    draw.text(
        (centre - largeur_texte / 2 - bbox[0], centre - hauteur_texte / 2 - bbox[1]),
        texte,
        fill=FOND,
        font=police,
    )

    img.save(chemin, "PNG")
    print(f"Icône générée : {chemin} ({taille}x{taille})")


if __name__ == "__main__":
    generer(192, "icons/icon-192.png")
    generer(512, "icons/icon-512.png")
