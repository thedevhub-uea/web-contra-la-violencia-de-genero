"""Acceso a la base de datos SQLite del proyecto 25N.

Uso desde app.py (T01):

    from bd import db
    db.init_db()                      # al arrancar: crea las tablas si no existen
    db.insertar_mural("texto")        # POST /mural
    db.listar_mural(solo_visibles=True, limite=30)   # GET /api/mural (T02)

Todas las consultas son parametrizadas: nunca se concatena texto en el SQL.
La ruta del fichero se toma de la variable de entorno DB_PATH
(por defecto, datos/25n.db). En el despliegue (T05) debe apuntar a un disco
persistente para que los datos sobrevivan a un reinicio.

Ejecutar `python -m bd.db` (desde la raíz del proyecto) crea la base de datos vacía.
"""

import hashlib
import os
import sqlite3
import time
from pathlib import Path

from bd import estilo
from bd.filtro import Filtro, limpiar_termino

BD_DIR = Path(__file__).resolve().parent
PROYECTO_DIR = BD_DIR.parent
DB_PATH = Path(os.environ.get("DB_PATH") or PROYECTO_DIR / "datos" / "25n.db")
SCHEMA_PATH = BD_DIR / "schema.sql"
FILTROS_INICIALES_PATH = BD_DIR / "filtros_iniciales.txt"

# Longitudes máximas (las mismas que en schema.sql y en el formulario de T06).
MAX_MURAL_TEXTO = 280
MAX_FORO_TITULO = 80
MAX_FORO_TEXTO = 280  # lo que cabe entero en una tarjeta del foro en la pantalla (el CHECK de schema.sql admite hasta 1000)

# Lista permitida para el panel de administración (T03):
# tabla -> {acción: sentencia SQL}. Nada que llegue en la URL se
# mete en el SQL: solo se usa para elegir una de estas sentencias fijas.
# Publicar a mano (mostrar/aprobar) marca revisado = 1: el filtro ya no lo vuelve a retirar.
_ACCIONES = {
    "mural": {
        "ocultar": "UPDATE mural SET visible = 0, retenido = 0, motivo = 'Retirado por moderación' WHERE id = ?",
        "mostrar": "UPDATE mural SET visible = 1, retenido = 0, motivo = NULL, revisado = 1 WHERE id = ?",
        "borrar": "DELETE FROM mural WHERE id = ?",
        "quitar_estilo": "UPDATE mural SET style = '{}' WHERE id = ?",
        # Fijado: el mensaje no caduca (sigue en el mural aunque pase su tiempo de vida).
        "fijar": "UPDATE mural SET fijado = 1 WHERE id = ?",
        "desfijar": "UPDATE mural SET fijado = 0 WHERE id = ?",
    },
    "foro": {
        "aprobar": "UPDATE foro SET aprobado = 1, retenido = 0, motivo = NULL, revisado = 1 WHERE id = ?",
        "retirar": "UPDATE foro SET aprobado = 0, retenido = 0, motivo = 'Retirado por moderación' WHERE id = ?",
        "borrar": "DELETE FROM foro WHERE id = ?",
        # Fijada: la reflexión siempre sale en el foro, aunque lleguen más de LIMITE_FORO_PANTALLA nuevas.
        "fijar": "UPDATE foro SET fijado = 1 WHERE id = ?",
        "desfijar": "UPDATE foro SET fijado = 0 WHERE id = ?",
    },
}
# Acciones que no son una decisión sobre el contenido: no cierran los avisos pendientes.
_ACCIONES_SIN_DECISION = ("quitar_estilo", "fijar", "desfijar")

# --- T03: filtro automático y avisos -----------------------------------------
AJUSTES_POR_DEFECTO = {
    "enlaces": "1",              # retener lo que lleve enlaces
    "correos": "1",              # ... correos electrónicos
    "telefonos": "1",            # ... números de teléfono
    "usuarios": "1",             # ... @usuarios de redes sociales
    # Las reflexiones pueden contar casos reales con nombres o lugares que el filtro no detecta:
    # por defecto no salen hasta que moderación las lee y las aprueba. Relajarlo es una
    # decisión del equipo, desde el panel.
    "foro_manual": "1",
    # Lo mismo para los mensajes del mural: por defecto se publican solos si pasan el filtro.
    # Activado, todos esperan en «Pendientes de revisar» hasta que moderación los publique.
    "mural_manual": "0",
    # Los avisos del público solo marcan el elemento en el panel. Retirarlo solo al llegar a
    # N avisos es opcional y va apagado: la cookie anónima se puede saltar y una sola persona
    # podría vaciar la pantalla.
    "retirar_por_avisos": "0",
    "avisos_para_ocultar": "2",  # N, si se activa retirar_por_avisos
    # T15: minutos que un mensaje del mural sigue en pantalla desde que se envía ("0" = no caduca).
    # Solo caducan los mensajes; las reflexiones no. Caducar no borra nada: solo deja de mostrarse.
    "mensajes_vida_min": "15",
    # Participación: si /participa admite mensajes nuevos para el mural y reflexiones para el foro.
    # Se abren y cierran desde el panel; cerrar no retira nada de lo que ya está en pantalla.
    "admitir_mural": "1",
    "admitir_foro": "1",
    # Tiempos de /pantalla, en segundos (se cambian desde el panel; ver TIEMPOS_PANTALLA).
    "tiempo_mural_seg": "300",       # lo que dura el mural antes de pasar al vídeo
    "tiempo_foro_seg": "300",        # lo que dura el foro antes de volver al mural
    "tiempo_foro_pagina_seg": "15",  # cada cuánto cambia la página de tarjetas del foro
    "tiempo_refresco_seg": "10",     # cada cuánto pide la pantalla los mensajes nuevos
    # CONECTA: transición entre vistas de /pantalla (portada de fondo + etiqueta «Siguiente»).
    "transicion_activa": "1",
    "transicion_seg": "15",          # duración total, en segundos (mínimo 1, sin máximo)
    "trans_mural_es": "Mural", "trans_mural_en": "Mural",
    "trans_video_es": "Vídeo", "trans_video_en": "Video",
    "trans_foro_es": "Foro de reflexión", "trans_foro_en": "Reflection forum",
    "trans_pregunta_es": "Pregunta {n}", "trans_pregunta_en": "Question {n}",   # {n} = número de pregunta
    # Control de /pantalla desde el panel (ver ordenar_pantalla()).
    "pantalla_fijada": "",       # '' = rotación automática; o 'mural' | 'video' | 'foro'
    "pantalla_salto_vista": "",  # última vista a la que se pidió saltar
    "pantalla_salto_id": "0",    # sube en cada salto: así la pantalla sabe que es una orden nueva
}
VISTAS_PANTALLA = ("mural", "video", "foro")
MAX_VIDA_MENSAJES_MIN = 240  # tope del ajuste mensajes_vida_min (4 horas)
# Tiempos de /pantalla configurables desde el panel: clave del ajuste -> (mínimo, máximo) en segundos.
# El nombre corto (sin «tiempo_» ni «_seg») es el que llega a pantalla.js en /api/pantalla.
TIEMPOS_PANTALLA = {
    "tiempo_mural_seg": (10, 3600),
    "tiempo_foro_seg": (10, 3600),
    "tiempo_foro_pagina_seg": (5, 300),
    "tiempo_refresco_seg": (3, 300),
}
MOTIVOS_AVISO = {
    "odio": "Odio o discriminación",
    "acoso": "Insultos, acoso o amenazas",
    "datos": "Nombres o datos personales",
    "otro": "Otro motivo",
}
MOTIVO_PENDIENTE = "Pendiente de aprobación"


# SQL fijo por tabla para el filtro y los avisos. "publicado" es visible (mural) o aprobado (foro).
_SQL = {
    "mural": {
        "info": "PRAGMA table_info(mural)",
        # Columnas añadidas por T03: init_db() crea las que falten en bases de datos anteriores.
        "columnas": {
            "retenido": "ALTER TABLE mural ADD COLUMN retenido INTEGER NOT NULL DEFAULT 0 CHECK (retenido IN (0, 1))",
            "motivo": "ALTER TABLE mural ADD COLUMN motivo TEXT",
            "revisado": "ALTER TABLE mural ADD COLUMN revisado INTEGER NOT NULL DEFAULT 0 CHECK (revisado IN (0, 1))",
        },
        # edad: segundos desde el envío (calculada aquí: «creado» es UTC sin zona y no se parsea en JS)
        "panel": ("SELECT id, NULL AS titulo, texto, creado, visible AS publicado, retenido, motivo, style, fijado, "
                  "CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', creado) AS INTEGER) AS edad "
                  "FROM mural"),
        "publico": "SELECT id, NULL AS titulo, texto FROM mural WHERE id = ? AND visible = 1",
        "uno": "SELECT visible AS publicado, retenido, style, fijado FROM mural WHERE id = ?",
        "revisar": "SELECT id, '' AS titulo, texto FROM mural WHERE visible = 1 AND revisado = 0",
        "retener": "UPDATE mural SET visible = 0, retenido = 1, motivo = ? WHERE id = ? AND visible = 1",
        "retirar_por_avisos": "UPDATE mural SET visible = 0, retenido = 0, motivo = ? WHERE id = ? AND visible = 1",
    },
    "foro": {
        "info": "PRAGMA table_info(foro)",
        # Columnas añadidas por T03: init_db() crea las que falten en bases de datos anteriores.
        "columnas": {
            "retenido": "ALTER TABLE foro ADD COLUMN retenido INTEGER NOT NULL DEFAULT 0 CHECK (retenido IN (0, 1))",
            "motivo": "ALTER TABLE foro ADD COLUMN motivo TEXT",
            "revisado": "ALTER TABLE foro ADD COLUMN revisado INTEGER NOT NULL DEFAULT 0 CHECK (revisado IN (0, 1))",
        },
        "panel": ("SELECT id, titulo, texto, creado, aprobado AS publicado, retenido, motivo, fijado, "
                  "NULL AS edad FROM foro"),
        "publico": "SELECT id, titulo, texto FROM foro WHERE id = ? AND aprobado = 1",
        "uno": "SELECT aprobado AS publicado, retenido, NULL AS style, fijado FROM foro WHERE id = ?",
        "revisar": "SELECT id, titulo, texto FROM foro WHERE aprobado = 1 AND revisado = 0",
        "retener": "UPDATE foro SET aprobado = 0, retenido = 1, motivo = ? WHERE id = ? AND aprobado = 1",
        "retirar_por_avisos": "UPDATE foro SET aprobado = 0, retenido = 0, motivo = ? WHERE id = ? AND aprobado = 1",
    },
}
TABLAS = tuple(_SQL)


def get_conexion():
    """Abre una conexión nueva. Las filas se pueden leer como diccionarios."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    """Crea las tablas e índices si no existen y activa el modo WAL. No borra nada.

    El modo WAL (lecturas de la pantalla mientras escriben los móviles) se guarda
    en el propio fichero, así que basta con activarlo aquí una vez.
    En producción lo ejecuta gunicorn una sola vez antes de arrancar los procesos
    (deploy/gunicorn.conf.py): si varios procesos lo hicieran a la vez sobre una
    base nueva, SQLite podría responder «database is locked».
    """
    con = get_conexion()
    try:
        modo = con.execute("PRAGMA journal_mode").fetchone()[0]
        if modo.lower() != "wal":
            con.execute("PRAGMA journal_mode = WAL")
        con.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        _migrar_tipos_filtro(con)
        _migrar_t03(con)
        _migrar_conecta(con)
        _migrar_fijado(con)
    finally:
        con.close()


PREGUNTAS_INICIALES = (
    (1, "¿Qué piensas de la utilidad del feminismo hoy en día?",
     "¿Qué piensas de la utilidad del feminismo hoy en día?",
     "What do you think about the usefulness of feminism today?"),
    (2, "¿Cómo actuarías tú en ese lugar?",
     "¿Cómo actuarías tú en ese lugar?",
     "How would you act in that situation?"),
    (3, "¿Qué le dirías a una persona que está pasando algo así?",
     "¿Qué le dirías a una persona que está pasando algo así?",
     "What would you say to someone going through something like this?"),
    # El título (máx. 80) es el que ya usaban las respuestas existentes de la pregunta 4.
    (4, "¿Son útiles los teléfonos de ayuda, los puntos morados y medidas similares?",
     "¿Crees que son de utilidad los teléfonos de ayuda y las asistencias similares (puntos morados, "
     "puerta en los vestuarios, aparcamientos cerca de la entrada, etc.) y que son un apoyo?",
     "Do you think helplines and similar assistance (purple points, a door in the changing rooms, "
     "parking near the entrance, etc.) are useful, and that they offer real support?"),
    (5, "¿Crees que estas situaciones siguen pasando hoy en día?",
     "¿Crees que estas situaciones siguen pasando hoy en día?",
     "Do you think these situations still happen today?"),
)


def _migrar_conecta(con):
    """Migraciones CONECTA, idempotentes y retrocompatibles:
    1. mural: texto hasta 280 caracteres (el CHECK de SQLite no se puede cambiar con ALTER: se
       reconstruye la tabla copiando todas las filas) y columna style (por defecto '{}').
    2. foro_preguntas: carga las 5 preguntas con su texto en español e inglés (solo si está vacía)."""
    sql = con.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mural'").fetchone()[0]
    columnas = {f[1] for f in con.execute("PRAGMA table_info(mural)")}
    if "BETWEEN 1 AND 200" in sql or "style" not in columnas:
        con.execute("PRAGMA foreign_keys = OFF")
        with con:
            con.execute("DROP TABLE IF EXISTS mural_nuevo")
            con.execute("""CREATE TABLE mural_nuevo (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                texto TEXT NOT NULL CHECK (length(trim(texto)) BETWEEN 1 AND 280),
                creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
                visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
                retenido INTEGER NOT NULL DEFAULT 0 CHECK (retenido IN (0, 1)),
                motivo TEXT,
                revisado INTEGER NOT NULL DEFAULT 0 CHECK (revisado IN (0, 1)),
                style TEXT NOT NULL DEFAULT '{}')""")
            estilo_col = "style" if "style" in columnas else "'{}'"
            con.execute("INSERT INTO mural_nuevo (id, texto, creado, visible, retenido, motivo, revisado, style) "
                        f"SELECT id, texto, creado, visible, retenido, motivo, revisado, {estilo_col} FROM mural")
            con.execute("DROP TABLE mural")
            con.execute("ALTER TABLE mural_nuevo RENAME TO mural")
            con.execute("CREATE INDEX IF NOT EXISTS idx_mural_visible_creado ON mural (visible, creado DESC)")
    with con:
        if con.execute("SELECT COUNT(*) FROM foro_preguntas").fetchone()[0] == 0:
            con.executemany("INSERT INTO foro_preguntas (id, titulo, text_es, text_en) VALUES (?, ?, ?, ?)",
                            PREGUNTAS_INICIALES)


def _migrar_fijado(con):
    """Añade la columna fijado (mural y foro) a una base de datos anterior. Va después de
    _migrar_conecta, que puede reconstruir la tabla mural."""
    with con:
        for tabla in TABLAS:
            if "fijado" not in {f["name"] for f in con.execute(f"PRAGMA table_info({tabla})")}:
                con.execute(f"ALTER TABLE {tabla} ADD COLUMN fijado INTEGER NOT NULL DEFAULT 0 "
                            "CHECK (fijado IN (0, 1))")


def _migrar_t03(con):
    """Añade lo de T03 a una base de datos creada antes (columnas, ajustes y filtro inicial)."""
    with con:
        for tabla in TABLAS:
            existentes = {f["name"] for f in con.execute(_SQL[tabla]["info"])}
            nuevas = [c for c in _SQL[tabla]["columnas"] if c not in existentes]
            for columna in nuevas:
                con.execute(_SQL[tabla]["columnas"][columna])
            if tabla == "foro" and "retenido" in nuevas:
                # Las reflexiones que esperaban aprobación siguen esperándola en el panel.
                con.execute("UPDATE foro SET retenido = 1, motivo = ? WHERE aprobado = 0", (MOTIVO_PENDIENTE,))
        for clave, valor in AJUSTES_POR_DEFECTO.items():
            con.execute("INSERT OR IGNORE INTO ajustes (clave, valor) VALUES (?, ?)", (clave, valor))
        if con.execute("SELECT 1 FROM ajustes WHERE clave = 'filtros_cargados'").fetchone() is None:
            for termino, tipo in _leer_filtros_iniciales():
                con.execute("INSERT OR IGNORE INTO filtros (termino, tipo) VALUES (?, ?)", (termino, tipo))
            con.execute("INSERT INTO ajustes (clave, valor) VALUES ('filtros_cargados', '1')")


# Prefijo de cada línea de filtros_iniciales.txt según el tipo (#34): sin prefijo, bloqueo.
PREFIJOS_TIPO = {"~": "cuarentena", "!": "excepcion"}
TIPOS_FILTRO = ("bloqueo", "cuarentena", "excepcion")


def leer_linea_filtro(linea):
    """(termino, tipo) de una línea de filtros_iniciales.txt, o None si es comentario o no es válida."""
    linea = linea.strip()
    if not linea or linea.startswith("#"):
        return None
    tipo = PREFIJOS_TIPO.get(linea[0], "bloqueo")
    termino = limpiar_termino(linea[1:] if tipo != "bloqueo" else linea)
    return (termino, tipo) if termino else None


def _leer_filtros_iniciales():
    """[(termino, tipo)] de filtros_iniciales.txt."""
    if not FILTROS_INICIALES_PATH.exists():
        return []
    lineas = FILTROS_INICIALES_PATH.read_text(encoding="utf-8").splitlines()
    return [f for f in map(leer_linea_filtro, lineas) if f]


def _migrar_tipos_filtro(con):
    """#34: columna tipo en filtros (las bases de datos de antes solo tenían bloqueo)."""
    columnas = {f["name"] for f in con.execute("PRAGMA table_info(filtros)")}
    if "tipo" not in columnas:
        with con:
            con.execute("ALTER TABLE filtros ADD COLUMN tipo TEXT NOT NULL DEFAULT 'bloqueo' "
                        "CHECK (tipo IN ('bloqueo', 'cuarentena', 'excepcion'))")


def _ejecutar(sql, params=()):
    con = get_conexion()
    try:
        with con:
            cur = con.execute(sql, params)
            return cur
    finally:
        con.close()


def _consultar(sql, params=()):
    con = get_conexion()
    try:
        return [dict(fila) for fila in con.execute(sql, params).fetchall()]
    finally:
        con.close()


# --- CONECTA: preguntas del foro (ES/EN) -------------------------------------

def listar_preguntas():
    """Las preguntas del foro por orden: [{id, titulo, text_es, text_en, texto}]. «texto» = text_es."""
    filas = _consultar("SELECT id, titulo, text_es, text_en FROM foro_preguntas ORDER BY id")
    for f in filas:
        f["texto"] = f["text_es"]
    return filas


# --- Escritura pública (T01) -------------------------------------------------

def insertar_mural(texto, style=None):
    """Guarda un mensaje del mural y devuelve su id.

    T03: si no pasa el filtro automático (o si la aprobación manual del mural está
    activada) se guarda retenido (no sale en pantalla hasta que moderación decida).
    """
    texto = texto.strip()
    motivo = filtro_actual().motivo(texto)
    if motivo is None and leer_ajustes()["mural_manual"] == "1":
        motivo = MOTIVO_PENDIENTE
    return _ejecutar(
        "INSERT INTO mural (texto, visible, retenido, motivo, style) VALUES (?, ?, ?, ?, ?)",
        (texto, 0 if motivo else 1, 1 if motivo else 0, motivo, estilo.a_json(style)),
    ).lastrowid


def insertar_foro(titulo, texto):
    """Guarda una reflexión del foro y devuelve su id.

    T03: si pasa el filtro se aprueba sola; si no (o si la aprobación manual está
    activada) se guarda retenida para que moderación decida.
    """
    titulo, texto = titulo.strip(), texto.strip()
    motivo = filtro_actual().motivo(titulo, texto)
    if motivo is None and leer_ajustes()["foro_manual"] == "1":
        motivo = MOTIVO_PENDIENTE
    return _ejecutar(
        "INSERT INTO foro (titulo, texto, aprobado, retenido, motivo) VALUES (?, ?, ?, ?, ?)",
        (titulo, texto, 0 if motivo else 1, 1 if motivo else 0, motivo),
    ).lastrowid


# --- Lectura (T02 API y T03 admin) -------------------------------------------

def listar_mural(solo_visibles=True, limite=None, vida_min=None):
    """Mensajes del mural, más recientes primero.

    Cada fila lleva `edad`: segundos desde el envío, calculados por SQLite (T15).
    Con vida_min > 0 se excluyen los mensajes que ya han caducado (edad ≥ vida): el filtro va
    en el WHERE, antes del LIMIT, para que los caducados no ocupen sitio. No borra nada.
    """
    sql = ("SELECT id, texto, creado, visible, style, fijado, "
           "CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', creado) AS INTEGER) AS edad "
           "FROM mural")
    condiciones = []
    params = []
    if solo_visibles:
        condiciones.append("visible = 1")
    if vida_min and int(vida_min) > 0:   # los fijados no caducan
        condiciones.append("(fijado = 1 OR CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', creado) AS INTEGER) < ?)")
        params.append(int(vida_min) * 60)
    if condiciones:
        sql += " WHERE " + " AND ".join(condiciones)
    sql += " ORDER BY creado DESC, id DESC"
    if limite is not None:
        sql += " LIMIT ?"
        params.append(int(limite))
    return _consultar(sql, tuple(params))


def listar_foro(solo_aprobadas=True):
    """Reflexiones del foro, más recientes primero.

    Con solo_aprobadas=False (panel de admin) las pendientes van primero.
    """
    if solo_aprobadas:
        sql = ("SELECT id, titulo, texto, creado, aprobado FROM foro "
               "WHERE aprobado = 1 ORDER BY creado DESC, id DESC")
    else:
        sql = ("SELECT id, titulo, texto, creado, aprobado FROM foro "
               "ORDER BY aprobado ASC, creado DESC, id DESC")
    return _consultar(sql)


# Máximo de reflexiones que el foro de la pantalla recibe de una vez (hasta 4 por página: ~15 páginas).
LIMITE_FORO_PANTALLA = 60


def listar_foro_pantalla(limite=LIMITE_FORO_PANTALLA):
    """Lo que muestra el foro de la pantalla: SOLO reflexiones aprobadas, más recientes primero.

    Los mensajes del mural ya no salen en el foro (en T14 se mezclaban): solo se ven en el mural.
    Las fijadas salen siempre, aunque haya más de `limite` reflexiones más nuevas.
    Cada fila: {id, titulo, texto, creado}.
    """
    return _consultar(
        "SELECT id, titulo, texto, creado FROM foro WHERE aprobado = 1 AND (fijado = 1 OR id IN "
        "(SELECT id FROM foro WHERE aprobado = 1 ORDER BY creado DESC, id DESC LIMIT ?)) "
        "ORDER BY creado DESC, id DESC",
        (int(limite),),
    )


# --- Moderación (T03) --------------------------------------------------------

def aplicar_accion(tabla, id_, accion):
    """Aplica una acción de moderación. Devuelve True si cambió alguna fila.

    Lanza ValueError si la tabla o la acción no están en la lista permitida.
    Cualquier decisión de moderación cierra los avisos pendientes de ese elemento.
    """
    try:
        sql = _ACCIONES[tabla][accion]
    except KeyError:
        raise ValueError(f"Acción no permitida: {tabla}/{accion}") from None
    con = get_conexion()
    try:
        with con:
            cambiadas = con.execute(sql, (int(id_),)).rowcount
            if accion not in _ACCIONES_SIN_DECISION:   # quitar el estilo o fijar no resuelve los avisos
                con.execute("DELETE FROM avisos WHERE tabla = ? AND elemento_id = ?", (tabla, int(id_)))
        return cambiadas > 0
    finally:
        con.close()


def leer_elemento(tabla, id_):
    """{publicado, retenido, style} de un mensaje o reflexión (para comprobar una acción), o None."""
    if tabla not in _SQL:
        return None
    filas = _consultar(_SQL[tabla]["uno"], (int(id_),))
    return filas[0] if filas else None


# --- T03: ajustes y filtro automático ---------------------------------------

def leer_ajustes():
    ajustes = dict(AJUSTES_POR_DEFECTO)
    ajustes.update({f["clave"]: f["valor"] for f in _consultar("SELECT clave, valor FROM ajustes")})
    return ajustes


def guardar_ajustes(nuevos):
    """Guarda solo las claves conocidas (AJUSTES_POR_DEFECTO)."""
    con = get_conexion()
    try:
        with con:
            for clave, valor in nuevos.items():
                if clave in AJUSTES_POR_DEFECTO:
                    con.execute("INSERT INTO ajustes (clave, valor) VALUES (?, ?) "
                                "ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", (clave, str(valor)))
    finally:
        con.close()


def estado_pantalla():
    """Órdenes del panel para /pantalla: {fijada, salto_vista, salto_id}."""
    ajustes = leer_ajustes()
    fijada = ajustes["pantalla_fijada"]
    salto_vista = ajustes["pantalla_salto_vista"]
    salto_id = ajustes["pantalla_salto_id"]
    return {
        "fijada": fijada if fijada in VISTAS_PANTALLA else None,
        "salto_vista": salto_vista if salto_vista in VISTAS_PANTALLA else None,
        "salto_id": int(salto_id) if salto_id.isdigit() else 0,
    }


def ordenar_pantalla(accion, vista=None):
    """Órdenes del panel a /pantalla.

    - "saltar": salta una vez a `vista` y sigue la rotación desde ahí (quita lo fijado).
    - "fijar":  se queda en `vista` hasta que se suelte.
    - "soltar": vuelve a la rotación automática.
    """
    if accion not in ("saltar", "fijar", "soltar"):
        raise ValueError("Acción no permitida")
    if accion != "soltar" and vista not in VISTAS_PANTALLA:
        raise ValueError("Vista no permitida")
    sql = ("INSERT INTO ajustes (clave, valor) VALUES (?, ?) "
           "ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor")
    con = get_conexion()
    try:
        with con:
            con.execute(sql, ("pantalla_fijada", vista if accion == "fijar" else ""))
            if accion == "saltar":
                con.execute(sql, ("pantalla_salto_vista", vista))
                con.execute("INSERT INTO ajustes (clave, valor) VALUES ('pantalla_salto_id', '1') "
                            "ON CONFLICT(clave) DO UPDATE SET valor = CAST(valor AS INTEGER) + 1")
    finally:
        con.close()


def umbral_avisos():
    valor = leer_ajustes()["avisos_para_ocultar"]
    return max(1, int(valor)) if valor.isdigit() else int(AJUSTES_POR_DEFECTO["avisos_para_ocultar"])


def participacion():
    """{"mural": bool, "foro": bool}: si /participa admite envíos nuevos para cada uno."""
    ajustes = leer_ajustes()
    return {"mural": ajustes["admitir_mural"] == "1", "foro": ajustes["admitir_foro"] == "1"}


def tiempos_pantalla():
    """Tiempos de /pantalla en segundos: {mural, foro, foro_pagina, refresco}.
    Un valor guardado fuera de rango (o no numérico) vuelve al de por defecto."""
    ajustes = leer_ajustes()
    tiempos = {}
    for clave, (minimo, maximo) in TIEMPOS_PANTALLA.items():
        valor = ajustes[clave]
        if not (valor.isdigit() and minimo <= int(valor) <= maximo):
            valor = AJUSTES_POR_DEFECTO[clave]
        tiempos[clave[len("tiempo_"):-len("_seg")]] = int(valor)
    return tiempos


TRANSICION_LIMITES = (1.0, float("inf"))  # sin máximo: 900 s = 15 min, por ejemplo


def transicion():
    """Ajustes de la transición de /pantalla: {activa, seg, etiquetas: {vista: {es, en}}}."""
    a = leer_ajustes()
    try:
        seg = float(a["transicion_seg"])
    except ValueError:
        seg = float(AJUSTES_POR_DEFECTO["transicion_seg"])
    if not (TRANSICION_LIMITES[0] <= seg <= TRANSICION_LIMITES[1]):
        seg = float(AJUSTES_POR_DEFECTO["transicion_seg"])
    etiquetas = {v: {"es": a[f"trans_{v}_es"], "en": a[f"trans_{v}_en"]}
                 for v in ("mural", "video", "foro")}
    return {"activa": a["transicion_activa"] == "1", "seg": seg, "etiquetas": etiquetas}


def vida_mensajes_min():
    """Minutos que un mensaje del mural sigue en pantalla (T15). 0 = no caduca."""
    valor = leer_ajustes()["mensajes_vida_min"]
    if valor.isdigit() and int(valor) <= MAX_VIDA_MENSAJES_MIN:
        return int(valor)
    return int(AJUSTES_POR_DEFECTO["mensajes_vida_min"])


def caduca_en(edad, vida_min, fijado=False):
    """Segundos que le quedan a un mensaje (T15), o None si no caduca (vida 0, sin edad o fijado)."""
    if not vida_min or edad is None or fijado:
        return None
    return max(0, int(vida_min) * 60 - int(edad))


def listar_filtros():
    return _consultar("SELECT id, termino, tipo FROM filtros ORDER BY termino")


def termino_filtro(id_):
    filas = _consultar("SELECT termino FROM filtros WHERE id = ?", (int(id_),))
    return filas[0]["termino"] if filas else None


def anadir_filtro(termino, tipo="bloqueo"):
    """Devuelve (id, None) si se añade, o (None, 'invalido' | 'repetido')."""
    limpio = limpiar_termino(termino)
    if limpio is None or tipo not in TIPOS_FILTRO:
        return None, "invalido"
    try:
        return _ejecutar("INSERT INTO filtros (termino, tipo) VALUES (?, ?)", (limpio, tipo)).lastrowid, None
    except sqlite3.IntegrityError:
        return None, "repetido"


def quitar_filtro(id_):
    _ejecutar("DELETE FROM filtros WHERE id = ?", (int(id_),))


def cambiar_tipo_filtro(termino, tipo):
    """Cambia el tipo de un término que ya está en el filtro (lo usa herramientas/generar_filtros.py)."""
    if tipo not in TIPOS_FILTRO:
        raise ValueError(tipo)
    return _ejecutar("UPDATE filtros SET tipo = ? WHERE termino = ? AND tipo <> ?", (tipo, termino, tipo)).rowcount


def filtro_actual():
    ajustes = leer_ajustes()
    filas = listar_filtros()
    return Filtro([f["termino"] for f in filas if f["tipo"] == "bloqueo"],
                  cuarentena=[f["termino"] for f in filas if f["tipo"] == "cuarentena"],
                  excepciones=[f["termino"] for f in filas if f["tipo"] == "excepcion"],
                  enlaces=ajustes["enlaces"] == "1", correos=ajustes["correos"] == "1",
                  telefonos=ajustes["telefonos"] == "1", usuarios=ajustes["usuarios"] == "1")


def revisar_publicados():
    """Pasa el filtro actual por lo que ya está en pantalla (salvo lo publicado a mano).
    Devuelve cuántos elementos se han retirado."""
    filtro = filtro_actual()
    retirados = 0
    con = get_conexion()
    try:
        with con:
            for tabla in TABLAS:
                for fila in con.execute(_SQL[tabla]["revisar"]).fetchall():
                    motivo = filtro.motivo(fila["titulo"], fila["texto"])
                    if motivo:
                        retirados += con.execute(_SQL[tabla]["retener"], (motivo, fila["id"])).rowcount
    finally:
        con.close()
    return retirados


# --- T03: avisos del público -------------------------------------------------

def elemento_publico(tabla, id_):
    """El mensaje o la reflexión si está en pantalla; si no, None."""
    if tabla not in _SQL:
        return None
    filas = _consultar(_SQL[tabla]["publico"], (int(id_),))
    return dict(filas[0], tabla=tabla) if filas else None


def registrar_aviso(tabla, id_, motivo, avisador):
    """Guarda un aviso. Solo si está activado el ajuste retirar_por_avisos y se llega al
    umbral, retira el elemento de la pantalla; si no, solo queda marcado en el panel.
    Devuelve 'nuevo', 'repetido' o 'no_visible'."""
    if motivo not in MOTIVOS_AVISO or elemento_publico(tabla, id_) is None:
        return "no_visible"
    retirar = leer_ajustes()["retirar_por_avisos"] == "1"
    umbral = umbral_avisos()
    con = get_conexion()
    try:
        with con:
            cur = con.execute("INSERT OR IGNORE INTO avisos (tabla, elemento_id, motivo, avisador) "
                              "VALUES (?, ?, ?, ?)", (tabla, int(id_), motivo, avisador))
            if cur.rowcount == 0:
                return "repetido"
            total = con.execute("SELECT COUNT(*) FROM avisos WHERE tabla = ? AND elemento_id = ?",
                                (tabla, int(id_))).fetchone()[0]
            if retirar and total >= umbral:
                con.execute(_SQL[tabla]["retirar_por_avisos"],
                            ("Retirado automáticamente al recibir %d avisos" % total, int(id_)))
        return "nuevo"
    finally:
        con.close()


# --- T03: datos del panel ----------------------------------------------------

def listar_para_panel():
    """Mural y foro juntos, más recientes primero, con su estado y sus avisos:
    {tabla, id, titulo, texto, creado, estado ('visible'|'retenido'|'oculto'|'caducado'), motivo,
     avisos, motivos_aviso [(texto, n), ...]}

    'caducado' (T15): mensaje del mural publicado cuya edad ya supera la vida configurada. Ya no
    sale en pantalla, pero no está retirado por moderación ni se borra: sigue en el panel."""
    vida_seg = vida_mensajes_min() * 60
    avisos = {}
    for f in _consultar("SELECT tabla, elemento_id, motivo, COUNT(*) AS n FROM avisos "
                        "GROUP BY tabla, elemento_id, motivo"):
        avisos.setdefault((f["tabla"], f["elemento_id"]), []).append((MOTIVOS_AVISO.get(f["motivo"], f["motivo"]), f["n"]))
    elementos = []
    for tabla in TABLAS:
        for e in _consultar(_SQL[tabla]["panel"]):
            e["tabla"] = tabla
            e["estado"] = "visible" if e["publicado"] else ("retenido" if e["retenido"] else "oculto")
            if (e["estado"] == "visible" and tabla == "mural" and vida_seg and not e["fijado"]
                    and e["edad"] is not None and e["edad"] >= vida_seg):
                e["estado"] = "caducado"
            motivos = sorted(avisos.get((tabla, e["id"]), []), key=lambda m: -m[1])
            e["motivos_aviso"] = motivos
            e["avisos"] = sum(n for _, n in motivos)
            elementos.append(e)
    elementos.sort(key=lambda e: (e["creado"] or "", e["id"]), reverse=True)
    return elementos


def _sql_mural_en_pantalla():
    """Condición SQL (y sus parámetros) de «mensaje del mural que ahora mismo sale en pantalla»."""
    vida = vida_mensajes_min()
    if not vida:
        return "visible = 1", ()
    return ("visible = 1 AND (fijado = 1 OR CAST(strftime('%s','now') AS INTEGER) "
            "- CAST(strftime('%s', creado) AS INTEGER) < ?)"), (vida * 60,)


def cuenta_fijados():
    """{fijados, sin_fijar}: publicaciones fijadas (mural + foro) y las que salen ahora en pantalla
    sin estar fijadas (lo que fijaría «Fijar todo»)."""
    donde, params = _sql_mural_en_pantalla()
    fila = _consultar(
        "SELECT (SELECT COUNT(*) FROM mural WHERE fijado = 1) + (SELECT COUNT(*) FROM foro WHERE fijado = 1) AS fijados, "
        f"(SELECT COUNT(*) FROM mural WHERE fijado = 0 AND {donde}) + "
        "(SELECT COUNT(*) FROM foro WHERE fijado = 0 AND aprobado = 1) AS sin_fijar", params)[0]
    return {"fijados": fila["fijados"], "sin_fijar": fila["sin_fijar"]}


def fijar_todo(fijar=True):
    """Fija (o suelta) de una vez los mensajes del mural y las reflexiones del foro.

    Fijar: solo lo que sale ahora en pantalla (los caducados no vuelven; esos se fijan uno a uno).
    Quitar: todo lo fijado. Devuelve cuántas publicaciones han cambiado."""
    con = get_conexion()
    try:
        with con:
            if fijar:
                donde, params = _sql_mural_en_pantalla()
                n = con.execute(f"UPDATE mural SET fijado = 1 WHERE fijado = 0 AND {donde}", params).rowcount
                n += con.execute("UPDATE foro SET fijado = 1 WHERE fijado = 0 AND aprobado = 1").rowcount
            else:
                n = con.execute("UPDATE mural SET fijado = 0 WHERE fijado = 1").rowcount
                n += con.execute("UPDATE foro SET fijado = 0 WHERE fijado = 1").rowcount
        return n
    finally:
        con.close()


def contadores():
    """Lo pendiente de revisar: elementos con avisos y elementos retenidos."""
    return {
        "avisos": _consultar("SELECT COUNT(*) AS n FROM (SELECT DISTINCT tabla, elemento_id FROM avisos)")[0]["n"],
        "retenidos": _consultar("SELECT (SELECT COUNT(*) FROM mural WHERE retenido = 1) + "
                                "(SELECT COUNT(*) FROM foro WHERE retenido = 1) AS n")[0]["n"],
    }


def version_panel():
    """Huella corta de todo lo que pinta el panel. Cambia cuando llega o cambia un mensaje, una
    reflexión, un aviso, un término del filtro o un ajuste (y cada minuto, si los mensajes caducan:
    así un mensaje pasa a «Caducado» sin recargar). Solo consultas de agregados: es barata."""
    partes = []
    for sql in (
        "SELECT COUNT(*), MAX(id), SUM(visible), SUM(retenido), SUM(LENGTH(style)), SUM(LENGTH(COALESCE(motivo, ''))), SUM(fijado) FROM mural",
        "SELECT COUNT(*), MAX(id), SUM(aprobado), SUM(retenido), SUM(LENGTH(COALESCE(motivo, ''))), SUM(fijado) FROM foro",
        "SELECT COUNT(*), MAX(id) FROM avisos",
        "SELECT COUNT(*), MAX(id), GROUP_CONCAT(termino || ':' || tipo) FROM filtros",
        "SELECT GROUP_CONCAT(clave || '=' || valor) FROM (SELECT clave, valor FROM ajustes ORDER BY clave)",
    ):
        partes.append(repr(tuple(_consultar(sql)[0].values())))
    if vida_mensajes_min():
        partes.append(str(int(time.time() // 60)))
    return hashlib.sha1("|".join(partes).encode("utf-8")).hexdigest()[:16]


if __name__ == "__main__":
    init_db()
    print(f"Base de datos lista en {DB_PATH}")
