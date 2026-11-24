"""#34 · Pruebas del filtro con la lista de bd/filtros_iniciales.txt (positivas y negativas).

Solo usa la biblioteca estándar. Comprueba que:
  - POSITIVAS: cada término activo del léxico (docs/moderacion/lexico_25n.txt) sigue reteniéndose
    (y como «Palabra filtrada», nunca rebajado a cuarentena) aunque la lista generada haya quitado los
    redundantes; que se detectan los ataques y trucos de escritura de ATAQUES (español, francés e
    inglés), y que los términos #~ y los textos de CUARENTENA quedan en cuarentena;
  - EMOJIS (#36): las filas a/b de la tabla de emojis del léxico se retienen; las c, solas, no;
  - NEGATIVAS: no salta con las excepciones del léxico (líneas #!: computadora, Maricarmen,
    therapist, Essex, «tengo 18 años», lemas del 25N...) ni con los mensajes legítimos de LEGITIMOS.

Uso (desde la carpeta del repositorio):
    python herramientas/probar_filtro.py      # resumen
    python herramientas/probar_filtro.py -v   # muestra también qué término salta en cada positiva

Sale con código 0 si todo pasa y 1 si algo falla. Pásalo siempre que cambies el léxico o bd/filtro.py.
"""

import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from bd.db import leer_linea_filtro  # noqa: E402
from bd.filtro import Filtro, limpiar_termino  # noqa: E402

LEXICO = RAIZ / "docs" / "moderacion" / "lexico_25n.txt"
FILTROS = RAIZ / "bd" / "filtros_iniciales.txt"

# Excepciones del léxico (#!) que la importación básica SÍ retiene a propósito: la guía
# (docs/moderacion/guia_moderacion.md) acepta que «puta caso», en italiano, quede para revisión.
FALSOS_POSITIVOS_ACEPTADOS = {"puta caso"}

ATAQUES = [
    # trucos de escritura que cubre el normalizador
    "z0rra", "Eres una p.u.t.a", "P U T A", "putaaaaa", "ZORRAS", "hijo de p-u-t-a", "g1l1p0llas",
    "Te voy a ma tar", "eres un marikon", "sudacas fuera", "feminazis",
    # español
    "Las víctimas se lo inventan", "si no eres mía no serás de nadie", "eres un gay de mierda",
    "vete a la cocina", "algo habrá hecho", "te voy a dar una paliza", "manda nudes",
    # francés
    "Nique ta mère", "FILS DE PUTE", "sale pute", "ferme ta gueule", "je vais te tuer", "connard",
    # inglés
    "STFU puta", "go fuck yourself", "you are a slut", "i will kill you", "kys",
    # los insultos claros de la familia maric* se retienen, no van a cuarentena
    "eres un maricón", "MARICONES", "mariconazo",
    # #36: números y símbolos de odio (la guía acepta que «se construyó en 1488» quede para revisión)
    "1488", "14/88", "14-88", "88 14 1488", "卐", "Combat 18", "6MWE", "El edificio se construyó en 1488",
]

# Términos ambiguos (#~): se retienen, pero como cuarentena (posible falso positivo).
CUARENTENA = [
    "el puto machismo", "eres un imbécil", "se lo buscó", "maricona", "mariconcete",
    "La clase va retrasada por la manifestación",
    # #36: combinaciones de emojis (con cualquier tono de piel y con espacios entre medias)
    "👉👌", "👉🏽👌🏻", "👉🏿 👌🏿", "🍆🍑", "🍆 🍑 💦", "🖕", "🖕🏿 al maltrato", "🐒🐒🐒", "🔪🩸",
    "Receta de berenjena y melocotón 🍆🍑",
]

LEGITIMOS = [
    # ejemplos de la guía de moderación
    "La computadora de Maricarmen",
    "No fue tu culpa. Yo también sufrí acoso",
    "Quiero que hablemos de denuncias falsas con datos",
    "Estoy con mi compañera. Tengo 18 años",
    "Llama al 016 si necesitas información",
    "Ni una menos 💜",
    # exabruptos que pasan a reglas contextuales: no se retienen solos
    "Basta ya de esta mierda de violencia",
    "Joder, ya está bien",
    "Putain, ça suffit",
    "Merde alors, on continue",
    "Qué idiota fui al no denunciar antes",
    # palabras de la campaña y vocabulario corriente
    "Hermana, yo sí te creo",
    "La violencia machista mata: denuncia el maltrato",
    "Mi disputa con la diputada no tiene que ver con su reputación",
    "Sobreviví a una violación y hoy estoy aquí",
    # excepciones de un prefijo en cuarentena (maric*): nombres y oficios
    "Maricarmen, Maricruz y Maricela vienen a la marcha", "M4ricarmen", "La maricultura en Galicia",
    "Thank you for the class, the therapist was great",
    "Je suis député et je soutiens la campagne",
    "Respect for every woman in Essex and Sussex",
    # #36: emojis inocentes y números corrientes
    "Ni una menos 💜💜💜", "Berenjenas al horno 🍆", "¿Taller de nudos? 🪢", "Mucha fuerza 🔥🔥💪🏽",
    "🏳️‍🌈 Orgullo y respeto 🏳️‍⚧️", "👍🏾 bien dicho", "Tengo 18 años y estoy en el curso 88",
    "El 14 de noviembre salimos a la calle", "Página 69 del libro", "Somos 1.488 personas en la marcha",
    "Llama al 016 o al 112", "Hay 21488 firmas",
]

# Con la regla de teléfonos encendida: los públicos de ayuda pasan, uno privado no.
TELEFONOS_PUBLICOS = ["Llama al 016 o escribe al WhatsApp 600 000 016", "Su WhatsApp es +34 600000016"]
TELEFONO_PRIVADO = "Escríbeme al 612 345 678"


def cargar_filtro():
    filas = [f for f in map(leer_linea_filtro, FILTROS.read_text(encoding="utf-8").splitlines()) if f]
    por_tipo = {tipo: [t for t, ti in filas if ti == tipo] for tipo in ("bloqueo", "cuarentena", "excepcion")}
    return Filtro(por_tipo["bloqueo"], cuarentena=por_tipo["cuarentena"], excepciones=por_tipo["excepcion"],
                  enlaces=False, correos=False, telefonos=False, usuarios=False)


def entradas_lexico(prefijo):
    """Términos del léxico de las líneas que empiezan por prefijo ('' = activas)."""
    salida = []
    for linea in LEXICO.read_text(encoding="utf-8").splitlines():
        if not linea.strip():
            continue
        if prefijo:
            if not linea.startswith(prefijo + " "):
                continue
            linea = linea[len(prefijo) + 1:]
        elif linea.startswith("#"):
            continue
        salida.append(linea.split(" # ", 1)[0].strip().strip('"'))
    return salida


def filas_emoji():
    """[(emoji, clase)] de la tabla de emojis del léxico."""
    filas = []
    for linea in LEXICO.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^# (\S+) \| .* \| ([abc])$", linea)
        if m and not re.search(r"[a-z]", m.group(1)):
            filas.append(m.groups())
    return filas


def main(args):
    verbose = "-v" in args
    filtro = cargar_filtro()
    fallos = []

    activos = [t for t in entradas_lexico("") if limpiar_termino(t.replace("'", ""))]
    for termino in activos:
        motivo = filtro.motivo(termino.rstrip("*"))
        if not motivo or not motivo.startswith("Palabra filtrada"):
            fallos.append(f"NO retiene un término activo del léxico: {termino!r} -> {motivo}")
    cuarentena = [t for t in entradas_lexico("#~") if limpiar_termino(t)]
    for texto in [t.rstrip("*") for t in cuarentena] + CUARENTENA:
        motivo = filtro.motivo(texto)
        if not motivo or not motivo.startswith("Cuarentena"):
            fallos.append(f"NO pone en cuarentena: {texto!r} -> {motivo}")
        elif verbose:
            print(f"  ok  {texto!r:45} -> {motivo}")
    for texto in ATAQUES:
        motivo = filtro.motivo(texto)
        if not motivo:
            fallos.append(f"NO detecta el ataque: {texto!r}")
        elif verbose:
            print(f"  ok  {texto!r:45} -> {motivo}")

    excepciones = [t for t in entradas_lexico("#!") if t not in FALSOS_POSITIVOS_ACEPTADOS]
    for texto in excepciones + LEGITIMOS:
        motivo = filtro.motivo(texto)
        if motivo:
            fallos.append(f"Falso positivo en {texto!r}: {motivo}")

    emojis = filas_emoji()
    for emoji, clase in emojis:
        motivo = filtro.motivo(emoji)
        if clase in "ab" and not motivo:
            fallos.append(f"NO retiene el emoji de clase {clase}: {emoji}")
        if clase == "c" and motivo:
            fallos.append(f"Retiene el emoji de clase c (inocente casi siempre): {emoji} -> {motivo}")

    con_telefonos = Filtro(filtro.terminos, cuarentena=filtro.cuarentena, excepciones=filtro.excepciones,
                           enlaces=False, correos=False, telefonos=True, usuarios=False)
    for texto in TELEFONOS_PUBLICOS:
        if con_telefonos.motivo(texto):
            fallos.append(f"Falso positivo en un teléfono público de ayuda: {texto!r}")
    if not con_telefonos.motivo(TELEFONO_PRIVADO):
        fallos.append(f"NO detecta el teléfono privado: {TELEFONO_PRIVADO!r}")

    n_cuarentena = len(cuarentena) + len(CUARENTENA)
    total = (len(activos) + len(ATAQUES) + n_cuarentena + len(excepciones) + len(LEGITIMOS)
             + len(TELEFONOS_PUBLICOS) + 1 + len(emojis))
    for f in fallos:
        print("FALLO", f)
    print(f"{total - len(fallos)}/{total} pruebas correctas "
          f"({len(activos)} términos del léxico, {len(ATAQUES)} ataques, {n_cuarentena} de cuarentena, "
          f"{len(excepciones)} excepciones, {len(LEGITIMOS)} mensajes legítimos, "
          f"{len(TELEFONOS_PUBLICOS) + 1} de teléfonos y {len(emojis)} filas de la tabla de emojis).")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
