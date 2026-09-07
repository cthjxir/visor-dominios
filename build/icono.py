"""Convierte escudo.png en los iconos de la app (mac/win/linux).

El escudo es vertical y los destinos son cuadrados, así que se centra sobre
un lienzo blanco (el escudo es línea negra; en transparente desaparecería
sobre un dock/taskbar oscuro).

    /Users/dti/Herd/generador-versiones-publicas/.venv/bin/python icono.py
    iconutil -c icns icon.iconset -o icon.icns
"""
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).parent
ORIGEN = RAIZ / "escudo.png"
LADO = 1024
MARGEN = 0.02
FONDO = (255, 255, 255, 255)
TAMANOS_ICNS = (16, 32, 64, 128, 256, 512, 1024)


def cuadrar(origen: Path, lado: int, margen: float) -> Image.Image:
    escudo = Image.open(origen).convert("RGBA")
    plano = Image.new("RGBA", escudo.size, FONDO)
    plano.alpha_composite(escudo)
    plano.thumbnail((int(lado * (1 - 2 * margen)),) * 2, Image.LANCZOS)
    lienzo = Image.new("RGBA", (lado, lado), FONDO)
    lienzo.paste(plano, ((lado - plano.width) // 2, (lado - plano.height) // 2), plano)
    return lienzo


if __name__ == "__main__":
    if not ORIGEN.exists():
        raise SystemExit(f"Falta {ORIGEN.name}: coloque el escudo en {RAIZ}")

    icono = cuadrar(ORIGEN, LADO, MARGEN)
    icono.convert("RGB").save(RAIZ / "icon.png")
    icono.save(RAIZ / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])

    iconset = RAIZ / "icon.iconset"
    iconset.mkdir(exist_ok=True)
    for tam in TAMANOS_ICNS:
        cuadrar(ORIGEN, tam, MARGEN).convert("RGB").save(iconset / f"icon_{tam}x{tam}.png")
        if tam <= 512:
            cuadrar(ORIGEN, tam * 2, MARGEN).convert("RGB").save(iconset / f"icon_{tam}x{tam}@2x.png")

    print("Generados icon.png, icon.ico e icon.iconset/ (falta: iconutil -c icns icon.iconset -o icon.icns)")
