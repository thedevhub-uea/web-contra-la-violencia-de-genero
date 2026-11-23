"""#34 · Genera bd/filtros_iniciales.txt a partir del léxico de moderación (docs/moderacion/lexico_25n.txt).

Solo usa la biblioteca estándar y bd/. Del léxico se toman:
  - las líneas activas (sin # delante)      -> retener («bloqueo»)
  - las líneas #~                           -> cuarentena: retienen, avisando de posible falso positivo
  - las líneas #! que algún término de arriba retendría por error -> excepciones (Maricarmen frente a maric*)
Las reglas contextuales (#?) y la tabla de emojis no se cargan (ver docs/moderacion/README.md).

Además:
  - descarta los términos que el filtro no admite (números, símbolos, emojis, apóstrofos) y los lista;
  - quita los términos redundantes: los que ya detecta otro término de la lista
    (p. ej. «gay de mierda» ya salta por «de mierda», y «putaaa» por «puta»).

Uso (desde la carpeta del repositorio):
    python herramientas/generar_filtros.py              # reescribe bd/filtros_iniciales.txt
    python herramientas/generar_filtros.py -v           # y lista los redundantes quitados
    python herramientas/generar_filtros.py --comprobar  # sale con 1 si el fichero no está al día
    python herramientas/generar_filtros.py --bd         # lleva la lista a una base de datos que ya existe

bd/filtros_iniciales.txt solo se carga la primera vez que se crea la base de datos. En una base de
datos que ya existe (producción), usa --bd: añade los términos que falten, cambia el tipo de los que
lo tengan distinto (p. ej. «puto» pasa de retener a cuarentena) y lista los que están en la base de
datos pero no en la lista, para revisarlos a mano desde el panel. No borra nada.
"""

import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from bd.filtro import Filtro, limpiar_termino, normalizar  # noqa: E402

LEXICO = RAIZ / "docs" / "moderacion" / "lexico_25n.txt"
SALIDA = RAIZ / "bd" / "filtros_iniciales.txt"
PREFIJO = {"bloqueo": "", "cuarentena": "~", "excepcion": "!"}

CABECERA = """\
# Lista inicial del filtro. Se carga UNA vez, la primera vez que arranca el servidor.
# Después se gestiona desde el panel (/admin, «Filtro automático»); cambiar este archivo ya no tiene efecto
# (para llevarlo a una base de datos que ya existe: python herramientas/generar_filtros.py --bd).
#
# NO EDITAR A MANO: se genera con `python herramientas/generar_filtros.py` a partir de
# docs/moderacion/lexico_25n.txt (español, francés e inglés). Para añadir o quitar términos,
# edita el léxico y vuelve a generar. Cómo hacerlo: docs/moderacion/README.md
#
# Una línea por término. Sin tildes ni mayúsculas (da igual cómo lo escriban).
#   palabra       retener: la palabra entera, con plural y escrita con trucos (p.u.t.a, z0rra, zorraaa)
#   palabra*      cualquier palabra que empiece así
#   dos palabras  expresión completa
#   ~palabra      cuarentena: también se retiene, pero avisando de que puede ser un falso positivo
#   !palabra      excepción: nunca cuenta como coincidencia (maricarmen frente a ~maric*)
#
# Ojo: palabras como "violencia", "violación", "matar" o "maltrato" aparecen en mensajes
# legítimos del 25N. No las pongas solas; usa expresiones concretas ("te voy a matar").
"""


def _filtro(bloqueo=(), cuarentena=(), excepciones=()):
    return Filtro(sorted(bloqueo), cuarentena=sorted(cuarentena), excepciones=sorted(excepciones),
                  enlaces=False, correos=False, telefonos=False, usuarios=False)


def leer_lexico(ruta=LEXICO):
    """[(seccion, termino_original, tipo)] del léxico, en orden. tipo: bloqueo | cuarentena | excepcion."""
    entradas, seccion = [], ""
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        if not linea.strip():
            continue
        if linea.startswith("#~ "):
            tipo, linea = "cuarentena", linea[3:]
        elif linea.startswith("#! "):
            tipo, linea = "excepcion", linea[3:]
        elif linea.startswith("#"):
            # Título de sección: «# español: ...». Las fuentes empiezan por «# [».
            if linea.startswith("# ") and not linea.startswith("# [") and ":" in linea \
                    and " | " not in linea:
                seccion = linea[2:].strip()
            continue
        else:
            tipo = "bloqueo"
        entradas.append((seccion, linea.split(" # ", 1)[0].strip().strip('"'), tipo))
    return entradas


def _quitar_redundantes(terminos, cubre):
    """Quita de terminos los que ya detecta otro término (cubre(otros) -> Filtro).
    Se prueban primero los más largos: así se queda el general («de mierda») y no el concreto."""
    quedan, redundantes = set(terminos), []
    for termino in sorted(terminos, key=lambda t: (-len(t), t)):
        if cubre(quedan - {termino}).motivo(termino.rstrip("*")):
            quedan.discard(termino)
            redundantes.append(termino)
    return quedan, redundantes


def generar(ruta=LEXICO):
    """Devuelve (secciones, rechazados, redundantes). secciones = [(titulo, [(termino, tipo)])]."""
    entradas, rechazados, vistos = [], [], {}
    for seccion, original, tipo in leer_lexico(ruta):
        # Se normaliza igual que los mensajes: «f u c k» se compara como «fuck», así que un término
        # con las letras separadas nunca saltaría. Los que llevan números se rechazan antes:
        # normalizar los cambiaría («88» -> «bb»).
        limpio = None if any(c.isdigit() for c in original) else limpiar_termino(normalizar(original))
        if limpio is None:
            if tipo != "excepcion":
                rechazados.append(original)
        elif limpio not in vistos:
            vistos[limpio] = tipo
            entradas.append((seccion, limpio))

    bloqueo = {t for t, tipo in vistos.items() if tipo == "bloqueo"}
    cuarentena = {t for t, tipo in vistos.items() if tipo == "cuarentena"}
    # Solo hacen falta las excepciones que algún término retendría (el resto ya pasa sin ellas).
    # Solo de una palabra: son las que chocan con un prefijo (maricarmen frente a maric*). Las de
    # varias palabras dependen del contexto (puta caso solo es excepción en italiano) y se quedan
    # como pruebas negativas.
    sin_excepciones = _filtro(bloqueo, cuarentena)
    excepciones = {t for t, tipo in vistos.items()
                   if tipo == "excepcion" and " " not in t and sin_excepciones.motivo(t)}

    # Un término de retener nunca se quita por una cuarentena (sería rebajarlo); una cuarentena
    # sí sobra si ya la retiene un término de retener.
    bloqueo, red_b = _quitar_redundantes(bloqueo, lambda otros: _filtro(otros, (), excepciones))
    cuarentena, red_c = _quitar_redundantes(cuarentena, lambda otros: _filtro(bloqueo, otros, excepciones))

    tipos = {**{t: "bloqueo" for t in bloqueo}, **{t: "cuarentena" for t in cuarentena},
             **{t: "excepcion" for t in excepciones}}
    secciones = []
    for seccion, termino in entradas:
        if termino not in tipos:
            continue
        if tipos[termino] == "excepcion":
            seccion = "excepciones: palabras que nunca se retienen aunque otro término las cubra"
        if not secciones or secciones[-1][0] != seccion:
            secciones.append((seccion, []))
        secciones[-1][1].append((termino, tipos[termino]))
    # Las excepciones, todas juntas al final.
    secciones.sort(key=lambda s: s[1][0][1] == "excepcion")
    return secciones, rechazados, sorted(red_b + red_c)


def texto_salida(secciones):
    partes = [CABECERA]
    for titulo, terminos in secciones:
        lineas = "\n".join(PREFIJO[tipo] + termino for termino, tipo in terminos)
        partes.append(f"\n# {titulo[:1].upper()}{titulo[1:]}\n{lineas}\n")
    return "".join(partes)


def importar_en_bd(terminos):
    """terminos = [(termino, tipo)]. Añade, cambia tipos y lista lo que sobra; no borra nada."""
    from bd import db
    db.init_db()
    antes = {f["termino"]: f["tipo"] for f in db.listar_filtros()}
    anadidos = [t for t, tipo in terminos if t not in antes and db.anadir_filtro(t, tipo)[1] is None]
    cambiados = [f"{t} ({antes[t]} -> {tipo})" for t, tipo in terminos
                 if t in antes and antes[t] != tipo and db.cambiar_tipo_filtro(t, tipo)]
    print(f"Añadidos a la base de datos: {len(anadidos)} términos nuevos.")
    if cambiados:
        print(f"Cambiado el tipo de {len(cambiados)}:")
        print("    " + ", ".join(cambiados))

    nuevos = dict(terminos)
    nuevo = _filtro([t for t, tipo in terminos if tipo == "bloqueo"],
                    [t for t, tipo in terminos if tipo == "cuarentena"],
                    [t for t, tipo in terminos if tipo == "excepcion"])
    sobran = sorted(t for t in antes if t not in nuevos)
    cubiertos = [t for t in sobran if nuevo.motivo(t.rstrip("*"))]
    fuera = [t for t in sobran if t not in cubiertos]
    if cubiertos:
        print("Sobran porque ya los detecta otro término (se pueden quitar en /admin):")
        print("    " + ", ".join(cubiertos))
    if fuera:
        print("No están en la lista generada (añadidos a mano o ya no activos en el léxico).")
        print("No se han borrado: decide en /admin si los quitas.")
        print("    " + ", ".join(fuera))


def main(args):
    secciones, rechazados, redundantes = generar()
    terminos = [par for _, pares in secciones for par in pares]
    contenido = texto_salida(secciones)
    cuenta = {tipo: sum(1 for _, t in terminos if t == tipo) for tipo in PREFIJO}
    resumen = (f"{len(terminos)} términos: {cuenta['bloqueo']} retener, {cuenta['cuarentena']} cuarentena, "
               f"{cuenta['excepcion']} excepciones")

    if "--comprobar" in args:
        actual = SALIDA.read_text(encoding="utf-8") if SALIDA.exists() else ""
        if actual != contenido:
            print("bd/filtros_iniciales.txt no está al día: ejecuta python herramientas/generar_filtros.py")
            return 1
        print(f"bd/filtros_iniciales.txt al día ({resumen}).")
        return 0

    if "--bd" in args:
        importar_en_bd(terminos)
        return 0

    SALIDA.write_text(contenido, encoding="utf-8", newline="\n")
    print(f"Escrito {SALIDA.relative_to(RAIZ)}: {resumen}.")
    print(f"Redundantes quitados: {len(redundantes)}" + ("" if "-v" in args else " (-v para verlos)"))
    if "-v" in args:
        print("    " + ", ".join(redundantes))
    if rechazados:
        print(f"No admitidos por el filtro ({len(rechazados)}), van aparte (números, símbolos, emojis: #36):")
        print("    " + ", ".join(rechazados))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
