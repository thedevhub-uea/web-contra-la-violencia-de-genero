#!/usr/bin/env bash
# Instalación en el servidor (T05). Se ejecuta UNA vez, pero repetirlo no rompe nada.
#
#   cd <carpeta del proyecto en el servidor>
#   bash deploy/instalar.sh
#
# Necesita sudo solo para instalar el servicio systemd.
set -euo pipefail
export PIP_USER=0   # por si el servidor fuerza instalaciones --user (rompe el venv)

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USUARIO="$(id -un)"
SERVICIO=25n-web
cd "$APP_DIR"

paso() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
error() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

paso "Comprobando Python (hace falta 3.10 o superior)"
PYTHON=""
for candidato in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidato" >/dev/null 2>&1 &&
       "$candidato" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
        PYTHON="$candidato"; break
    fi
done
[ -n "$PYTHON" ] || error "No hay Python 3.10+. En Debian/Ubuntu: sudo apt install python3 python3-venv"
echo "Usando $PYTHON ($("$PYTHON" --version))"

paso "Entorno virtual e instalación de dependencias"
if [ ! -x .venv/bin/python ]; then
    "$PYTHON" -m venv .venv || error "No se pudo crear el venv. En Debian/Ubuntu: sudo apt install python3-venv"
fi
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
.venv/bin/pybabel compile -d traducciones >/dev/null   # idiomas (i18n): .po → .mo

paso "Archivo .env (contraseñas)"
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Creado .env a partir de .env.example."
fi
chmod 600 .env
if grep -Eq '^ADMIN_PASS=\s*$' .env; then
    echo "AVISO: falta la contraseña ADMIN_PASS en $APP_DIR/.env."
    echo "       Rellénala y vuelve a ejecutar este script."
    exit 1
fi

paso "Base de datos"
set -a; . ./.env; set +a
.venv/bin/python -m bd.db

paso "Servicio systemd ($SERVICIO)"
sed -e "s|__USUARIO__|$USUARIO|g" -e "s|__APP_DIR__|$APP_DIR|g" \
    deploy/25n-web.service | sudo tee "/etc/systemd/system/$SERVICIO.service" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICIO" >/dev/null
sudo systemctl restart "$SERVICIO"
sleep 2
if systemctl is-active --quiet "$SERVICIO"; then
    echo "Servicio en marcha en 127.0.0.1:8256."
else
    echo "AVISO: el servicio no ha arrancado. Revisa: journalctl -u $SERVICIO -n 50"
    echo "       (Es normal mientras app.py de la T01 no esté terminado.)"
fi

paso "Fragmento para NGINX"
echo "Pega esto dentro del server {} del dominio, antes de 'location /colaboraciones/':"
echo "----------------------------------------------------------------------"
sed "s|__APP_DIR__|$APP_DIR|g" deploy/nginx-location.conf
echo "----------------------------------------------------------------------"
echo "Después: sudo nginx -t && sudo systemctl reload nginx"
echo "Y prueba: bash deploy/comprobar.sh https://<dominio>/colaboraciones/2026-2027/web-contra-la-violencia-de-genero"
