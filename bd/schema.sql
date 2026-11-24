-- Esquema de la base de datos SQLite del proyecto 25N.
-- Se aplica con init_db() en bd/db.py (o: sqlite3 datos/25n.db < bd/schema.sql).
-- Es idempotente: se puede ejecutar varias veces sin perder datos.

-- Mensajes cortos del mural de burbujas (T01, T02, T03, T07).
-- Se publican directamente si pasan el filtro automático (T03); si no, quedan
-- retenidos (visible = 0, retenido = 1) hasta que moderación decida.
-- Estados: visible = 1 → en pantalla · retenido = 1 → parado por el filtro ·
--          visible = 0 y retenido = 0 → retirado por moderación o por avisos.
-- motivo:   por qué está retenido o retirado (solo lo ve moderación).
-- revisado: 1 si moderación lo publicó a mano; el filtro ya no lo vuelve a retirar.
-- (En una base de datos anterior, bd/db.py añade retenido, motivo y revisado al arrancar.)
CREATE TABLE IF NOT EXISTS mural (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    texto    TEXT    NOT NULL CHECK (length(trim(texto)) BETWEEN 1 AND 280),
    creado   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    visible  INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
    retenido INTEGER NOT NULL DEFAULT 0 CHECK (retenido IN (0, 1)),
    motivo   TEXT,
    revisado INTEGER NOT NULL DEFAULT 0 CHECK (revisado IN (0, 1)),
    style    TEXT    NOT NULL DEFAULT '{}',  -- CONECTA: estilo de la burbuja (JSON saneado, ver bd/estilo.py)
    fijado   INTEGER NOT NULL DEFAULT 0 CHECK (fijado IN (0, 1))  -- 1: no caduca (lo fija moderación)
);

-- Reflexiones del foro (T01, T02, T03, T09).
-- Por defecto esperan a que moderación las apruebe (ajuste foro_manual = 1): llegan
-- retenidas con el motivo «Pendiente de aprobación», o con el del filtro si lo activan.
-- Si el equipo desactiva foro_manual desde el panel, las que pasan el filtro se aprueban solas.
CREATE TABLE IF NOT EXISTS foro (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo   TEXT    NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 80),
    texto    TEXT    NOT NULL CHECK (length(trim(texto))  BETWEEN 1 AND 1000),
    creado   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    aprobado INTEGER NOT NULL DEFAULT 0 CHECK (aprobado IN (0, 1)),
    retenido INTEGER NOT NULL DEFAULT 0 CHECK (retenido IN (0, 1)),
    motivo   TEXT,
    revisado INTEGER NOT NULL DEFAULT 0 CHECK (revisado IN (0, 1)),
    fijado   INTEGER NOT NULL DEFAULT 0 CHECK (fijado IN (0, 1))  -- 1: siempre sale en el foro (no la desplazan las nuevas)
);

-- Índices para las consultas de la pantalla (/api/mural y /api/foro).
CREATE INDEX IF NOT EXISTS idx_mural_visible_creado ON mural (visible, creado DESC);
CREATE INDEX IF NOT EXISTS idx_foro_aprobado_creado ON foro (aprobado, creado DESC);

-- Avisos del público (T03): alguien marca como inapropiado algo que está en pantalla.
-- Por defecto solo lo marcan en el panel. Si se activa el ajuste retirar_por_avisos, al llegar
-- a N avisos (avisos_para_ocultar) se retira solo. Cuando moderación decide (mantener o borrar)
-- se eliminan los avisos de ese elemento.
CREATE TABLE IF NOT EXISTS avisos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tabla       TEXT    NOT NULL CHECK (tabla IN ('mural', 'foro')),
    elemento_id INTEGER NOT NULL,
    motivo      TEXT    NOT NULL CHECK (motivo IN ('odio', 'acoso', 'datos', 'otro')),
    avisador    TEXT    NOT NULL,  -- hash de una cookie anónima: el mismo móvil no cuenta dos veces
    creado      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    UNIQUE (tabla, elemento_id, avisador)
);
CREATE INDEX IF NOT EXISTS idx_avisos_elemento ON avisos (tabla, elemento_id);

-- Palabras y expresiones del filtro automático (T03). Ver bd/filtro.py.
CREATE TABLE IF NOT EXISTS filtros (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    termino TEXT    NOT NULL UNIQUE,
    creado  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
);

-- Ajustes de moderación que se cambian desde el panel (T03).
CREATE TABLE IF NOT EXISTS ajustes (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);

-- CONECTA: preguntas del foro en español e inglés, editables desde el panel (ver bd/db.py).
-- «titulo» es el texto con el que se guardan las respuestas en foro.titulo (máx. 80 caracteres);
-- las respuestas antiguas se siguen asociando a su pregunta por ese título.
CREATE TABLE IF NOT EXISTS foro_preguntas (
    id      INTEGER PRIMARY KEY,
    titulo  TEXT NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 80),
    text_es TEXT NOT NULL CHECK (length(trim(text_es)) BETWEEN 1 AND 400),
    text_en TEXT NOT NULL DEFAULT '' CHECK (length(text_en) <= 400)
);
