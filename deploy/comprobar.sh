#!/usr/bin/env bash
# Pruebas de humo (T05): comprueba que la app responde como debe.
#
#   bash deploy/comprobar.sh                       # contra gunicorn en local (127.0.0.1:8256)
#   bash deploy/comprobar.sh https://<dominio>/colaboraciones/2026-2027/web-contra-la-violencia-de-genero
#
# Lee los usuarios y contraseñas de .env. No escribe nada en la base de datos.
set -uo pipefail

BASE="${1:-http://127.0.0.1:8256}"
BASE="${BASE%/}"
# Prefijo = parte de la ruta de la URL base ("" en local).
PREFIJO="$(printf '%s' "$BASE" | sed -E 's|^https?://[^/]+||')"

cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }
ADMIN_USER="${ADMIN_USER:-admin}"

fallos=0
ok()    { printf '  \033[32mOK\033[0m    %s\n' "$*"; }
fallo() { printf '  \033[31mFALLO\033[0m %s\n' "$*"; fallos=$((fallos + 1)); }

codigo() { # codigo <ruta> [usuario:clave]
    local auth=()
    [ -n "${2:-}" ] && auth=(-u "$2")
    curl -s -o /dev/null -w '%{http_code}' --max-time 10 ${auth[@]+"${auth[@]}"} "$BASE$1"
}

espera() { # espera <descripción> <códigos permitidos separados por |> <ruta> [usuario:clave]
    local c; c="$(codigo "$3" "${4:-}")"
    if [[ "|$2|" == *"|$c|"* ]]; then ok "$1 → $c"; else fallo "$1 → $c (se esperaba $2)"; fi
}

echo "Comprobando $BASE"

espera "Formulario público /participa"          200 /participa
html="$(curl -s --max-time 10 "$BASE/participa")"
if [[ "$html" == *"action=\"$PREFIJO/mural\""* && "$html" == *"action=\"$PREFIJO/foro\""* ]]; then
    ok "Los formularios apuntan a $PREFIJO/mural y $PREFIJO/foro"
else
    fallo "Los formularios no usan url_for (no se encuentra action=\"$PREFIJO/mural\" y /foro)"
fi
espera "CSS estático"                           200 /static/css/estilos.css

espera "/pantalla sin credenciales (pública)"   200 /pantalla
espera "/api/mural sin credenciales (pública)"  200 /api/mural
espera "/api/foro sin credenciales (pública)"   200 /api/foro
espera "/admin sin credenciales"                401 /admin

if [ -n "${ADMIN_PASS:-}" ]; then
    espera "/admin con credenciales de admin" 200 /admin "$ADMIN_USER:$ADMIN_PASS"
else
    fallo "ADMIN_PASS no está en .env: no se prueban las credenciales de admin"
fi

echo
if [ "$fallos" -eq 0 ]; then
    echo "Todo correcto."
else
    echo "$fallos comprobación(es) fallida(s)."
    exit 1
fi
