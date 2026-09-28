"""
Génère les icônes de l'app (écran d'accueil) à partir de icons/source-taureau.jpg :
carré centré sur le taureau, éclairci pour qu'il se voie bien sur un petit écran.
Usage : python icone_taureau.py   (écrit icons/icon-192.png, icon-512.png, apple-touch-icon.png)
"""
from pathlib import Path
from PIL import Image, ImageEnhance, ImageOps

ICI = Path(__file__).parent / "icons"
# Zone gardée dans l'image d'origine (334 × 598) : le taureau et le haut du graphique.
CADRE = (27, 318, 307, 598)  # gauche, haut, droite, bas → carré de 280 px


def preparer():
    img = Image.open(ICI / "source-taureau.jpg").convert("RGB").crop(CADRE)
    # Éclaircit les zones sombres (gamma) sans brûler le doré, puis un peu de contraste.
    img = img.point(lambda v: int(255 * (v / 255) ** 0.72))
    img = ImageEnhance.Contrast(img).enhance(1.15)
    img = ImageEnhance.Sharpness(img).enhance(1.4)
    return img


def main():
    base = preparer()
    for taille, nom in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")]:
        base.resize((taille, taille), Image.LANCZOS).save(ICI / nom, optimize=True)
        print("écrit", nom)


if __name__ == "__main__":
    main()
