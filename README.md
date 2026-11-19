# Web contra la violencia de género · 25N

Aplicación Flask para el 25N: el público deja mensajes desde el móvil (QR → `/participa`),
un filtro automático decide qué se publica (lo dudoso queda retenido para que la persona
moderadora lo revise en `/admin`), el público puede avisar de un mensaje inapropiado en `/avisar`
y una pantalla proyectada (`/pantalla`) va rotando entre el mural de burbujas, el vídeo y las
reflexiones del foro.

Las tareas están en [`docs/tareas/`](docs/tareas/).

## Estructura de carpetas

Cada archivo ya existe con un comentario que indica qué tarea lo rellena.
**No crees archivos fuera de esta estructura sin comentarlo antes con el equipo.**

```
.
├── app.py                  T01–T03 · rutas Flask (sin SQL: se usa bd/db.py)
├── wsgi.py                 T05 · entrada de producción (gunicorn)
├── bd/
│   ├── db.py               Acceso a la base de datos (todas las consultas)
│   ├── schema.sql          Tablas mural y foro (+ avisos, filtros y ajustes de T03)
│   ├── filtro.py           T03 · filtro automático de palabras y datos personales
│   └── filtros_iniciales.txt  T03 · lista de palabras con la que arranca el filtro
├── templates/              Plantillas Jinja (HTML)
│   ├── participa.html      T06 · formulario público
│   ├── gracias.html        T06 · confirmación
│   ├── admin.html          T03 · panel de moderación
│   ├── avisar.html         T03 · el público avisa de un mensaje inapropiado
│   ├── avisar_elemento.html  T03 · elegir el motivo del aviso
│   ├── _idioma.html        i18n · selector de idioma (macro)
│   └── pantalla.html       T04/T07/T08/T09/T10 · esqueleto común de la pantalla
├── static/
│   ├── css/
│   │   ├── paleta.css      T13 · paleta única de colores (se enlaza la primera en todas las páginas)
│   │   ├── estilos.css     T10 · estilos de la pantalla
│   │   ├── mural.css       T07 · mural de burbujas (lo carga mural.js)
│   │   ├── video.css       T08 · vista de vídeo (lo carga video.js)
│   │   ├── participa.css   T06 · estilos del formulario
│   │   ├── admin.css       T03 · estilos del panel
│   │   └── avisar.css      T03 · estilos de /avisar (sobre participa.css)
│   ├── js/
│   │   ├── participa.js    T06 · contador de caracteres del formulario
│   │   ├── admin.js        T03 · filtros, búsqueda, novedades y confirmación del panel
│   │   ├── avisar.js       T03 · buscador de /avisar
│   │   ├── pantalla.js     T04/T16 · rotación de vistas, actualización y barra de vistas
│   │   ├── mural.js        T07 · pintarMural(mensajes)
│   │   ├── video.js        T08 · iniciarVideo() / pararVideo()
│   │   └── foro.js         T09/T14 · pintarForo(elementos): reflexiones y mensajes del mural
│   ├── fonts/              T07 · fuentes del mural en local (woff2, OFL)
│   ├── img/qr.png          T10 · QR de /participa
│   └── video/video.mp4     T08 · vídeo de concienciación
├── traducciones/           i18n · catálogo (mensajes.pot) y en/LC_MESSAGES/messages.po
├── babel.cfg               i18n · qué archivos revisa pybabel
├── deploy/                 T05 · scripts y plantillas de despliegue
├── docs/
│   ├── tareas/             Enunciado de cada tarea (T01–T10)
│   ├── t10/                T10 · vista previa de estilos.css y lista de pruebas en móviles
│   └── DESPLIEGUE.md       T05 · guía de despliegue y checklist de PRs
├── herramientas/
│   ├── generar_qr.py       T10 · regenera static/img/qr.png (sin dependencias)
│   └── comprobar_contraste.py  T13 · comprueba el contraste de los pares de paleta.css (sin dependencias)
├── datos/                  Se crea solo: aquí vive 25n.db (no se sube a git)
├── requirements.txt
└── .env.example            Variables de entorno (copiar a .env)
```

## Puesta en marcha

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pybabel compile -d traducciones   # idiomas: genera los .mo (no se suben a git)
cp .env.example .env        # y rellena las contraseñas
python -m bd.db             # crea datos/25n.db
flask --app app run --debug
```

En producción la app corre con gunicorn detrás de NGINX en
**https://thedevhub.santiagof.dev/colaboraciones/2026-2027/web-contra-la-violencia-de-genero/**.
Ver [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

Para **reiniciar la base de datos al completo** (dejarla vacía, con el filtro y los ajustes por defecto)
ver [`docs/DESPLIEGUE.md` § 6](docs/DESPLIEGUE.md#6-reiniciar-la-base-de-datos-al-completo).

## URLs: la app vive en un subdirectorio

En producción todas las rutas llevan delante `/colaboraciones/2026-2027/web-contra-la-violencia-de-genero`.
Por eso **nunca se escriben rutas que empiecen por `/`**:

- **Plantillas:** siempre `url_for`.
  `<form method="POST" action="{{ url_for('crear_mural') }}">`,
  `<link href="{{ url_for('static', filename='css/estilos.css') }}">`
- **Python:** `redirect(url_for('gracias'))`, nunca `redirect('/gracias')`.
- **JavaScript:** las URLs las da la plantilla. `pantalla.html` las pone en `<body data-api-mural="…">`
  y el JS las lee con `document.body.dataset.apiMural`.

Nombres de las rutas (el nombre de la función en `app.py` = endpoint de `url_for`):

| Endpoint | Ruta | Método | Tarea |
|---|---|---|---|
| `inicio` | `/` → redirige a `participa` | GET | T01 |
| `participa` | `/participa` | GET | T01 |
| `crear_mural` | `/mural` | POST | T01 |
| `crear_foro` | `/foro` | POST | T01 |
| `gracias` | `/gracias` | GET | T01 |
| `pantalla` | `/pantalla` | GET | T02 |
| `api_mural` | `/api/mural` | GET | T02 |
| `api_foro` | `/api/foro` | GET | T02 |
| `api_pantalla` | `/api/pantalla` (órdenes del panel para la pantalla) | GET | Control de pantalla |
| `admin` | `/admin` | GET | T03 |
| `admin_accion` | `/admin/<tabla>/<int:id>/<accion>` | POST | T03 |
| `admin_estado` | `/admin/estado` (contadores en JSON) | GET | T03 |
| `admin_filtro_anadir` | `/admin/filtros` | POST | T03 |
| `admin_filtro_quitar` | `/admin/filtros/<int:id>/borrar` | POST | T03 |
| `admin_ajustes` | `/admin/ajustes` | POST | T03 |
| `admin_pantalla` | `/admin/pantalla` (saltar / fijar / soltar una vista) | POST | Control de pantalla |
| `avisar` | `/avisar` (público) | GET | T03 |
| `avisar_elemento` | `/avisar/<tabla>/<int:id>` (público) | GET, POST | T03 |
| `cambiar_idioma` | `/idioma/<codigo>?volver=<ruta>` (guarda la cookie y vuelve) | GET | i18n |

Usuarios de HTTP Basic Auth: `admin` y `pantalla` (variables `ADMIN_USER`/`PANTALLA_USER` en `.env`),
con las contraseñas `ADMIN_PASS` y `PANTALLA_PASS`.

## Colores y contraste (T13)

Toda la web usa un **tema claro** y todos los colores salen de [`static/css/paleta.css`](static/css/paleta.css),
que es la primera hoja que se enlaza en `pantalla.html`, `participa.html`, `gracias.html`, `avisar*.html`
y `admin.html`. **Ninguna hoja de estilos ni JS lleva colores sueltos** (`#hex`, `rgb()`…): se usa
`var(--texto)`, `var(--acento)`… Para poner transparencia se usa la tripleta:
`rgb(var(--acento-rgb) / .5)`.

- **Mural:** las burbujas son de color vivo con opacidad alta (`--burbuja-alfa`). `mural.js` lee los colores
  de la paleta y elige para cada burbuja el texto claro u oscuro que dé ≥ 4,5:1 (razón de contraste WCAG);
  si ninguno llega, aclara u oscurece un poco la burbuja.
- **Vídeo:** es oscuro por naturaleza; se enmarca sobre fondo claro y las franjas son `--letterbox`.
- **Comprobar el contraste** (tras tocar `paleta.css`): `python herramientas/comprobar_contraste.py`
  (`-v` para ver todos los pares). Lee los pares escritos en `paleta.css` con `@par --texto --fondo [grande]`
  y falla si alguno baja de 4,5:1 (3:1 si es «grande»: texto ≥ 24 px, ≥ 18,66 px en negrita, o un trazo).
  Si añades un color de texto o de fondo nuevo, añade su `@par`.
- **Prueba en la sala real** (no se puede automatizar): con brillo máximo, la luz ambiente de la sala y el
  proyector real, leer el mural, el foro y el QR desde 3–4 m.

## Moderación (T03)

- **Foro:** por defecto las reflexiones **no salen hasta que moderación las aprueba** en `/admin`
  («Pendientes de revisar»), porque pueden contar casos reales con nombres o lugares.
  Relajarlo (que se publiquen solas si pasan el filtro) es una decisión del equipo desde el panel.
- **Filtro automático** (`bd/filtro.py`): los mensajes del mural se publican solos salvo los que
  contienen una palabra de la lista o datos personales (enlaces, correos, teléfonos, @usuarios).
  Esos quedan pendientes en `/admin` para publicarlos igualmente o borrarlos. El filtro entiende
  tildes, plurales, mayúsculas y trucos (`z0rra`, `p.u.t.a`, `p4ta`: un número o símbolo en lugar de una vocal vale por cualquier vocal); con `*` al final cubre todo lo que
  empiece igual. La lista y las reglas se cambian desde el panel; la primera vez se carga
  `bd/filtros_iniciales.txt`. El filtro **no** detecta nombres ni lugares.
- **Avisos del público** (`/avisar`, enlazado desde `/participa` y `/gracias`): quien vea algo
  inapropiado en la pantalla lo marca y aparece en «Avisos del público» del panel. Por defecto
  **no retiran nada solos**. La retirada automática al llegar a N avisos es un ajuste opcional y
  apagado: la cookie anónima que evita contar dos veces el mismo móvil se puede saltar.
- Los formularios del panel llevan un token CSRF derivado de `ADMIN_PASS`.
- Una base de datos creada antes de T03 se actualiza sola al arrancar (`init_db()` añade lo que falte).

## Control de la pantalla desde el panel

En `/admin`, sección **Pantalla**, se puede mandar a `/pantalla` a una vista concreta:

- **Saltar ahora** (mural, vídeo o foro): cambia una vez y sigue la rotación normal desde ahí.
- **Fijar**: la pantalla se queda en esa vista (el vídeo se repite) hasta pulsar
  **Volver a la rotación automática**.

`pantalla.js` pregunta cada 3 s a `/api/pantalla` (`{fijada, salto_vista, salto_id}`), así que la
pantalla obedece en unos segundos. Las órdenes se guardan en la tabla `ajustes`
(`pantalla_fijada`, `pantalla_salto_vista`, `pantalla_salto_id`): si se recarga `/pantalla`
respeta la vista fijada, pero no repite un salto antiguo. Si el vídeo está fijado y no se puede
reproducir, la pantalla rota con normalidad para no quedarse en negro.

## Foro con mensajes y reflexiones (T14)

El foro de la pantalla muestra **reflexiones aprobadas y mensajes del mural visibles, mezclados**.
`/api/foro` devuelve una sola lista (más recientes primero, máximo 60) con el campo `tipo`:

```json
[{"tipo": "mensaje",   "id": 5, "titulo": null,    "texto": "Te creo"},
 {"tipo": "reflexion", "id": 5, "titulo": "Título", "texto": "…"}]
```

- Los **ids chocan entre tablas** (mural 5 y foro 5): en `foro.js` toda identidad es `tipo + ':' + id`.
- La consulta es `db.listar_foro_mixto()` (`UNION ALL` de `mural` con `visible = 1` y `foro` con `aprobado = 1`).
  `listar_foro()` se mantiene porque lo usa el panel. Los mensajes siguen saliendo también en el mural.
- Tarjetas: `.foro-tarjeta--reflexion` (título + texto) y `.foro-tarjeta--mensaje` (corta, sin título, texto
  grande y centrado). Siguen siendo 3 por página, cada 15 s.
- Moderación: ocultar un mensaje o retirar una reflexión en `/admin` los quita del foro en el siguiente refresco.
- Prueba sin API: `/pantalla?demo-foro` (o `?demo-foro=N`, mezcla; con `&tipo=mensajes` o `&tipo=reflexiones`
  solo de un tipo). En modo demo los datos reales de la API no pisan los de prueba.

## Barra de vistas de la pantalla (T16)

`pantalla.js` crea arriba de `/pantalla` una barra **solo informativa** (no clicable) con las vistas de
`CONFIG.secuencia` (Mural / Wall · Vídeo / Video · Foro / Forum) y marca la activa con la clase
`barra-vista--activa` y `aria-current="page"`. Se actualiza dentro de `mostrarVista()`, así que también sigue
los saltos y las vistas fijadas desde `/admin`. Para reservar su sitio, `--barra-alto` (en `estilos.css`) es el
inset superior de las tres vistas (`.vista`, `#vista-mural.mural`, `#vista-video.video-vista`) y se descuenta en
el cálculo del marco del vídeo. El botón de pantalla completa se movió arriba a la izquierda, dentro de la
franja de la barra.

## Aro de tiempo del mural (T17)

Mientras dura el mural, un aro (un `<svg>` fijo que crea `pantalla.js`) va recorriendo el borde de la pantalla
y se completa justo cuando termina: es el tiempo que queda hasta el vídeo. Se pinta con un `<rect pathLength="1">`
y la animación CSS `stroke-dashoffset` (1 → 0, lineal), no con `conic-gradient`, para que avance por perímetro
y no por ángulo en un rectángulo 16:9. Detalles:

- **La fuente de verdad es `programarFin(nombre)`:** cuando programa el temporizador del mural, arranca el aro con
  exactamente esa duración (`CONFIG.duracion.mural`, que ya respeta `?seg=`); cuando no hay temporizador (vídeo,
  foro o **mural fijado desde `/admin`**) lo oculta, así que con el mural fijado el aro no se llena nunca. Fijar
  o soltar el mural desde el panel lo oculta o lo reinicia.
- El `viewBox` va en píxeles y se recalcula en `resize` y `fullscreenchange`, descontando medio grosor para que
  el trazo no se recorte. Grosor y color: `--aro-grosor` y `--aro-color` en `paleta.css` (contraste ≥ 3:1).
- Va por debajo de la barra de vistas y del QR. Las vistas, la barra y el botón de pantalla completa se
  insertan `--aro-grosor` (`--vista-lado` / `--vista-top` en `estilos.css`) para que el aro no los pise.
- Con `prefers-reduced-motion` el aro avanza a saltos del 1 % en vez de suavemente, pero sigue funcionando.

## Idiomas (i18n)

La web está en **español** (idioma de los textos en el código) e **inglés**, con
[Flask-Babel](https://python-babel.github.io/flask-babel/).

- **Qué idioma se ve:** el elegido en el selector (cookie `idioma`, un año) → si no, el del
  navegador (`Accept-Language`) → si no, español. El selector está en `/participa`, `/gracias`,
  `/avisar` y `/admin`. `/pantalla` no lo muestra (se proyecta): para cambiarla, abrir en ese
  navegador `…/idioma/en?volver=/pantalla` (o `es`). El lema del QR y la cabecera del foro de la
  pantalla son bilingües a propósito.
- **Qué no se traduce:** lo que escribe el público, las palabras del filtro y el vídeo.
  Los motivos que guarda la BD («Pendiente de aprobación», «Palabra filtrada: «…»») se guardan en
  español y se traducen al mostrarlos (filtro `motivo` en `app.py`).

**Cómo escribir textos nuevos**

- Plantillas: `{{ _('Texto') }}`, con datos `{{ _('Mensaje #%(id)s', id=e.id) }}`, plurales
  `{{ ngettext('%(num)d aviso', '%(num)d avisos', n) }}`. Nada de HTML dentro del texto: si hace
  falta, se pasa como dato con `|safe` (ver «Búscalo aquí y pulsa…» en `avisar.html`).
- Python: `_()` dentro de una petición; `_l()` en constantes del módulo (`_AVISOS_PANEL`).
- JavaScript: la plantilla pasa los textos ya traducidos en `<body data-textos='{{ {...} | tojson }}'>`
  y el JS los lee con `t('clave', 'español por defecto')`. Nunca `<script>` en línea.

**Actualizar las traducciones** (tras añadir o cambiar textos):

```bash
pybabel extract -F babel.cfg -k _l --no-location --sort-output -o traducciones/mensajes.pot .
pybabel update -i traducciones/mensajes.pot -d traducciones --no-fuzzy-matching
# traducir los msgstr vacíos de traducciones/en/LC_MESSAGES/messages.po
pybabel compile -d traducciones --statistics      # debe decir 100% translated
```

**Añadir otro idioma** (p. ej. gallego): `pybabel init -i traducciones/mensajes.pot -d traducciones -l gl`,
traducir el `.po`, compilar y añadir `"gl": "Galego"` a `IDIOMAS` en `app.py`.

Los `.mo` no se suben a git: `deploy/instalar.sh` y `deploy/actualizar.sh` los compilan.

## Normas del equipo

1. **Una rama por tarea**, creada desde `main`: `t01-backend-base`, `t07-mural-burbujas`…
   Nunca se trabaja directamente en `main`. Se integra con una Pull Request.
2. **Toca solo los archivos de tu tarea.** En `pantalla.html` cada tarea rellena únicamente su
   `<section>` o bloque marcado; no reordenes lo demás.
3. **Base de datos:** solo desde `bd/db.py`, con consultas parametrizadas (`?`).
   Si necesitas una consulta nueva, añádela allí como función.
4. **Texto de usuario en JavaScript:** siempre `textContent`, nunca `innerHTML`.
5. **Contraseñas:** solo en `.env` (que no se sube). Nada de claves en el código.
6. **Nombres** en español y sin tildes en archivos, funciones y variables
   (`pintarMural`, `listar_foro`, `vista-mural`).
7. **Nunca rutas absolutas** (ver «URLs» arriba): `url_for` en plantillas y Python; en JS, las URLs de `data-*`.
8. **Sin JavaScript ni CSS en línea:** nada de `<script>…</script>`, `<style>`, `onclick=` ni `style=` en el HTML.
   Todo va en `static/js/` y `static/css/` (el servidor puede bloquearlo por seguridad).
