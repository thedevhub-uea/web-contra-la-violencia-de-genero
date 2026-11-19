"""Aplicación Flask del proyecto 25N.

Responsables:
- T01: creación de la app, init de la BD, POST /mural, POST /foro, /participa, /gracias
- T02: decorador de HTTP Basic Auth, GET /api/mural, GET /api/foro, GET /pantalla
- T03: GET /admin y POST /admin/<tabla>/<id>/<accion>, más el filtro automático
       (/admin/filtros, /admin/ajustes) y los avisos del público (/avisar)
- i18n: idiomas con Flask-Babel (español y inglés). Textos con _() / _l();
        catálogos en traducciones/ (ver README, «Idiomas»).

Toda la base de datos se usa a través de `bd.db` (no escribir SQL aquí).
"""

import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from functools import wraps

from urllib.parse import urlencode

from babel.dates import format_datetime, format_time
from flask import Flask, Response, abort, jsonify, redirect, render_template, request, url_for
from flask_babel import Babel, get_locale, gettext as _, lazy_gettext as _l, ngettext

from bd import db


# --- T02: HTTP Basic Auth -----------------------------------------------------
# Usuarios y contraseñas solo desde variables de entorno (.env), nunca en el código.
# Rol "admin": /admin, /pantalla y /api/*. Rol "pantalla": /pantalla y /api/*.
# Si falta la contraseña de un rol, ese rol no puede entrar.

def _cuentas():
    """{usuario: (rol, contraseña)} leído en cada petición desde el entorno."""
    cuentas = {}
    for rol, var_usuario, var_pass in (
        ("admin", "ADMIN_USER", "ADMIN_PASS"),
        ("pantalla", "PANTALLA_USER", "PANTALLA_PASS"),
    ):
        usuario = os.environ.get(var_usuario) or rol
        password = os.environ.get(var_pass)
        if password:
            cuentas[usuario] = (rol, password)
    return cuentas


def _rol_autenticado():
    """Devuelve el rol de las credenciales Basic de la petición, o None."""
    auth = request.authorization
    if auth is None or auth.username is None or auth.password is None:
        return None
    cuenta = _cuentas().get(auth.username)
    if cuenta is None:
        return None
    rol, esperada = cuenta
    if hmac.compare_digest(auth.password.encode("utf-8"), esperada.encode("utf-8")):
        return rol
    return None


def requiere_rol(*roles):
    """Decorador: 401 salvo credenciales Basic válidas de uno de los roles indicados."""

    def decorador(vista):
        @wraps(vista)
        def envoltura(*args, **kwargs):
            if _rol_autenticado() not in roles:
                return Response(
                    _("Acceso restringido"),
                    401,
                    {"WWW-Authenticate": 'Basic realm="25N", charset="UTF-8"'},
                )
            return vista(*args, **kwargs)

        return envoltura

    return decorador


# --- T03: moderación ----------------------------------------------------------
# La moderación no aprueba uno por uno: el filtro automático (bd/filtro.py) decide qué
# se publica. El panel muestra lo que el filtro ha retenido y lo que el público ha
# avisado, gestiona la lista de palabras y las reglas, y puede retirar o borrar cualquier cosa.

def _token_csrf():
    """Token que llevan todos los formularios del panel.

    El navegador reenvía solo la autenticación Basic, así que otra web podría enviar
    formularios a /admin en nombre de la moderadora. Este token sale de la contraseña
    de admin (otra web no puede leerlo), así que esos envíos se rechazan.
    """
    usuario = os.environ.get("ADMIN_USER") or "admin"
    clave = os.environ.get("ADMIN_PASS", "")
    return hmac.new(clave.encode("utf-8"), ("csrf-25n:" + usuario).encode("utf-8"),
                    hashlib.sha256).hexdigest()


def _comprobar_csrf():
    if not hmac.compare_digest(request.form.get("csrf", ""), _token_csrf()):
        abort(403)


# Aviso que se muestra en el panel tras cada acción (?hecho=objeto.accion.id&n=retirados).
# Son textos fijos: de la dirección solo se toman números.
# Se traducen al pintarlos (_l = traducción perezosa, en el idioma de cada petición).
_AVISOS_PANEL = {
    ("mural", "mostrar"): _l("Mensaje #%(id)s publicado. Se verá en la pantalla en la próxima actualización."),
    ("mural", "ocultar"): _l("Mensaje #%(id)s retirado de la pantalla."),
    ("mural", "borrar"): _l("Mensaje #%(id)s borrado."),
    ("foro", "aprobar"): _l("Reflexión #%(id)s publicada. Se verá en la pantalla en la próxima actualización."),
    ("foro", "retirar"): _l("Reflexión #%(id)s retirada de la pantalla."),
    ("foro", "borrar"): _l("Reflexión #%(id)s borrada."),
    ("filtro", "anadido"): _l("Añadido al filtro: «%(termino)s».%(retirados)s"),
    ("filtro", "quitado"): _l("Término quitado del filtro."),
    ("filtro", "invalido"): _l("No se ha añadido: usa solo letras y espacios (de 2 a 60), con * al final si quieres."),
    ("filtro", "repetido"): _l("Ese término ya estaba en el filtro."),
    ("ajustes", "guardados"): _l("Ajustes guardados.%(retirados)s"),
    ("pantalla", "saltar"): _l("La pantalla salta a «%(vista)s» y después sigue la rotación."),
    ("pantalla", "fijar"): _l("La pantalla se queda en «%(vista)s» hasta que vuelvas a la rotación automática."),
    ("pantalla", "soltar"): _l("La pantalla vuelve a la rotación automática."),
}
# Nombre de cada vista de /pantalla en el panel. En ?hecho=pantalla.<accion>.<n> va su posición.
_NOMBRES_VISTAS = {"mural": _l("Mural"), "video": _l("Vídeo"), "foro": _l("Foro")}

# Preguntas del foro: son las ÚNICAS de las que se puede hablar. Quien participa elige una
# (el formulario manda su número, 1-5) y la reflexión se guarda con su «titulo», que es lo que
# sale en la pantalla (máx. 80 caracteres, igual que el CHECK de bd/schema.sql).
# «texto» es la pregunta completa que se ve en el formulario (traducible).
PREGUNTAS_FORO = (
    {"titulo": "¿Qué piensas de la utilidad del feminismo hoy en día?",
     "texto": _l("¿Qué piensas de la utilidad del feminismo hoy en día?")},
    {"titulo": "¿Cómo actuarías tú en ese lugar?",
     "texto": _l("¿Cómo actuarías tú en ese lugar?")},
    {"titulo": "¿Qué le dirías a una persona que está pasando algo así?",
     "texto": _l("¿Qué le dirías a una persona que está pasando algo así?")},
    {"titulo": "¿Son útiles los teléfonos de ayuda, los puntos morados y medidas similares?",
     "texto": _l("¿Crees que son de utilidad los teléfonos de ayuda y las asistencias similares "
                 "(puntos morados, puerta en los vestuarios, aparcamientos cerca de la entrada, etc.)? "
                 "¿Crees que son de apoyo?")},
    {"titulo": "¿Crees que estas situaciones siguen pasando hoy en día?",
     "texto": _l("¿Crees que estas situaciones siguen pasando hoy en día?")},
)
assert all(len(p["titulo"]) <= 80 for p in PREGUNTAS_FORO)


def _pregunta_foro(valor):
    """Número de pregunta (texto «1»..«5») → su dict de PREGUNTAS_FORO, o None si no es válida."""
    if valor.isdigit() and 1 <= int(valor) <= len(PREGUNTAS_FORO):
        return PREGUNTAS_FORO[int(valor) - 1]
    return None
_AVISOS_ERROR = {("filtro", "invalido"), ("filtro", "repetido")}
_ANCLA_PANEL = {"mural": "revision", "foro": "revision", "filtro": "filtro", "ajustes": "filtro",
                "pantalla": "control-pantalla"}
_HECHO = re.compile(r"^([a-z]+)\.([a-z]+)\.(\d{1,12})$")


def _volver_al_panel(objeto, accion, id_=0, retirados=0):
    parametros = {"hecho": "%s.%s.%d" % (objeto, accion, id_)}
    if retirados:
        parametros["n"] = int(retirados)
    return redirect(url_for("admin", **parametros) + "#" + _ANCLA_PANEL[objeto], code=303)


def _ultima_accion():
    """Lee ?hecho=… y devuelve {texto, tipo, resaltar} para la plantilla, o None."""
    hecho = _HECHO.match(request.args.get("hecho", ""))
    if not hecho:
        return None
    objeto, accion, id_ = hecho.group(1), hecho.group(2), int(hecho.group(3))
    plantilla = _AVISOS_PANEL.get((objeto, accion))
    if plantilla is None:
        return None
    n = request.args.get("n", "")
    n = int(n) if n.isdigit() and len(n) < 7 else 0
    retirados = ""
    if n:
        retirados = " " + ngettext("Se ha retirado %(num)d publicación que ya estaba en pantalla.",
                                   "Se han retirado %(num)d publicaciones que ya estaban en pantalla.", n)
    termino = ""
    if (objeto, accion) == ("filtro", "anadido"):
        termino = db.termino_filtro(id_)
        if termino is None:
            return None
    vista = ""
    if objeto == "pantalla":
        if id_ >= len(db.VISTAS_PANTALLA):
            return None
        vista = _NOMBRES_VISTAS[db.VISTAS_PANTALLA[id_]]
    return {
        "texto": str(plantilla) % {"id": id_, "termino": termino, "retirados": retirados, "vista": vista},
        "tipo": "error" if (objeto, accion) in _AVISOS_ERROR else "ok",
        "resaltar": "%s-%d" % (objeto, id_) if objeto in db.TABLAS and accion != "borrar" else None,
    }


def _zona_horaria():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(os.environ.get("ZONA_HORARIA") or "Europe/Madrid")
    except Exception:  # p. ej. Windows sin el paquete tzdata: hora local del equipo
        return None


def _fecha(valor):
    """Filtro de plantilla: "hoy, 10:42" o "17/11/26, 18:05" (formato del idioma) en hora
    de España. SQLite guarda `creado` en UTC."""
    if not valor:
        return ""
    try:
        momento = datetime.fromisoformat(str(valor))
    except ValueError:
        return str(valor)
    if momento.tzinfo is None:
        momento = momento.replace(tzinfo=timezone.utc)
    zona = _zona_horaria()
    local = momento.astimezone(zona)
    idioma = str(get_locale() or "es")
    if local.date() == datetime.now(timezone.utc).astimezone(zona).date():
        return _("hoy, %(hora)s", hora=format_time(local, "short", locale=idioma))
    return format_datetime(local, "short", locale=idioma)


# --- i18n: idiomas ---------------------------------------------------------------
# Orden de elección: cookie «idioma» (selector de la web) → idioma del navegador → español.
IDIOMAS = {"es": "Español", "en": "English"}  # cada uno en su propio idioma: no se traducen
IDIOMA_POR_DEFECTO = "es"

# Textos que bd/ guarda o devuelve en español (motivos de retención y de avisos).
# La BD los guarda siempre igual; se traducen solo al mostrarlos.
_TEXTOS_BD = {texto: traducido for texto, traducido in (
    ("Pendiente de aprobación", _l("Pendiente de aprobación")),
    ("Retirado por moderación", _l("Retirado por moderación")),
    ("Contiene un correo electrónico", _l("Contiene un correo electrónico")),
    ("Contiene un enlace", _l("Contiene un enlace")),
    ("Contiene un número de teléfono", _l("Contiene un número de teléfono")),
    ("Contiene un @usuario de redes sociales", _l("Contiene un @usuario de redes sociales")),
    ("Odio o discriminación", _l("Odio o discriminación")),
    ("Insultos, acoso o amenazas", _l("Insultos, acoso o amenazas")),
    ("Nombres o datos personales", _l("Nombres o datos personales")),
    ("Otro motivo", _l("Otro motivo")),
)}
_MOTIVO_PALABRA = re.compile(r"^Palabra filtrada: «(.*)»$")
_MOTIVO_AVISOS = re.compile(r"^Retirado automáticamente al recibir (\d+) avisos$")


def _elegir_idioma():
    elegido = request.cookies.get("idioma")
    if elegido in IDIOMAS:
        return elegido
    return request.accept_languages.best_match(IDIOMAS) or IDIOMA_POR_DEFECTO


def _motivo(texto):
    """Filtro de plantilla: traduce un motivo guardado por bd/ (si no se conoce, tal cual)."""
    if not texto:
        return ""
    if texto in _TEXTOS_BD:
        return str(_TEXTOS_BD[texto])
    palabra = _MOTIVO_PALABRA.match(texto)
    if palabra:
        return _("Palabra filtrada: «%(termino)s»", termino=palabra.group(1))
    avisos = _MOTIVO_AVISOS.match(texto)
    if avisos:
        return _("Retirado automáticamente al recibir %(num)s avisos", num=avisos.group(1))
    return texto


def _volver_aqui():
    """Ruta (sin el prefijo del subdirectorio) a la que vuelve el selector de idioma."""
    regla = request.url_rule
    if regla is None or "GET" not in (regla.methods or ()):
        return "/"  # p. ej. un error tras enviar el formulario: se vuelve al inicio
    args = [(k, v) for k, v in request.args.items(multi=True) if k not in ("hecho", "n", "enviado")]
    return request.path + ("?" + urlencode(args) if args else "")


class Limitador:
    """Cuántas peticiones se permiten por IP en una ventana de tiempo (en memoria, por proceso)."""

    def __init__(self, maximo, segundos):
        self.maximo, self.segundos = maximo, segundos
        self._marcas = defaultdict(deque)
        self._cerrojo = threading.Lock()

    def permitir(self, clave):
        ahora = time.monotonic()
        with self._cerrojo:
            marcas = self._marcas[clave]
            while marcas and ahora - marcas[0] > self.segundos:
                marcas.popleft()
            if len(marcas) >= self.maximo:
                return False
            marcas.append(ahora)
            return True


def create_app():
    app = Flask(__name__)
    app.config["BABEL_DEFAULT_LOCALE"] = IDIOMA_POR_DEFECTO
    app.config["BABEL_TRANSLATION_DIRECTORIES"] = "traducciones"
    Babel(app, locale_selector=_elegir_idioma)
    db.init_db()

    app.add_template_filter(_motivo, "motivo")

    @app.context_processor
    def datos_idioma():
        return {"idiomas": IDIOMAS, "idioma_actual": str(get_locale() or IDIOMA_POR_DEFECTO),
                "volver_aqui": _volver_aqui, "preguntas_foro": PREGUNTAS_FORO}

    @app.get("/idioma/<codigo>")
    def cambiar_idioma(codigo):
        """Selector de idioma: guarda la elección en una cookie y vuelve a la página de antes.
        ?volver= solo admite rutas de esta app (nada de redirigir a otras webs)."""
        if codigo not in IDIOMAS:
            abort(404)
        volver = request.args.get("volver", "")
        if volver.startswith("/") and not volver.startswith("//") and "\\" not in volver:
            destino = request.script_root + volver
        else:
            destino = url_for("participa")
        resp = redirect(destino, code=303)
        resp.set_cookie("idioma", codigo, max_age=365 * 24 * 3600, path=url_for("inicio"),
                        samesite="Lax", secure=request.is_secure)
        return resp

    @app.get("/")
    def inicio():
        return redirect(url_for("participa"))

    @app.get("/participa")
    def participa():
        return render_template("participa.html")

    @app.post("/mural")
    def crear_mural():
        texto = request.form.get("texto", "").strip()
        if not texto:
            return render_template(
                "participa.html",
                error_message=_("Escribe un mensaje antes de enviarlo."),
            ), 400
        if len(texto) > db.MAX_MURAL_TEXTO:
            return render_template(
                "participa.html",
                error_message=_("El mensaje no puede superar los %(num)d caracteres.",
                                num=db.MAX_MURAL_TEXTO),
            ), 400

        db.insertar_mural(texto)
        return redirect(url_for("gracias"))

    @app.post("/foro")
    def crear_foro():
        # Solo se puede responder a una de las preguntas de PREGUNTAS_FORO: el título no se escribe.
        pregunta = _pregunta_foro(request.form.get("pregunta", "").strip())
        texto = request.form.get("texto", "").strip()

        if pregunta is None:
            error_message = _("Elige una de las preguntas antes de enviar la reflexión.")
        elif not texto:
            error_message = _("Escribe una reflexión antes de enviarla.")
        elif len(texto) > db.MAX_FORO_TEXTO:
            error_message = _("La reflexión no puede superar los %(num)d caracteres.",
                              num=db.MAX_FORO_TEXTO)
        else:
            error_message = None

        if error_message:
            return render_template(
                "participa.html",
                error_message=error_message,
            ), 400

        db.insertar_foro(pregunta["titulo"], texto)
        return redirect(url_for("gracias"))

    @app.get("/gracias")
    def gracias():
        return render_template("gracias.html")

    # --- T02: pantalla y API JSON (solo contenido publicable) ---------------

    @app.get("/pantalla")
    @requiere_rol("admin", "pantalla")
    def pantalla():
        return render_template("pantalla.html")

    @app.get("/api/mural")
    @requiere_rol("admin", "pantalla")
    def api_mural():
        # T15: los mensajes caducados ya no salen; caduca_en = segundos que le quedan (None: no caduca).
        vida = db.vida_mensajes_min()
        mensajes = db.listar_mural(solo_visibles=True, limite=30, vida_min=vida)
        return jsonify([{"id": m["id"], "texto": m["texto"], "caduca_en": db.caduca_en(m["edad"], vida)}
                        for m in mensajes])

    @app.get("/api/foro")
    @requiere_rol("admin", "pantalla")
    def api_foro():
        # T14: reflexiones aprobadas y mensajes del mural visibles, mezclados. Los ids se repiten
        # entre tablas: el cliente debe identificar cada elemento por tipo + id.
        # T15: los mensajes caducados ya no salen (las reflexiones no caducan) y cada mensaje
        # lleva caduca_en (segundos que le quedan; None si no caduca).
        vida = db.vida_mensajes_min()
        salida = []
        for e in db.listar_foro_mixto(vida_min=vida):
            fila = {"tipo": e["tipo"], "id": e["id"], "titulo": e["titulo"], "texto": e["texto"]}
            if e["tipo"] == "mensaje":
                fila["caduca_en"] = db.caduca_en(e["edad"], vida)
            salida.append(fila)
        return jsonify(salida)

    @app.get("/api/pantalla")
    @requiere_rol("admin", "pantalla")
    def api_pantalla():
        """Órdenes del panel: vista fijada y último salto pedido (lo consulta pantalla.js)."""
        resp = jsonify(db.estado_pantalla())
        resp.headers["Cache-Control"] = "no-store"
        return resp

    # --- T03: panel de moderación (solo rol admin) --------------------------

    app.add_template_filter(_fecha, "fecha")

    @app.after_request
    def variar_por_idioma(resp):
        # La misma URL sale en otro idioma según la cookie o el navegador: que no se cachee mezclada.
        if resp.mimetype == "text/html":
            resp.vary.add("Accept-Language")
            resp.vary.add("Cookie")
        return resp

    @app.after_request
    def cabeceras_admin(resp):
        if (request.endpoint or "").startswith("admin"):
            resp.headers["Cache-Control"] = "no-store"
            resp.headers["X-Frame-Options"] = "DENY"
            resp.headers["Referrer-Policy"] = "same-origin"
        return resp

    @app.get("/admin")
    @requiere_rol("admin")
    def admin():
        aviso = _ultima_accion()
        return render_template(
            "admin.html",
            elementos=db.listar_para_panel(),
            terminos=db.listar_filtros(),
            ajustes=db.leer_ajustes(),
            control=db.estado_pantalla(),
            vistas=_NOMBRES_VISTAS,
            csrf=_token_csrf(),
            aviso=aviso,
            resaltar=aviso["resaltar"] if aviso else None,
        )

    @app.get("/admin/estado")
    @requiere_rol("admin")
    def admin_estado():
        """Contadores en JSON: el panel avisa si llegan avisos o retenidos nuevos."""
        return jsonify(db.contadores())

    @app.post("/admin/<tabla>/<int:id>/<accion>")
    @requiere_rol("admin")
    def admin_accion(tabla, id, accion):
        _comprobar_csrf()
        try:
            db.aplicar_accion(tabla, id, accion)
        except ValueError:
            abort(404)
        return _volver_al_panel(tabla, accion, id)

    @app.post("/admin/filtros")
    @requiere_rol("admin")
    def admin_filtro_anadir():
        _comprobar_csrf()
        id_, error = db.anadir_filtro(request.form.get("termino", ""))
        if error:
            return _volver_al_panel("filtro", error)
        return _volver_al_panel("filtro", "anadido", id_, db.revisar_publicados())

    @app.post("/admin/filtros/<int:id>/borrar")
    @requiere_rol("admin")
    def admin_filtro_quitar(id):
        _comprobar_csrf()
        db.quitar_filtro(id)
        return _volver_al_panel("filtro", "quitado")

    @app.post("/admin/ajustes")
    @requiere_rol("admin")
    def admin_ajustes():
        _comprobar_csrf()
        nuevos = {regla: "1" if request.form.get(regla) == "1" else "0"
                  for regla in ("enlaces", "correos", "telefonos", "usuarios", "foro_manual",
                                "retirar_por_avisos")}
        umbral = request.form.get("avisos_para_ocultar", "")
        if umbral.isdigit() and 1 <= int(umbral) <= 50:
            nuevos["avisos_para_ocultar"] = str(int(umbral))
        vida = request.form.get("mensajes_vida_min", "")   # T15: 0 = no caducan
        if vida.isdigit() and 0 <= int(vida) <= db.MAX_VIDA_MENSAJES_MIN:
            nuevos["mensajes_vida_min"] = str(int(vida))
        db.guardar_ajustes(nuevos)
        return _volver_al_panel("ajustes", "guardados", 0, db.revisar_publicados())

    @app.post("/admin/pantalla")
    @requiere_rol("admin")
    def admin_pantalla():
        """Saltar a una vista de /pantalla, fijarla o volver a la rotación automática."""
        _comprobar_csrf()
        accion = request.form.get("accion", "")
        vista = request.form.get("vista", "")
        try:
            db.ordenar_pantalla(accion, vista)
        except ValueError:
            abort(400)
        posicion = db.VISTAS_PANTALLA.index(vista) if vista in db.VISTAS_PANTALLA else 0
        return _volver_al_panel("pantalla", accion, posicion)

    # --- T03: avisos del público (sin contraseña) ---------------------------
    # Quien vea en la pantalla algo inapropiado lo busca en /avisar y lo marca: aparece en
    # «Avisos del público» del panel. Solo se retira solo si se activa en el panel
    # (ajuste retirar_por_avisos, apagado por defecto).

    # Como mucho 60 avisos cada 10 minutos desde una misma IP (en un instituto
    # muchos móviles salen por la misma IP, por eso no es más bajo).
    limite_avisos = Limitador(60, 600)

    def pagina_avisar(error_message=None, codigo=200):
        return render_template(
            "avisar.html",
            mensajes=db.listar_mural(solo_visibles=True, limite=30, vida_min=db.vida_mensajes_min()),
            reflexiones=db.listar_foro(solo_aprobadas=True),
            enviado=request.args.get("enviado") == "1",
            retirada_automatica=db.leer_ajustes()["retirar_por_avisos"] == "1",
            error_message=error_message,
        ), codigo

    def huella_avisador(resp):
        """Cookie anónima para que un mismo móvil no cuente dos veces. Se guarda solo su hash."""
        valor = request.cookies.get("avisador", "")
        if len(valor) != 32 or not valor.isalnum():
            valor = secrets.token_hex(16)
            resp.set_cookie("avisador", valor, max_age=365 * 24 * 3600, path=url_for("inicio"),
                            httponly=True, samesite="Lax", secure=request.is_secure)
        return hashlib.sha256(valor.encode("utf-8")).hexdigest()

    @app.get("/avisar")
    def avisar():
        return pagina_avisar()

    @app.route("/avisar/<tabla>/<int:id>", methods=["GET", "POST"])
    def avisar_elemento(tabla, id):
        item = db.elemento_publico(tabla, id)
        if item is None:
            return pagina_avisar(_("Ese mensaje ya no está en la pantalla."), 404)
        if request.method == "GET":
            resp = Response(render_template("avisar_elemento.html", item=item, motivos=db.MOTIVOS_AVISO))
            huella_avisador(resp)
            return resp
        if not limite_avisos.permitir(request.remote_addr or "?"):
            return pagina_avisar(_("Se han enviado muchos avisos desde esta red. Espera unos minutos."), 429)
        motivo = request.form.get("motivo", "")
        if motivo not in db.MOTIVOS_AVISO:
            return render_template("avisar_elemento.html", item=item, motivos=db.MOTIVOS_AVISO,
                                   error_message=_("Elige un motivo.")), 400
        resp = redirect(url_for("avisar", enviado=1), code=303)
        db.registrar_aviso(tabla, id, motivo, huella_avisador(resp))
        return resp

    return app


app = create_app()


if __name__ == "__main__":
    app.run()
