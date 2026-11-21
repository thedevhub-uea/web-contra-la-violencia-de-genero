"""CONECTA · validación del estilo de las burbujas del mural (columna mural.style, JSON).

Nunca se acepta CSS ni HTML del usuario: el cliente manda un JSON y aquí se reconstruye un
estilo nuevo, campo a campo, solo con valores de listas blancas, colores #rrggbb y números
dentro de rango. Lo que no valida se descarta y se sustituye por el valor por defecto.
Los mismos valores permitidos están en static/js/estilo-burbuja.js (que dibuja la burbuja).
"""
import json
import re

FORMAS = ("circulo", "cuadrado", "corazon", "nube", "estrella", "hexagono", "gota", "lazo")
FUENTES = ("sans", "serif", "manuscrita", "display", "redonda", "mono")
ANIMACIONES = ("ninguna", "flotar", "latido", "pulso", "brillo")
TAMANOS = ("S", "M", "L")
ALINEACIONES = ("izq", "centro", "der")
ESTILOS_BORDE = ("ninguno", "solido", "discontinuo", "punteado")
POSICIONES_EMOJI = ("centro", "sup-izq", "sup-der", "inf-izq", "inf-der")
TIPOS_FONDO = ("solido", "degradado")
EMOJIS = ("💜", "✊", "🕊️", "🌹", "✨", "🔥", "🦋", "🌸", "🕯️", "📞", "🫂", "⭐", "🌈", "💪", "🛡️", "🤝")

RE_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_JSON = 2000   # bytes: un estilo válido ocupa mucho menos

FONDO_PANTALLA = (7, 6, 13)        # --bg-0: sobre lo que se mezcla la opacidad del fondo
OSCURO, CLARO = "#120a22", "#ffffff"

POR_DEFECTO = {
    "forma": "circulo",
    "fondo": {"tipo": "solido", "c1": "#9b4dff", "c2": "#b0123a", "opacidad": 0.9},
    "texto": {"color": "#ffffff", "fuente": "sans", "tam": "M", "negrita": False,
              "cursiva": False, "alinea": "centro"},
    "borde": {"color": "#c58bff", "grosor": 0, "estilo": "ninguno"},
    "glow": {"color": "#c58bff", "intensidad": 0},
    "sombra": 0,
    "emoji": {"char": "", "pos": "centro"},
    "anim": "flotar",
    "escala": 1.0,
}


def _color(valor, defecto):
    return valor.lower() if isinstance(valor, str) and RE_COLOR.match(valor) else defecto


def _numero(valor, minimo, maximo, defecto):
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or valor != valor:
        return defecto
    return round(min(max(float(valor), minimo), maximo), 2)


def _opcion(valor, permitidos, defecto):
    return valor if isinstance(valor, str) and valor in permitidos else defecto


def _dict(valor):
    return valor if isinstance(valor, dict) else {}


def _luminancia(rgb):
    def canal(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (canal(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _rgb(hexa):
    return tuple(int(hexa[i:i + 2], 16) for i in (1, 3, 5))


def contraste(c1, c2):
    a, b = _luminancia(_rgb(c1)), _luminancia(_rgb(c2))
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def _fondo_efectivo(fondo):
    """Color medio del fondo de la burbuja ya mezclado con la pantalla (según su opacidad)."""
    colores = [_rgb(fondo["c1"])] + ([_rgb(fondo["c2"])] if fondo["tipo"] == "degradado" else [])
    medio = [sum(c[i] for c in colores) / len(colores) for i in range(3)]
    a = fondo["opacidad"]
    mezcla = [round(FONDO_PANTALLA[i] * (1 - a) + medio[i] * a) for i in range(3)]
    return "#%02x%02x%02x" % tuple(mezcla)


def sanear(bruto):
    """Devuelve un estilo completo y seguro a partir de lo que mande el cliente (dict, JSON o None)."""
    if isinstance(bruto, (str, bytes)):
        if len(bruto) > MAX_JSON:
            bruto = None
        else:
            try:
                bruto = json.loads(bruto)
            except (ValueError, TypeError):
                bruto = None
    d = POR_DEFECTO
    e = _dict(bruto)
    fondo, texto, borde = _dict(e.get("fondo")), _dict(e.get("texto")), _dict(e.get("borde"))
    glow, emoji = _dict(e.get("glow")), _dict(e.get("emoji"))
    char = emoji.get("char")
    estilo = {
        "forma": _opcion(e.get("forma"), FORMAS, d["forma"]),
        "fondo": {
            "tipo": _opcion(fondo.get("tipo"), TIPOS_FONDO, "solido"),
            "c1": _color(fondo.get("c1"), d["fondo"]["c1"]),
            "c2": _color(fondo.get("c2"), d["fondo"]["c2"]),
            "opacidad": _numero(fondo.get("opacidad"), 0.35, 1, d["fondo"]["opacidad"]),
        },
        "texto": {
            "color": _color(texto.get("color"), d["texto"]["color"]),
            "fuente": _opcion(texto.get("fuente"), FUENTES, "sans"),
            "tam": _opcion(texto.get("tam"), TAMANOS, "M"),
            "negrita": texto.get("negrita") is True,
            "cursiva": texto.get("cursiva") is True,
            "alinea": _opcion(texto.get("alinea"), ALINEACIONES, "centro"),
        },
        "borde": {
            "color": _color(borde.get("color"), d["borde"]["color"]),
            "grosor": _numero(borde.get("grosor"), 0, 8, 0),
            "estilo": _opcion(borde.get("estilo"), ESTILOS_BORDE, "ninguno"),
        },
        "glow": {"color": _color(glow.get("color"), d["glow"]["color"]),
                 "intensidad": _numero(glow.get("intensidad"), 0, 10, 0)},
        "sombra": _numero(e.get("sombra"), 0, 10, 0),
        "emoji": {"char": char if isinstance(char, str) and char in EMOJIS else "",
                  "pos": _opcion(emoji.get("pos"), POSICIONES_EMOJI, "centro")},
        "anim": _opcion(e.get("anim"), ANIMACIONES, "flotar"),
        "escala": _numero(e.get("escala"), 0.8, 1.3, 1.0),
    }
    # Contraste: si el texto no se lee (< 4,5:1) sobre el fondo, se cambia por el que mejor se lee.
    fondo_ef = _fondo_efectivo(estilo["fondo"])
    if contraste(estilo["texto"]["color"], fondo_ef) < 4.5:
        mejor = max((CLARO, OSCURO), key=lambda c: contraste(c, fondo_ef))
        estilo["texto"]["color"] = mejor
    return estilo


def a_json(bruto):
    """JSON compacto y saneado listo para guardar en mural.style ('{}' = estilo por defecto)."""
    if bruto in (None, "", "{}", {}):
        return "{}"
    return json.dumps(sanear(bruto), ensure_ascii=False, separators=(",", ":"))


def leer(valor):
    """Estilo guardado (texto JSON) → dict saneado, o None si es el estilo por defecto (mensajes antiguos)."""
    if not valor or valor.strip() in ("{}", ""):
        return None
    return sanear(valor)
