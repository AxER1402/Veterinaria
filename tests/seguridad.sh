#!/usr/bin/env bash
# Pruebas de seguridad end-to-end contra el stack levantado con `docker compose up -d`.
#   tests/seguridad.sh            # usa https://localhost:8443
#   BASE=https://otra-url tests/seguridad.sh
# Requiere: curl, jq, docker compose (para los casos que miran BD/contenedores).
set -uo pipefail
cd "$(dirname "$0")/.."
source .env

BASE=${BASE:-https://localhost:${HTTPS_PORT:-8443}}
HTTP=${HTTP:-http://localhost:${HTTP_PORT:-8088}}
C=(curl -sk --max-time 10)
pasaron=0; fallaron=0

ok()   { echo "  ✔ $1"; pasaron=$((pasaron+1)); }
mal()  { echo "  ✘ $1"; fallaron=$((fallaron+1)); }
caso() { echo; echo "$1"; }
esperar() { # esperar <descripción> <esperado> <obtenido>
    if [[ "$3" == "$2" ]]; then ok "$1"; else mal "$1 (esperado $2, obtenido $3)"; fi
}
codigo() { "${C[@]}" -o /dev/null -w '%{http_code}' "$@"; }
post()   { local url=$1 datos=$2; shift 2; "${C[@]}" -X POST -H 'Content-Type: application/json' -d "$datos" "$@" "$BASE$url"; }
login()  { post /api/auth/login "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -r '.token // empty'; }

# Se limpian los contadores de login de corridas anteriores para que la prueba sea repetible.
docker compose exec -T redis sh -c 'redis-cli --scan --pattern "login:*" | xargs -r redis-cli del' >/dev/null

SUF=$(date +%s%N | tail -c 8)
CLIENTE="prueba$SUF@correo.gt"

caso "CP-01 HTTPS obligatorio"
esperar "HTTP redirige a HTTPS (301)" 301 "$(codigo "$HTTP/")"
"${C[@]}" -o /dev/null -D - "$HTTP/tienda" | grep -qi "^location: https://" && ok "Location apunta a https://" || mal "Location no apunta a https://"
esperar "Frontend por HTTPS" 200 "$(codigo "$BASE/")"

caso "CP-02 Solo TLS 1.3"
esperar "TLS 1.2 rechazado" 000 "$(codigo --tls-max 1.2 "$BASE/")"
esperar "TLS 1.3 aceptado" 200 "$(codigo --tlsv1.3 "$BASE/")"

caso "CP-03 Cabeceras de seguridad"
cab=$("${C[@]}" -o /dev/null -D - "$BASE/")
for h in Strict-Transport-Security Content-Security-Policy X-Content-Type-Options X-Frame-Options Referrer-Policy; do
    grep -qi "^$h:" <<<"$cab" && ok "$h presente" || mal "falta $h"
done
grep -qi "^server: nginx/" <<<"$cab" && mal "Server revela la versión" || ok "Server no revela la versión"

caso "CP-04 Registro (A03, E de STRIDE: el rol no viene del cliente)"
r=$(post /api/auth/registro "{\"nombre\":\"Cliente $SUF\",\"email\":\"$CLIENTE\",\"password\":\"Segura123\",\"rol\":\"admin\"}")
esperar "registro devuelve rol cliente aunque se envíe rol=admin" cliente "$(jq -r .usuario.rol <<<"$r")"
esperar "correo duplicado → 409" 409 "$(codigo -X POST -H 'Content-Type: application/json' -d "{\"nombre\":\"Otro\",\"email\":\"$CLIENTE\",\"password\":\"Segura123\"}" "$BASE/api/auth/registro")"
esperar "contraseña débil → 422" 422 "$(codigo -X POST -H 'Content-Type: application/json' -d '{"nombre":"Otro","email":"debil@correo.gt","password":"123"}' "$BASE/api/auth/registro")"

caso "CP-05 Login y JWT (A07)"
TOKEN=$(login "$CLIENTE" Segura123)
[[ -n "$TOKEN" ]] && ok "login correcto devuelve JWT" || mal "login correcto no devolvió token"
exp=$(cut -d. -f2 <<<"$TOKEN" | tr '_-' '/+' | base64 -d 2>/dev/null | jq -r '.exp - .iat' 2>/dev/null)
esperar "el JWT expira en 1 h" 3600 "$exp"
esperar "/me con token → 200" 200 "$(codigo -H "Authorization: Bearer $TOKEN" "$BASE/api/auth/me")"
esperar "/me sin token → 401" 401 "$(codigo "$BASE/api/auth/me")"
esperar "contraseña incorrecta → 401 genérico" "Credenciales inválidas" "$(post /api/auth/login "{\"email\":\"$CLIENTE\",\"password\":\"Mala1234\"}" | jq -r .error)"
esperar "correo inexistente → mismo mensaje (sin enumeración)" "Credenciales inválidas" "$(post /api/auth/login '{"email":"noexiste@correo.gt","password":"Mala1234"}' | jq -r .error)"

caso "CP-06 Tokens manipulados (E de STRIDE)"
h=$(printf '{"alg":"none","typ":"JWT"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
p=$(cut -d. -f2 <<<"$TOKEN" | tr '_-' '/+' | base64 -d 2>/dev/null | jq -c '.rol="admin"' | base64 -w0 | tr '+/' '-_' | tr -d '=')
esperar "alg=none → 401" 401 "$(codigo -H "Authorization: Bearer $h.$p.x" "$BASE/api/auth/me")"
firma=$(cut -d. -f3 <<<"$TOKEN")
esperar "payload con rol=admin y firma original → 401" 401 "$(codigo -H "Authorization: Bearer $(cut -d. -f1 <<<"$TOKEN").$p.$firma" "$BASE/api/auth/me")"

caso "CP-07 Control de acceso al panel admin (A01)"
esperar "cliente → /admin/acceso 403" 403 "$(codigo -X POST -H "Authorization: Bearer $TOKEN" "$BASE/api/auth/admin/acceso")"
esperar "cliente → bitácora 403" 403 "$(codigo -H "Authorization: Bearer $TOKEN" "$BASE/api/auditoria/eventos")"
ADMIN=$(login admin@huellitas.gt 'Admin#2026')
esperar "admin → /admin/acceso 200" 200 "$(codigo -X POST -H "Authorization: Bearer $ADMIN" "$BASE/api/auth/admin/acceso")"

caso "CP-08 Logout invalida el token en Redis (A07)"
esperar "logout → 200" 200 "$(codigo -X POST -H "Authorization: Bearer $TOKEN" "$BASE/api/auth/logout")"
esperar "el mismo token después del logout" "Token revocado" "$("${C[@]}" -H "Authorization: Bearer $TOKEN" "$BASE/api/auth/me" | jq -r .error)"

caso "CP-09 Bloqueo tras 5 intentos fallidos durante 15 min (A07)"
for i in 1 2 3 4; do post /api/auth/login "{\"email\":\"$CLIENTE\",\"password\":\"Mala1234\"}" >/dev/null; done
esperar "5.º intento fallido → 423" 423 "$(codigo -X POST -H 'Content-Type: application/json' -d "{\"email\":\"$CLIENTE\",\"password\":\"Mala1234\"}" "$BASE/api/auth/login")"
esperar "contraseña correcta durante el bloqueo → 423" 423 "$(codigo -X POST -H 'Content-Type: application/json' -d "{\"email\":\"$CLIENTE\",\"password\":\"Segura123\"}" "$BASE/api/auth/login")"

caso "CP-10 WAF y validación de entradas (A03)"
esperar "SQLi en la URL → 403" 403 "$(codigo "$BASE/tienda/productos?q=1'%20OR%20'1'='1")"
esperar "UNION SELECT en la URL → 403" 403 "$(codigo "$BASE/tienda?id=1%20UNION%20SELECT%20password")"
esperar "XSS en la URL → 403" 403 "$(codigo "$BASE/tienda?q=%3Cscript%3Ealert(1)%3C/script%3E")"
# Nginx ya rechaza con 400 las rutas que se salen de la raíz, antes de llegar al WAF.
[[ "$(codigo --path-as-is "$BASE/../../etc/passwd")" =~ ^(400|403)$ ]] && ok "path traversal rechazado" || mal "path traversal no fue rechazado"
esperar "User-Agent de sqlmap → 403" 403 "$(codigo -A 'sqlmap/1.7' "$BASE/")"
esperar "XSS en el cuerpo JSON → 400" 400 "$(codigo -X POST -H 'Content-Type: application/json' -d '{"nombre":"<script>alert(1)</script>","email":"xss@correo.gt","password":"Segura123"}' "$BASE/api/auth/registro")"
esperar "SQLi en el cuerpo JSON → 400" 400 "$(codigo -X POST -H 'Content-Type: application/json' -d "{\"nombre\":\"x' OR 1=1 --\",\"email\":\"sqli@correo.gt\",\"password\":\"Segura123\"}" "$BASE/api/auth/registro")"

caso "CP-11 Rutas internas y Zero Trust entre servicios"
esperar "/internal/eventos no se publica en el gateway" 404 "$(codigo -X POST "$BASE/internal/eventos")"
r=$(docker compose exec -T auth-service php -r '
    const SERVICE_DIR = "/var/www/app"; require "/var/www/shared/bootstrap.php";
    $hit = function ($token) { $ch = curl_init("http://security-audit-service:8086/internal/eventos");
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ["Content-Type: application/json", "Authorization: Bearer $token"],
            CURLOPT_POSTFIELDS => json_encode(["accion" => "PAGO_CONFIRMADO", "resultado" => "EXITO"])]);
        curl_exec($ch); return curl_getinfo($ch, CURLINFO_RESPONSE_CODE); };
    $t = Huellitas\Jwt::tokenServicio("auth-service");
    echo $hit(""), " ", $hit($t), " ", $hit($t);')
read -r sin_token servicio_ajeno reuso <<<"$r"
esperar "llamada interna sin JWT → 401" 401 "$sin_token"
esperar "auth-service no puede emitir PAGO_CONFIRMADO → 403" 403 "$servicio_ajeno"
esperar "token de servicio reutilizado → 401" 401 "$reuso"

caso "CP-12 Bitácora de auditoría (A09)"
res=$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/auditoria/resumen")
for ev in REGISTRO_CLIENTE LOGIN_CLIENTE_EXITOSO LOGIN_CLIENTE_FALLIDO ACCESO_ADMIN_PANEL TOKEN_REVOCADO; do
    jq -e --arg e "$ev" '.por_evento[] | select(.accion == $e)' <<<"$res" >/dev/null && ok "evento $ev registrado" || mal "no hay eventos $ev"
done
ultimo=$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/auditoria/eventos?accion=TOKEN_REVOCADO&limite=1" | jq -r '.eventos[0] | "\(.servicio)|\(.usuario_email)|\(.ip_origen != null)"')
esperar "TOKEN_REVOCADO trae servicio, usuario e IP" "auth-service|$CLIENTE|true" "$ultimo"
esperar "cadena de hashes íntegra" true "$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/auditoria/integridad" | jq -r .integra)"

caso "CP-13 Bitácora append-only"
sql() { docker compose exec -T mariadb-audit mariadb -N "$@" 2>&1; }
salida=$(sql -uroot -p"$AUDIT_DB_ROOT_PASSWORD" audit_db -e "UPDATE security_audit_logs SET resultado='EXITO' LIMIT 1")
grep -q "append-only" <<<"$salida" && ok "UPDATE bloqueado por trigger (incluso root)" || mal "UPDATE no fue bloqueado"
salida=$(sql -uroot -p"$AUDIT_DB_ROOT_PASSWORD" audit_db -e "DELETE FROM security_audit_logs LIMIT 1")
grep -q "append-only" <<<"$salida" && ok "DELETE bloqueado por trigger (incluso root)" || mal "DELETE no fue bloqueado"
salida=$(sql -uaudit_user -p"$AUDIT_DB_PASSWORD" audit_db -e "SHOW GRANTS")
grep -q "GRANT SELECT, INSERT ON" <<<"$salida" && ok "audit_user solo tiene SELECT, INSERT" || mal "audit_user tiene permisos de más"
esperar "no hay rutas DELETE en el servicio" 405 "$(codigo -X DELETE -H "Authorization: Bearer $ADMIN" "$BASE/api/auditoria/eventos")"

caso "CP-14 Hardening Docker (A05, SEC-5)"
puertos=$(docker compose ps --format '{{.Service}} {{.Ports}}')
grep -E "0\.0\.0\.0:[0-9]+->(3306|6379)" <<<"$puertos" && mal "BD o Redis publicados" || ok "MariaDB y Redis sin puertos publicados"
for s in auth-service security-audit-service; do
    esperar "$s corre como www-data" www-data "$(docker compose exec -T "$s" whoami)"
done
esperar "red interna sin salida a Internet" 000 "$(docker compose exec -T auth-service curl -s -o /dev/null -w '%{http_code}' --max-time 3 https://example.com || true)"
git check-ignore -q .env && ok ".env ignorado por git" || mal ".env NO está en .gitignore"

caso "CP-15 Replicación maestro → réplica"
esperar "el cliente registrado ya está en la réplica" 1 "$(docker compose exec -T mariadb-slave mariadb -N -uroot -p"$DB_ROOT_PASSWORD" -e "SELECT COUNT(*) FROM auth_db.usuarios WHERE email='$CLIENTE'")"
esperar "la réplica es de solo lectura" 1 "$(docker compose exec -T mariadb-slave mariadb -N -uroot -p"$DB_ROOT_PASSWORD" -e 'SELECT @@read_only')"

caso "CP-16 Rate limiting en /login (gateway)"
codigos=$(for i in $(seq 1 15); do codigo -X POST -H 'Content-Type: application/json' -d '{"email":"flood@correo.gt","password":"x"}' "$BASE/api/auth/login"; echo; done)
grep -q 429 <<<"$codigos" && ok "ráfaga de logins → 429" || mal "ninguna respuesta 429 en la ráfaga"

echo
echo "Resultado: $pasaron pasaron, $fallaron fallaron"
[[ $fallaron -eq 0 ]]
