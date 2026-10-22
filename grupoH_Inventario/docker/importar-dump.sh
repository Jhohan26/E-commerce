#!/bin/bash
# Se ejecuta UNA sola vez, al crear el volumen de MySQL por primera vez
# (/docker-entrypoint-initdb.d). Importa esquema + datos del dump original.
set -e

DUMP=/dump/inventario_dump.sql
echo ">> Importando $DUMP en la base '${MYSQL_DATABASE}'..."

# El dump trae SET @@GLOBAL.GTID_PURGED, que falla en un servidor sin GTID
# (y no aporta nada aquí). Se filtra al vuelo sin tocar el archivo original.
grep -v 'GTID_PURGED' "$DUMP" | mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" --default-character-set=utf8mb4

echo ">> Dump importado."
