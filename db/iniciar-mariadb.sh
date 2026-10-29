#!/bin/sh
# Punto de entrada de mariadb-master y mariadb-audit (se corre con «sh», no necesita bit de ejecución).
#
# El entrypoint de MariaDB EJECUTA los .sh de /docker-entrypoint-initdb.d que tienen bit de ejecución y
# CARGA con «source» los que no lo tienen. Los nuestros deben cargarse con source, porque usan
# docker_process_sql. En macOS con Docker Desktop, los archivos montados pueden verse como ejecutables:
# el script fallaba, las bases quedaban vacías y el contenedor igual aparecía como «healthy».
# Por eso los scripts se montan en /huellitas-initdb y aquí se copian con permisos 644, sin depender
# de los permisos del equipo anfitrión.
set -eu
cp -R /huellitas-initdb/. /docker-entrypoint-initdb.d/
find /docker-entrypoint-initdb.d -type f -exec chmod 0644 {} +
exec docker-entrypoint.sh "$@"
