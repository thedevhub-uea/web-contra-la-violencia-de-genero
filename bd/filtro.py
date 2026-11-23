"""T03 — Filtro automático de contenido (palabras y datos personales).

Funciones puras (sin Flask ni base de datos) para poder probarlas solas:

    filtro = Filtro(["puta", "maric*", "a fregar"], enlaces=True, correos=True,
                    telefonos=True, usuarios=True)
    filtro.motivo("Eres una p.u.t.a")   ->  'Palabra filtrada: «puta»'
    filtro.motivo("Ni una menos")       ->  None

Cómo se escribe un término del filtro:
    zorra        la palabra entera, con sus plurales (zorras) y escrita con trucos:
                 mayúsculas, tildes, letras repetidas (zorraaa), números por letras
                 (z0rra), separadores entre letras (z.o.r.r.a, z-o-r-r-a, z o r r a).
                 Un número o símbolo en lugar de una vocal vale por CUALQUIER vocal:
                 p4ta, p0ta, p3ta, p*ta y p@ta cuentan como «puta» (pero «pata», escrito
                 con letras, no).
    maric*       cualquier palabra que empiece así (maricón, maricones, mariconazo...).
    a fregar     una expresión de varias palabras.
No hace falta escribir tildes: "maricon" ya cubre "maricón".
"""
import re
import unicodedata

# Sustituciones típicas para esquivar filtros (z0rra, put@, p4ta, 5ubnormal...).
# Lo que suele ponerse en lugar de una vocal se convierte en COMODIN, que en los patrones
# vale por cualquier vocal: así p4ta (4 = «a») también se detecta como «puta».
# Si se tradujera a su vocal (4 → a) quedaría «pata» y no coincidiría.
COMODIN = "0"
_LEET = str.maketrans({"0": COMODIN, "1": COMODIN, "3": COMODIN, "4": COMODIN, "@": COMODIN,
                       "€": COMODIN, "!": COMODIN, "|": COMODIN,
                       "5": "s", "7": "t", "8": "b", "$": "s"})
_VOCALES = "aeiou"
# Caracteres que alguien puede meter entre las letras de una palabra: p.u.t.a, p-u-t-a, p*u*t*a
_SEP = r"[._\-*~+'\"`´·,:;/\\]{0,2}"
# Letras sueltas separadas por espacios: "p u t a" -> "puta"
_LETRAS_SUELTAS = re.compile(r"(?<![a-z0-9])(?:[a-z0-9] +){2,}[a-z0-9](?![a-z0-9])")

TERMINO_VALIDO = re.compile(r"^[a-zñáéíóúü]+(?: [a-zñáéíóúü]+)*\*?$")

_ENLACE = re.compile(r"https?://|www\.|\b[a-z0-9-]{2,}\.(?:com|es|net|org|io|ly|me|tv|gg|info|link|xyz|app|co)\b", re.I)
_CORREO = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_TELEFONO = re.compile(r"(?<!\d)(?:\+?\d[\s.\-]?){9,}(?!\d)")
_USUARIO = re.compile(r"(?<![\w@])@[a-z0-9_.]{3,}", re.I)


def sin_tildes(texto):
    return "".join(c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c))


def normalizar(texto):
    """Minúsculas, sin tildes, números de "leet" a letras y letras sueltas unidas."""
    t = sin_tildes(texto).lower().translate(_LEET)
    t = re.sub(r"\s+", " ", t)
    return _LETRAS_SUELTAS.sub(lambda m: m.group(0).replace(" ", ""), t)


def limpiar_termino(termino):
    """Forma en la que se guarda un término: minúsculas, sin tildes, espacios simples.
    Solo letras, espacios y un * final. Devuelve None si no es válido."""
    t = re.sub(r"\s+", " ", (termino or "").strip().lower())
    if not (2 <= len(t.rstrip("*")) <= 60) or not TERMINO_VALIDO.match(t):
        return None
    t = sin_tildes(t)
    if not re.match(r"^[a-z]+(?: [a-z]+)*\*?$", t):
        return None
    return t


def _patron_letra(c):
    # Una vocal también puede estar escrita con el comodín (p4ta, p0ta) o con un * (p*ta).
    if c in _VOCALES:
        return "[" + c + COMODIN + r"*]+"
    return re.escape(c) + "+"


def _patron_palabra(palabra):
    # cada letra puede repetirse (zorraaa) y llevar separadores entre medias (z.o.r.r.a)
    letras = [_patron_letra(c) for c in normalizar(palabra)]
    return _SEP.join(letras)


def _patron(termino):
    prefijo = termino.endswith("*")
    palabras = termino.rstrip("*").split(" ")
    cuerpo = r"\s+".join(_patron_palabra(p) for p in palabras)
    fin = r"[a-z0-9]*" if prefijo else r"(?:e?s)?(?![a-z0-9])"
    return r"(?<![a-z0-9])" + cuerpo + fin




class Filtro:
    """terminos:    retienen el mensaje («Palabra filtrada: «x»»).
    cuarentena:  términos ambiguos; también retienen, pero con otro motivo («Cuarentena: «x»»)
                 para que moderación sepa que puede ser un falso positivo (p. ej. «el puto machismo»).
    excepciones: palabras que nunca cuentan como coincidencia aunque un término las cubra
                 (sobre todo los prefijos: «maric*» no retiene «Maricarmen» si es excepción)."""

    def __init__(self, terminos=(), enlaces=True, correos=True, telefonos=True, usuarios=True,
                 cuarentena=(), excepciones=()):
        self.terminos = [t for t in terminos if t]
        self.cuarentena = [t for t in cuarentena if t]
        self.excepciones = [t for t in excepciones if t]
        self.reglas = {"enlaces": enlaces, "correos": correos, "telefonos": telefonos, "usuarios": usuarios}
        self._patrones = [(t, re.compile(_patron(t))) for t in self.terminos]
        self._patrones_cuarentena = [(t, re.compile(_patron(t))) for t in self.cuarentena]
        # Una excepción se busca como cualquier término (palabra entera, plural y trucos):
        # «maricarmen» salva «Maricarmen» o «M4ricarmen», pero no «maricarmenazo».
        self._patrones_excepcion = [re.compile(_patron(e)) for e in self.excepciones]

    def _coincide(self, patron, normal, zonas_excepcion):
        """True si el patrón aparece en el texto fuera de las zonas cubiertas por una excepción."""
        for m in patron.finditer(normal):
            if not any(ini <= m.start() and m.end() <= fin for ini, fin in zonas_excepcion):
                return True
        return False

    def motivo(self, *textos):
        """Devuelve por qué el texto no puede publicarse, o None si puede."""
        original = "\n".join(t or "" for t in textos)
        if self.reglas["correos"] and _CORREO.search(original):
            return "Contiene un correo electrónico"
        if self.reglas["enlaces"] and _ENLACE.search(original):
            return "Contiene un enlace"
        if self.reglas["telefonos"] and _TELEFONO.search(original):
            return "Contiene un número de teléfono"
        if self.reglas["usuarios"] and _USUARIO.search(original):
            return "Contiene un @usuario de redes sociales"
        normal = normalizar(original)
        zonas = [m.span() for p in self._patrones_excepcion for m in p.finditer(normal)]
        for termino, patron in self._patrones:
            if self._coincide(patron, normal, zonas):
                return "Palabra filtrada: «%s»" % termino
        for termino, patron in self._patrones_cuarentena:
            if self._coincide(patron, normal, zonas):
                return "Cuarentena: «%s»" % termino
        return None
