# Despliegue (T05)

URL pública: **https://thedevhub.santiagof.dev/colaboraciones/2026-2027/web-contra-la-violencia-de-genero/**
URL del QR (T10): **https://thedevhub.santiagof.dev/colaboraciones/2026-2027/web-contra-la-violencia-de-genero/participa**

```
Móvil / pantalla ──HTTPS──▶ NGINX (443)
                              ├─ …/static/*  → archivos de static/ (los sirve NGINX directamente)
                              └─ …/*         → gunicorn 127.0.0.1:8256 → wsgi.py → app.py → bd/db.py → datos/25n.db
```

| Archivo | Para qué |
|---|---|
| `wsgi.py` | Entrada de gunicorn. Aplica `ProxyFix` para que `url_for` añada el prefijo del subdirectorio. |
| `deploy/gunicorn.conf.py` | Puerto 8256 (solo local), 2 procesos × 4 hilos. |
| `deploy/25n-web.service` | Plantilla del servicio systemd (`25n-web`). |
| `deploy/nginx-location.conf` | Plantilla del fragmento de NGINX. |
| `deploy/instalar.sh` | Primera instalación. Se puede repetir sin problema. |
| `deploy/actualizar.sh` | Baja `main`, reinicia el servicio y lanza las pruebas. |
| `deploy/comprobar.sh` | Pruebas de humo: códigos HTTP, autenticación y prefijo en los formularios. |

## 1. Primera instalación (en el servidor)

```bash
git clone https://github.com/thedevhub-uea/web-contra-la-violencia-de-genero.git <carpeta>
cd <carpeta>
cp .env.example .env && nano .env      # contraseñas largas y distintas para admin y pantalla
bash deploy/instalar.sh
```

El script comprueba Python ≥ 3.10, crea `.venv`, instala dependencias, crea la BD, instala y arranca
el servicio `25n-web`, y **muestra el fragmento de NGINX** con las rutas reales ya puestas.

Pega ese fragmento en el `server {}` del dominio, **antes** de `location /colaboraciones/`, y recarga NGINX:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> La configuración real de NGINX y las rutas del servidor **no se suben al repositorio**.

## 2. Actualizar tras fusionar PRs

```bash
cd <carpeta> && bash deploy/actualizar.sh https://thedevhub.santiagof.dev/colaboraciones/2026-2027/web-contra-la-violencia-de-genero
```

## 3. Checklist para revisar cada PR antes de fusionarla

- [ ] Solo toca los archivos de su tarea (ver README).
- [ ] SQL solo en `bd/db.py`, siempre con `?` (nada de f-strings ni `+` en consultas).
- [ ] Texto de usuario en JS con `textContent`, nunca `innerHTML`.
- [ ] Ninguna contraseña ni clave en el código; solo en `.env`.
- [ ] **Ninguna ruta absoluta**: en plantillas `url_for(...)`; en JS, las URLs que da la plantilla (`data-*`).
      Buscar: `grep -rnE "(href|src|action)=\"/|fetch\('/" templates static`
- [ ] Sin `<script>` ni `<style>` en línea ni atributos `onclick=`/`style=`: la cabecera CSP del servidor puede bloquearlos.
- [ ] Sin colores sueltos en CSS/JS: todo sale de `static/css/paleta.css`, y
      `python herramientas/comprobar_contraste.py` termina sin errores.
- [ ] Usa los nombres de endpoint del README.
- [ ] Textos visibles traducibles (`_()` en plantillas y Python, `data-textos` en JS) y
      `pybabel compile -d traducciones --statistics` al 100 % (ver README, «Idiomas»).
- [ ] Funciona en local: `flask --app app run --debug`.

## 4. Prueba completa (el día antes del evento)

1. `bash deploy/comprobar.sh <URL pública>` → «Todo correcto».
2. Escanear el QR desde **2–3 móviles con datos móviles** (sin wifi del centro), Android e iPhone.
3. Enviar un mensaje burbuja y una reflexión desde cada uno → aparece `/gracias`.
4. En `/admin` (credenciales de admin): ocultar un mensaje y aprobar una reflexión.
5. En la pantalla real (`/pantalla`, credenciales de pantalla, F11): el mensaje oculto desaparece en ≤ 10 s
   y la reflexión aprobada aparece; dejarla 15 min y comprobar que completa un ciclo entero con el vídeo.
6. `sudo systemctl restart 25n-web` → los mensajes siguen ahí (la BD persiste).
7. Escanear el QR desde 3–4 m en la pantalla real.

### Sonido del vídeo en la sala

El vídeo tiene audio, pero los navegadores no dejan reproducirlo con sonido sin un gesto del usuario. Sin
ayuda, `/pantalla` arranca el vídeo en silencio (con un aviso) y suena solo tras un clic o una tecla.
Para una pantalla **desatendida**, lanza el navegador permitiendo el autoplay con sonido:

```bash
# Chrome / Edge (Windows: chrome.exe o msedge.exe; Linux: google-chrome / microsoft-edge)
chrome --autoplay-policy=no-user-gesture-required --kiosk <URL de /pantalla>
```

- La política equivalente para equipos gestionados es `AutoplayAllowed` (con `AutoplayAllowlist` para limitarla
  a la URL de la pantalla).
- **Audio:** en el sistema operativo, elige como salida predeterminada la del proyector (HDMI) o la de los
  altavoces, sube el volumen y comprueba con el vídeo (`/pantalla?seg=20`, «Saltar ahora» → vídeo en `/admin`)
  que suena por donde toca. El sitio no debe estar silenciado en el navegador (menú de la pestaña).
- Sin ese flag, **tras recargar la página** (o reiniciar el navegador) hace falta de nuevo un clic o tecla.
- `/pantalla?mudo` fuerza el silencio (ensayos). Si no hay audio, el vídeo sigue rotando en silencio:
  nunca bloquea la pantalla.

## 5. Durante el evento

```bash
journalctl -u 25n-web -f              # ver peticiones y errores en directo
sudo systemctl restart 25n-web        # si algo se queda colgado
systemctl status 25n-web
```

Si cae la app, la pantalla sigue mostrando los últimos datos (T04). El servicio se reinicia solo si gunicorn falla.

## 6. Reiniciar la base de datos al completo

Deja la app como recién instalada. **Se pierde todo lo guardado en la BD:**

| Se borra | Vuelve a… |
|---|---|
| Mensajes del mural, reflexiones del foro y avisos del público | vacío |
| Palabras del filtro (incluidas las añadidas desde el panel) | la lista de `bd/filtros_iniciales.txt` |
| Ajustes del panel (aprobación manual del foro, reglas de privacidad, retirada por avisos) | los valores por defecto (`AJUSTES_POR_DEFECTO` en `bd/db.py`) |

**No** se tocan `.env` (usuarios y contraseñas), el vídeo, el QR ni el código.

La BD es un único fichero SQLite: `datos/25n.db`, o la ruta de `DB_PATH` si está puesta en `.env`.
Como usa el modo WAL, junto a él pueden existir `25n.db-wal` y `25n.db-shm`: **hay que borrar los
tres**, o SQLite podría recuperar datos del `-wal`. Al volver a arrancar, `init_db()` crea las tablas,
carga el filtro inicial y los ajustes por defecto.

### En el servidor

Hay que **parar el servicio antes**: si gunicorn sigue con el fichero abierto, seguiría escribiendo
en la BD borrada.

```bash
cd <carpeta>
sudo systemctl stop 25n-web

set -a; . ./.env; set +a
BD="${DB_PATH:-datos/25n.db}"
echo "Se va a reiniciar: $BD"

# 1. Copia de seguridad (recomendado: si algo sale mal, se puede volver atrás)
mkdir -p datos/copias
COPIA="datos/copias/25n-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$COPIA"
cp -p "$BD"* "$COPIA"/ 2>/dev/null; ls -l "$COPIA"

# 2. Borrar la BD (los tres ficheros)
rm -f "$BD" "$BD-wal" "$BD-shm"

# 3. Crearla de nuevo y arrancar
.venv/bin/python -m bd.db
sudo systemctl start 25n-web
bash deploy/comprobar.sh https://thedevhub.santiagof.dev/colaboraciones/2026-2027/web-contra-la-violencia-de-genero
```

Para **volver a la copia**: `sudo systemctl stop 25n-web`, `rm -f "$BD" "$BD-wal" "$BD-shm"`,
copiar de vuelta los ficheros de `datos/copias/<fecha>/` a su sitio y `sudo systemctl start 25n-web`.

> `datos/` no se sube a git (`.gitignore`), así que las copias tampoco. Borra las copias viejas
> cuando ya no hagan falta: contienen los mensajes del público.

### En local (desarrollo)

Para el servidor de Flask (Ctrl+C) y:

```bash
rm -f datos/25n.db datos/25n.db-wal datos/25n.db-shm   # o la ruta de DB_PATH
python -m bd.db
flask --app app run --debug
```

### Cuándo hacerlo

- **Después de las pruebas y antes del evento**, para que la pantalla empiece vacía (después revisa en
  `/admin` que el filtro y los ajustes son los que quiere el equipo).
- **No** hace falta para aplicar cambios del esquema: `init_db()` añade al arrancar lo que falte sin borrar nada.
