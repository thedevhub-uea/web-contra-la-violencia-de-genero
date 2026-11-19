"""T13 · Comprueba el contraste de los pares texto/fondo de static/css/paleta.css.

Solo usa la biblioteca estándar (como generar_qr.py). Lee de paleta.css:
  - los colores declarados en :root: `--x: #rrggbb;`, tripletas `--x-rgb: r g b;`,
    `--x: rgb(var(--x-rgb));` y alias `--x: var(--y);`
  - los pares a comprobar, escritos en comentarios con la forma
        @par --texto --fondo            (texto normal: mínimo 4,5:1)
        @par --aro-color --fondo grande (texto grande o trazo: mínimo 3:1)

«Grande» = texto de al menos 24 px, o de 18,66 px en negrita, o un elemento gráfico (WCAG 2.1).

Uso (desde la carpeta del repositorio):
    python herramientas/comprobar_contraste.py            # comprueba static/css/paleta.css
    python herramientas/comprobar_contraste.py otra.css   # otra hoja
    python herramientas/comprobar_contraste.py -v         # muestra también los pares que pasan

Sale con código 0 si todos los pares cumplen, 1 si alguno falla (o hay un error de lectura).
Pasa a ser un paso obligatorio al tocar la paleta (ver README y docs/DESPLIEGUE.md).
"""

import re
import sys
from pathlib import Path

RUTA_POR_DEFECTO = Path(__file__).resolve().parent.parent / "static" / "css" / "paleta.css"
MINIMO_NORMAL = 4.5
MINIMO_GRANDE = 3.0

RE_DECLARACION = re.compile(r"(--[\w-]+)\s*:\s*([^;]+);")
RE_PAR = re.compile(r"@par\s+(--[\w-]+)\s+(--[\w-]+)(?:\s+(grande))?")
RE_HEX = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
RE_TRIPLETA = re.compile(r"^(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})$")
RE_RGB_VAR = re.compile(r"^rgb\(\s*var\((--[\w-]+)\)\s*\)$")
RE_VAR = re.compile(r"^var\((--[\w-]+)\)$")


def leer_variables(css):
    """Devuelve {nombre: valor_sin_resolver} con las declaraciones de variables."""
    sin_comentarios = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    return {nombre: valor.strip() for nombre, valor in RE_DECLARACION.findall(sin_comentarios)}


def resolver(nombre, variables, visitadas=()):
    """Devuelve (r, g, b) del color `nombre`, siguiendo alias y tripletas."""
    if nombre in visitadas:
        raise ValueError(f"referencia circular en {nombre}")
    if nombre not in variables:
        raise ValueError(f"{nombre} no está declarada")
    valor = variables[nombre]
    visitadas = visitadas + (nombre,)

    m = RE_HEX.match(valor)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    m = RE_TRIPLETA.match(valor)
    if m:
        return tuple(int(g) for g in m.groups())
    m = RE_RGB_VAR.match(valor) or RE_VAR.match(valor)
    if m:
        return resolver(m.group(1), variables, visitadas)
    raise ValueError(f"{nombre}: no sé leer «{valor}» (usa #hex, «r g b» o var(--otra))")


def luminancia(rgb):
    def canal(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (canal(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contraste(a, b):
    la, lb = luminancia(a), luminancia(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # la consola de Windows no usa UTF-8 por defecto
    verbose = "-v" in argv
    rutas = [a for a in argv[1:] if not a.startswith("-")]
    ruta = Path(rutas[0]) if rutas else RUTA_POR_DEFECTO
    try:
        css = ruta.read_text(encoding="utf-8")
    except OSError as e:
        print(f"No puedo leer {ruta}: {e}")
        return 1

    variables = leer_variables(css)
    pares = RE_PAR.findall(css)
    if not pares:
        print(f"{ruta}: no hay ningún «@par --texto --fondo» que comprobar.")
        return 1

    fallos = 0
    for texto, fondo, grande in pares:
        minimo = MINIMO_GRANDE if grande else MINIMO_NORMAL
        try:
            razon = contraste(resolver(texto, variables), resolver(fondo, variables))
        except ValueError as e:
            print(f"ERROR  {texto} sobre {fondo}: {e}")
            fallos += 1
            continue
        bien = razon >= minimo
        if not bien:
            fallos += 1
        if verbose or not bien:
            marca = "ok    " if bien else "FALLA "
            print(f"{marca} {texto} sobre {fondo}: {razon:.2f}:1 (mínimo {minimo:g}:1{', grande' if grande else ''})")

    if fallos:
        print(f"\n{fallos} de {len(pares)} pares NO cumplen.")
        return 1
    print(f"Contraste correcto: {len(pares)} pares comprobados en {ruta.name}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
