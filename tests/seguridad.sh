#!/usr/bin/env bash
# Pruebas de seguridad end-to-end contra el stack levantado con `docker compose up -d`.
#   tests/seguridad.sh            # usa https://localhost:8443
#   BASE=https://otra-url tests/seguridad.sh
# Requiere Linux: bash 4+, date y base64 de GNU, tzdata, curl con TLS 1.3, jq, git y docker compose (para
# los casos que miran BD/contenedores). En macOS: tests/seguridad-en-contenedor.sh
set -uo pipefail
cd "$(dirname "$0")/.."
source .env

# Fuera de Linux los fallos serían falsos (en macOS, 79 de 342): mejor no correr.
if (( BASH_VERSINFO[0] < 4 )) || [[ ! -r /proc/sys/kernel/random/uuid ]] || ! date -d now >/dev/null 2>&1 \
    || ! base64 -w0 </dev/null >/dev/null 2>&1 || [[ "$(TZ=America/Guatemala date +%z)" != -0600 ]]; then
    echo "Esta suite necesita Linux con bash 4+, herramientas GNU y tzdata. Usa tests/seguridad-en-contenedor.sh" >&2
    exit 2
fi

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
# El gateway limita /login (20/min, ráfaga de 10). La suite hace ~12 logins seguidos: ante un 429 se
# reintenta tras 3 s (lo que tarda en reponerse un turno), como haría un cliente real.
intento_login() { # intento_login <email> <password> → "cuerpo<LF>código", reintentando en 429
    local r i
    for i in 1 2 3 4 5 6 7 8 9 10; do
        r=$("${C[@]}" -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" "$BASE/api/auth/login")
        [[ "${r##*$'\n'}" != 429 ]] && break
        sleep 3
    done
    printf '%s' "$r"
}
mfa_intento() { # mfa_intento <desafio> <codigo> → "cuerpo<LF>código", reintentando en 429 (comparte cupo con /login)
    local r i
    for i in 1 2 3 4 5 6 7 8 9 10; do
        r=$("${C[@]}" -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"desafio\":\"$1\",\"codigo\":\"$2\"}" "$BASE/api/auth/login/mfa")
        [[ "${r##*$'\n'}" != 429 ]] && break
        sleep 3
    done
    printf '%s' "$r"
}
mfa_codigo() { local r; r=$(mfa_intento "$1" "$2"); echo "${r##*$'\n'}"; }
login()        { local r; r=$(intento_login "$1" "$2"); jq -r '.token // empty' <<<"${r%$'\n'*}" 2>/dev/null; }
login_codigo() { local r; r=$(intento_login "$1" "$2"); echo "${r##*$'\n'}"; }
login_error()  { local r; r=$(intento_login "$1" "$2"); jq -r '.error // empty' <<<"${r%$'\n'*}" 2>/dev/null; }

# Si una corrida anterior agotó el cupo de /login del gateway (ráfaga del CP-16), se espera a que se
# recupere: la sonda consume menos de lo que se repone (1 cada 5 s frente a 1 cada 3 s), y después
# se esperan 30 s más para recuperar margen para los ~12 logins de la suite.
espera_login() { "${C[@]}" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/auth/login"; }
if [[ "$(espera_login)" == 429 ]]; then
    echo "(esperando a que se recupere el cupo de /login de la corrida anterior…)"
    until [[ "$(espera_login)" != 429 ]]; do sleep 5; done
    t0=$(date +%s); until (( $(date +%s) - t0 >= 30 )); do sleep 5; done
fi

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
esperar "contraseña incorrecta → 401 genérico" "Credenciales inválidas" "$(login_error "$CLIENTE" Mala1234)"
esperar "correo inexistente → mismo mensaje (sin enumeración)" "Credenciales inválidas" "$(login_error noexiste@correo.gt Mala1234)"

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
for i in 1 2 3 4; do login_codigo "$CLIENTE" Mala1234 >/dev/null; done
esperar "5.º intento fallido → 423" 423 "$(login_codigo "$CLIENTE" Mala1234)"
esperar "contraseña correcta durante el bloqueo → 423" 423 "$(login_codigo "$CLIENTE" Segura123)"

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

# ======================= Semana 2: catálogo y pedidos =======================
auth_json() { local metodo=$1 token=$2 url=$3 datos=${4:-}; "${C[@]}" -X "$metodo" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' ${datos:+-d "$datos"} "$BASE$url"; }
evento_ultimo() { "${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/auditoria/eventos?accion=$1&limite=1" | jq -c '.eventos[0]'; }
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

caso "CP-17 Catálogo público con caché (D de STRIDE)"
cat_json=$("${C[@]}" "$BASE/api/catalogo/productos")
n=$(jq '.productos | length' <<<"$cat_json")
[[ $n -ge 20 ]] && ok "catálogo sin login con $n productos (≥20)" || mal "catálogo con $n productos"
esperar "el catálogo público no expone el stock exacto" false "$(jq '[.productos[].variantes[] | has("stock")] | any' <<<"$cat_json")"
esperar "segunda lectura servida desde Redis" HIT "$("${C[@]}" -o /dev/null -D - "$BASE/api/catalogo/productos" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-cache"{print $2}')"

CLIENTE2="compras$SUF@correo.gt"
post /api/auth/registro "{\"nombre\":\"Compradora $SUF\",\"email\":\"$CLIENTE2\",\"password\":\"Segura123\"}" >/dev/null
T2=$(login "$CLIENTE2" Segura123)
T1=$(login cliente@huellitas.gt 'Cliente#2026')
ENTREGA='"nombre":"Compradora Prueba","telefono":"+502 5512-3478","metodo_entrega":"domicilio","direccion":"4a avenida 10-20, zona 1","ciudad":"Guatemala"'

caso "CP-18 El precio lo pone el servidor (T de STRIDE)"
precio_real=$(jq '.productos[] | select(.slug=="alimento-seco-pollo-arroz") | .variantes[0].precio' <<<"$cat_json")
var_id=$(jq '.productos[] | select(.slug=="alimento-seco-pollo-arroz") | .variantes[0].id' <<<"$cat_json")
# Cada corrida compra unidades de esta variante: se repone el stock para que la suite se pueda repetir
# indefinidamente (el ajuste queda en la bitácora como cualquier cambio del admin).
auth_json PATCH "$ADMIN" "/api/catalogo/admin/variantes/$var_id" '{"stock":500}' >/dev/null
cot=$(post /api/pedidos/cotizar "{\"items\":[{\"variante_id\":$var_id,\"cantidad\":3,\"precio\":0.01}],\"metodo_entrega\":\"retiro\"}")
esperar "cotizar ignora el precio del navegador" "$(jq -n "$precio_real*3*100|round/100")" "$(jq '.totales.total' <<<"$cot")"
p=$(auth_json POST "$T2" /api/pedidos "{\"items\":[{\"variante_id\":$var_id,\"cantidad\":2,\"precio\":0.01,\"subtotal\":0.02}],\"total\":0.02,$ENTREGA}")
PED2=$(jq -r '.pedido.id' <<<"$p")
esperar "pedido creado con el precio del catálogo" "$(jq -n "$precio_real*2")" "$(jq '.pedido.items[0].precio_unitario*2' <<<"$p")"
esperar "el total no es el que mandó el cliente" true "$(jq '.pedido.total > 1' <<<"$p")"
esperar "cupón inventado → 422" 422 "$(codigo -X POST -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d "{\"items\":[{\"variante_id\":$var_id,\"cantidad\":1}],\"cupon\":\"GRATIS100\",$ENTREGA}" "$BASE/api/pedidos")"
esperar "comprar sin sesión → 401" 401 "$(codigo -X POST -H 'Content-Type: application/json' -d "{\"items\":[{\"variante_id\":$var_id,\"cantidad\":1}],$ENTREGA}" "$BASE/api/pedidos")"
esperar "evento PEDIDO_CREADO con el pedido y el cliente" "$PED2|$CLIENTE2" "$(evento_ultimo PEDIDO_CREADO | jq -r '"\(.pedido_id)|\(.usuario_email)"')"

caso "CP-19 IDs de pedido no adivinables (I de STRIDE)"
[[ "$PED2" =~ $UUID_RE ]] && ok "el pedido usa UUID v4 ($PED2)" || mal "el id del pedido no es UUID v4: $PED2"
esperar "un id secuencial no existe" 404 "$(codigo -H "Authorization: Bearer $T2" "$BASE/api/pedidos/1")"

caso "CP-20 Un cliente no ve pedidos de otro (A01)"
esperar "la dueña ve su pedido" 200 "$(codigo -H "Authorization: Bearer $T2" "$BASE/api/pedidos/$PED2")"
esperar "otro cliente recibe 404 (no se confirma que existe)" 404 "$(codigo -H "Authorization: Bearer $T1" "$BASE/api/pedidos/$PED2")"
esperar "el intento queda como ACCESO_DENEGADO" "$PED2|cliente@huellitas.gt|FALLO" "$(evento_ultimo ACCESO_DENEGADO | jq -r '"\(.pedido_id)|\(.usuario_email)|\(.resultado)"')"
ids_ajenos=$(auth_json GET "$T1" /api/pedidos | jq --arg p "$PED2" '[.pedidos[] | select(.id == $p)] | length')
esperar "GET /api/pedidos del otro cliente no lo incluye" 0 "$ids_ajenos"
dueno=$(auth_json GET "$T2" /api/pedidos | jq '[.pedidos[].id_cliente] | unique | length')
esperar "GET /api/pedidos solo devuelve pedidos de un cliente" 1 "$dueno"
esperar "cliente no puede cambiar estados → 403" 403 "$(codigo -X PATCH -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d '{"estado":"entregado"}' "$BASE/api/pedidos/admin/$PED2/estado")"
esperar "cliente no ve todos los pedidos → 403" 403 "$(codigo -H "Authorization: Bearer $T2" "$BASE/api/pedidos/admin/todos")"

caso "CP-21 Cambio de precio auditado (PRECIO_MODIFICADO)"
esperar "cliente no puede cambiar precios → 403" 403 "$(codigo -X PATCH -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d '{"precio":1}' "$BASE/api/catalogo/admin/variantes/$var_id")"
nuevo=$(jq -n "$precio_real+1")
r=$(auth_json PATCH "$ADMIN" "/api/catalogo/admin/variantes/$var_id" "{\"precio\":$nuevo}")
esperar "admin cambia el precio" "$nuevo" "$(jq --argjson v "$var_id" '.producto.variantes[] | select(.id==$v) | .precio' <<<"$r")"
esperar "PRECIO_MODIFICADO guarda antes y después" "${precio_real}→${nuevo}" "$(evento_ultimo PRECIO_MODIFICADO | jq -r '"\(.dato_anterior.precio)→\(.dato_nuevo.precio)"')"
esperar "el catálogo público refleja el precio nuevo (caché invalidada)" "$nuevo" "$("${C[@]}" "$BASE/api/catalogo/productos" | jq --argjson v "$var_id" '.productos[].variantes[] | select(.id==$v) | .precio')"
auth_json PATCH "$ADMIN" "/api/catalogo/admin/variantes/$var_id" "{\"precio\":$precio_real}" >/dev/null
esperar "precio negativo → 422" 422 "$(codigo -X PATCH -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"precio":-5}' "$BASE/api/catalogo/admin/variantes/$var_id")"

caso "CP-22 Stock: agotado, sobreventa y cancelación"
uvb=$(jq '.productos[] | select(.slug=="lampara-uvb-terrario") | .variantes[0].id' <<<"$cat_json")
auth_json PATCH "$ADMIN" "/api/catalogo/admin/variantes/$uvb" '{"stock":2}' >/dev/null
p=$(auth_json POST "$T2" /api/pedidos "{\"items\":[{\"variante_id\":$uvb,\"cantidad\":2}],$ENTREGA}")
PED_UVB=$(jq -r '.pedido.id' <<<"$p")
[[ "$PED_UVB" =~ $UUID_RE ]] && ok "se compran las 2 últimas unidades" || mal "no se pudo comprar: $(jq -c . <<<"$p")"
esperar "PRODUCTO_AGOTADO al llegar a 0 por una venta" "$PED_UVB|venta" "$(evento_ultimo PRODUCTO_AGOTADO | jq -r '"\(.pedido_id)|\(.dato_nuevo.origen)"')"
esperar "el catálogo lo muestra agotado" false "$("${C[@]}" "$BASE/api/catalogo/productos" | jq --argjson v "$uvb" '.productos[].variantes[] | select(.id==$v) | .disponible')"
esperar "no se puede sobrevender → 409" 409 "$(codigo -X POST -H "Authorization: Bearer $T1" -H 'Content-Type: application/json' -d "{\"items\":[{\"variante_id\":$uvb,\"cantidad\":1}],$ENTREGA}" "$BASE/api/pedidos")"
esperar "transición inválida (pendiente_pago → entregado) → 409" 409 "$(codigo -X PATCH -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"estado":"entregado"}' "$BASE/api/pedidos/admin/$PED_UVB/estado")"
esperar "admin cancela el pedido" cancelado "$(auth_json PATCH "$ADMIN" "/api/pedidos/admin/$PED_UVB/estado" '{"estado":"cancelado","comentario":"Prueba automática"}' | jq -r .pedido.estado)"
esperar "PEDIDO_ESTADO_CAMBIADO con antes y después" "pendiente_pago→cancelado" "$(evento_ultimo PEDIDO_ESTADO_CAMBIADO | jq -r '"\(.dato_anterior.estado)→\(.dato_nuevo.estado)"')"
esperar "al cancelar vuelve el stock" true "$("${C[@]}" "$BASE/api/catalogo/productos" | jq --argjson v "$uvb" '.productos[].variantes[] | select(.id==$v) | .disponible')"

caso "CP-23 Zero Trust en las rutas internas del catálogo"
esperar "/internal/catalogo/* no se publica" 404 "$(codigo -X POST "$BASE/internal/catalogo/reservar")"
r=$(docker compose exec -T auth-service php -r '
    const SERVICE_DIR = "/var/www/app"; require "/var/www/shared/bootstrap.php";
    [$c] = Huellitas\Interno::post("http://catalogo-service:8082/internal/catalogo/reservar",
        ["pedido_id" => Huellitas\Jwt::uuid(), "items" => [["variante_id" => 1, "cantidad" => 50]]]);
    echo $c;')
esperar "auth-service no puede reservar stock → 403" 403 "$r"

caso "CP-24 Inyección en el checkout (A03)"
esperar "SQLi en la dirección → 400" 400 "$(codigo -X POST -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d "{\"items\":[{\"variante_id\":$var_id,\"cantidad\":1}],\"nombre\":\"Ana\",\"telefono\":\"+502 5512-3478\",\"metodo_entrega\":\"domicilio\",\"direccion\":\"x'; DROP TABLE pedidos; --\",\"ciudad\":\"Guatemala\"}" "$BASE/api/pedidos")"
esperar "XSS en las notas → 400" 400 "$(codigo -X POST -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d "{\"items\":[{\"variante_id\":$var_id,\"cantidad\":1}],$ENTREGA,\"notas\":\"<img src=x onerror=alert(1)>\"}" "$BASE/api/pedidos")"
esperar "cantidad inválida → 422" 422 "$(codigo -X POST -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d "{\"items\":[{\"variante_id\":$var_id,\"cantidad\":-3}],$ENTREGA}" "$BASE/api/pedidos")"
[[ "$(codigo -X POST -H 'Content-Type: application/json' -d '{"items":[{"variante_id":"1 OR 1=1","cantidad":1}]}' "$BASE/api/pedidos/cotizar")" =~ ^(400|422)$ ]] \
    && ok "variante con SQL rechazada (WAF 400 o validación 422)" || mal "variante con SQL no fue rechazada"

caso "CP-25 Cada servicio solo accede a su base (A.8.3)"
salida=$(docker compose exec -T mariadb-master mariadb -N -upedidos_user -p"$PEDIDOS_DB_PASSWORD" -e "SELECT COUNT(*) FROM auth_db.usuarios" 2>&1)
grep -q "denied" <<<"$salida" && ok "pedidos_user no puede leer auth_db" || mal "pedidos_user leyó auth_db"
salida=$(docker compose exec -T mariadb-master mariadb -N -ucatalogo_user -p"$CATALOGO_DB_PASSWORD" -e "SELECT COUNT(*) FROM pedidos_db.pedidos" 2>&1)
grep -q "denied" <<<"$salida" && ok "catalogo_user no puede leer pedidos_db" || mal "catalogo_user leyó pedidos_db"
esperar "el pedido ya está replicado en la réplica" 1 "$(docker compose exec -T mariadb-slave mariadb -N -uroot -p"$DB_ROOT_PASSWORD" -e "SELECT COUNT(*) FROM pedidos_db.pedidos WHERE id='$PED2'")"

# ======================= Semana 3: pagos y notificaciones =======================
# Sin claves de Stripe en local, el pago se simula insertando la fila que habría creado
# /internal/pagos/iniciar y firmando el webhook con STRIPE_WEBHOOK_SECRET, como hace Stripe.
nuevo_pedido() { auth_json POST "$T2" /api/pedidos "{\"items\":[{\"variante_id\":$var_id,\"cantidad\":1}],$ENTREGA}" | jq -r '.pedido | "\(.id) \(.total)"'; }
fixture_pago() { # fixture_pago <pedido> <total> <pi>
    docker compose exec -T mariadb-master mariadb -uroot -p"$DB_ROOT_PASSWORD" pagos_db -e \
      "INSERT INTO pagos (id,id_pedido,id_cliente,monto,metodo,payment_intent_id,stripe_status) SELECT UUID(),'$1',id_cliente,total,'stripe','$3','requires_payment_method' FROM pedidos_db.pedidos WHERE id='$1'"
}
evento_stripe() { # evento_stripe <tipo> <pi> <centavos> <pedido> [moneda]
    jq -cn --arg t "$1" --arg pi "$2" --argjson c "$3" --arg p "$4" --arg m "${5:-gtq}" --arg e "evt_$RANDOM$RANDOM" \
      '{id:$e,type:$t,data:{object:{id:$pi,amount_received:$c,currency:$m,status:"succeeded",metadata:{pedido_id:$p},last_payment_error:{code:"card_declined"}}}}'
}
firmar() { printf '%s' "$1.$2" | openssl dgst -sha256 -hmac "$STRIPE_WEBHOOK_SECRET" | awk '{print $2}'; }
webhook() { "${C[@]}" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' ${2:+-H "Stripe-Signature: $2"} -d "$1" "$BASE/api/pagos/webhook/stripe"; }
estado_pedido() { auth_json GET "$T2" "/api/pedidos/$1" | jq -r .pedido.estado; }

caso "CP-26 Webhook de Stripe: firma obligatoria (A08 / PCI-DSS)"
read -r PAGO_ID PAGO_TOTAL <<<"$(nuevo_pedido)"
PI="pi_prueba_$SUF$RANDOM"; fixture_pago "$PAGO_ID" "$PAGO_TOTAL" "$PI"
CENT=$(jq -n "$PAGO_TOTAL*100|round")
EV=$(evento_stripe payment_intent.succeeded "$PI" "$CENT" "$PAGO_ID"); TS=$(date +%s)
esperar "sin Stripe-Signature → 400" 400 "$(webhook "$EV")"
esperar "se registra WEBHOOK_STRIPE_RECIBIDO FALLO (firma ausente)" "FALLO|ausente" "$(evento_ultimo WEBHOOK_STRIPE_RECIBIDO | jq -r '"\(.resultado)|\(.dato_nuevo.firma)"')"
esperar "firma falsa → 400" 400 "$(webhook "$EV" "t=$TS,v1=$(printf 'x%.0s' {1..64})")"
esperar "firma falsa queda como FRAUDE" FRAUDE "$(evento_ultimo WEBHOOK_STRIPE_RECIBIDO | jq -r .resultado)"
VIEJO=$((TS - 600))
esperar "firma válida pero de hace 10 min (replay) → 400" 400 "$(webhook "$EV" "t=$VIEJO,v1=$(firmar "$VIEJO" "$EV")")"
esperar "cuerpo alterado después de firmar → 400" 400 "$(webhook "${EV/succeeded/canceled}" "t=$TS,v1=$(firmar "$TS" "$EV")")"
esperar "el pedido sigue pendiente de pago" pendiente_pago "$(estado_pedido "$PAGO_ID")"
esperar "firma válida → 200" 200 "$(webhook "$EV" "t=$TS,v1=$(firmar "$TS" "$EV")")"
esperar "el pedido pasa a pagado" pagado "$(estado_pedido "$PAGO_ID")"
esperar "PAGO_CONFIRMADO con la referencia del PaymentIntent" "$PAGO_ID|$PI" "$(evento_ultimo PAGO_CONFIRMADO | jq -r '"\(.pedido_id)|\(.dato_nuevo.referencia)"')"
esperar "PEDIDO_ESTADO_CAMBIADO por pagos-service" "pagado|pagos-service" "$(evento_ultimo PEDIDO_ESTADO_CAMBIADO | jq -r '"\(.dato_nuevo.estado)|\(.dato_nuevo.origen)"')"
esperar "EMAIL_ENVIADO registrado para el pedido" "$PAGO_ID" "$(evento_ultimo EMAIL_ENVIADO | jq -r .pedido_id)"
esperar "el mismo evento otra vez no se reprocesa" true "$("${C[@]}" -X POST -H "Stripe-Signature: t=$TS,v1=$(firmar "$TS" "$EV")" -d "$EV" "$BASE/api/pagos/webhook/stripe" | jq .duplicado)"
esperar "un pedido pagado no se puede volver a pagar → 409" 409 "$(codigo -X POST -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d '{"metodo":"stripe"}' "$BASE/api/pedidos/$PAGO_ID/pago")"

caso "CP-27 Webhook con monto manipulado"
read -r PED_F TOT_F <<<"$(nuevo_pedido)"
PI_F="pi_fraude_$SUF$RANDOM"; fixture_pago "$PED_F" "$TOT_F" "$PI_F"
EV=$(evento_stripe payment_intent.succeeded "$PI_F" "$(jq -n "$TOT_F*100|round")" "$PED_F" usd); TS=$(date +%s)
webhook "$EV" "t=$TS,v1=$(firmar "$TS" "$EV")" >/dev/null
esperar "el monto correcto pero en dólares no confirma el pedido" pendiente_pago "$(estado_pedido "$PED_F")"
EV=$(evento_stripe payment_intent.succeeded "$PI_F" 1 "$PED_F"); TS=$(date +%s)
webhook "$EV" "t=$TS,v1=$(firmar "$TS" "$EV")" >/dev/null
esperar "cobro de 1 centavo no confirma el pedido" pendiente_pago "$(estado_pedido "$PED_F")"
esperar "queda PAGO_FALLIDO como FRAUDE" "$PED_F|FRAUDE" "$(evento_ultimo PAGO_FALLIDO | jq -r '"\(.pedido_id)|\(.resultado)"')"
EV=$(evento_stripe payment_intent.payment_failed "$PI_F" 0 "$PED_F"); TS=$(date +%s)
webhook "$EV" "t=$TS,v1=$(firmar "$TS" "$EV")" >/dev/null
esperar "tarjeta rechazada → PAGO_FALLIDO con el código" "FALLO|card_declined" "$(evento_ultimo PAGO_FALLIDO | jq -r '"\(.resultado)|\(.dato_nuevo.motivo)"')"

caso "CP-28 Sin datos de tarjeta en la base (PCI-DSS, SEC-3)"
cols=$(docker compose exec -T mariadb-master mariadb -N -uroot -p"$DB_ROOT_PASSWORD" -e "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA IN ('auth_db','catalogo_db','pedidos_db','pagos_db','citas_db') AND COLUMN_NAME REGEXP 'card|tarjeta|cvv|cvc|pan$|expir|vencimiento|track' AND COLUMN_NAME <> 'frecuencia_cardiaca'")
esperar "ninguna columna de tarjeta en las 4 bases" 0 "$cols"
esperar "pagos guarda la referencia de la pasarela, no la tarjeta" "$PI" "$(docker compose exec -T mariadb-master mariadb -N -uroot -p"$DB_ROOT_PASSWORD" -e "SELECT payment_intent_id FROM pagos_db.pagos WHERE id_pedido='$PAGO_ID'")"
esperar "pagos_user no puede borrar pagos" 0 "$(docker compose exec -T mariadb-master mariadb -N -uroot -p"$DB_ROOT_PASSWORD" -e "SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE LIKE '%pagos_user%' AND PRIVILEGE_TYPE='DELETE'")"

caso "CP-29 Rutas de pago solo internas (PCI-DSS)"
esperar "/internal/pagos/iniciar no se publica" 404 "$(codigo -X POST "$BASE/internal/pagos/iniciar")"
esperar "/api/pagos/* (fuera del webhook) no se publica" 404 "$(codigo -X POST "$BASE/api/pagos/iniciar")"
r=$(codigo -X POST -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d '{"metodo":"stripe"}' "$BASE/api/pedidos/$PED_F/pago")
# Con claves de Stripe responde 200 (client_secret); sin ellas, 503. En ambos casos el intento queda registrado.
[[ $r =~ ^(200|503)$ ]] && ok "iniciar el pago de un pedido propio → $r ($( [[ $r == 200 ]] && echo 'Stripe configurado' || echo 'Stripe sin claves'))" || mal "iniciar pago respondió $r"
esperar "el intento queda como PAGO_INICIADO con el pedido" "$PED_F" "$(evento_ultimo PAGO_INICIADO | jq -r .pedido_id)"
esperar "pagar un pedido ajeno → 404" 404 "$(codigo -X POST -H "Authorization: Bearer $T1" -H 'Content-Type: application/json' -d '{"metodo":"stripe"}' "$BASE/api/pedidos/$PED_F/pago")"
r=$(docker compose exec -T catalogo-service php -r '
    const SERVICE_DIR = "/var/www/app"; require "/var/www/shared/bootstrap.php";
    [$c] = Huellitas\Interno::post("http://pagos-service:8084/internal/pagos/iniciar", ["pedido_id" => Huellitas\Jwt::uuid()]);
    echo $c;')
esperar "catalogo-service no puede iniciar pagos → 403" 403 "$r"
r=$(docker compose exec -T catalogo-service php -r '
    const SERVICE_DIR = "/var/www/app"; require "/var/www/shared/bootstrap.php";
    [$c] = Huellitas\Interno::post("http://pedidos-service:8083/internal/pedidos/pagado", ["pedido_id" => Huellitas\Jwt::uuid()]);
    echo $c;')
esperar "solo pagos-service puede marcar un pedido como pagado → 403" 403 "$r"

caso "CP-48 Tipo de cambio de PayPal y tarjeta oculta (integridad del cobro)"
PHP_PAGOS='const SERVICE_DIR = "/var/www/app"; require "/var/www/shared/bootstrap.php";'
tc=$(docker compose exec -T pagos-service php -r "$PHP_PAGOS echo json_encode(App\TipoCambio::actual());")
# Sin Internet (o con Banguat caído) se usa PAYPAL_TIPO_CAMBIO: los dos casos son válidos.
[[ $(jq -r .fuente <<<"$tc") =~ ^(banguat|fijo)$ ]] && jq -e '.tasa >= 5 and .tasa <= 12' <<<"$tc" >/dev/null \
  && ok "tipo de cambio en rango: Q$(jq -r .tasa <<<"$tc") ($(jq -r .fuente <<<"$tc"))" || mal "tipo de cambio inválido: $tc"
esperar "con PAYPAL_TIPO_CAMBIO_AUTO=0 se usa el del .env" "fijo|${PAYPAL_TIPO_CAMBIO:-7.75}" "$(docker compose exec -T -e PAYPAL_TIPO_CAMBIO_AUTO=0 pagos-service php -r "$PHP_PAGOS \$c = App\TipoCambio::actual(); echo \$c['fuente'], '|', \$c['tasa'];")"
esperar "STRIPE_OCULTAR_TARJETA=1 quita la tarjeta sin desconfigurar Stripe" "configurado|no ofrecido" "$(docker compose exec -T -e STRIPE_SECRET_KEY=sk_x -e STRIPE_PUBLISHABLE_KEY=pk_x -e STRIPE_OCULTAR_TARJETA=1 pagos-service php -r "$PHP_PAGOS echo App\Stripe::configurado() ? 'configurado' : 'no', '|', App\Stripe::ofrecido() ? 'ofrecido' : 'no ofrecido';")"

caso "CP-30 Secretos fuera del repositorio (A05, penalización -4)"
fugas=$(git grep -nE 'sk_(test|live)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|EMAILJS_PRIVATE_KEY=[^ ]+|PAYPAL_CLIENT_SECRET=[^ ]+|CLOUDINARY_API_SECRET=[^ ]+' -- . ':!tests' | wc -l)
esperar "ninguna API key en archivos versionados" 0 "$fugas"
esperar "solo pagos y notificaciones tienen salida a Internet" "000" "$(docker compose exec -T catalogo-service curl -s -o /dev/null -w '%{http_code}' --max-time 3 https://api.stripe.com || true)"

# ======================= Semana 4: panel de administración y evidencia =======================
caso "CP-31 Exportación de clientes auditada (A09, A.5.34)"
esperar "cliente no puede exportar → 403" 403 "$(codigo -H "Authorization: Bearer $T2" "$BASE/api/auth/admin/clientes/exportar")"
exp=$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/auth/admin/clientes/exportar")
esperar "solo con columnas mínimas" "activo,creado,email,id,nombre" "$(jq -r '.clientes[0] | keys | join(",")' <<<"$exp")"
grep -q 'password\|\$2y\$' <<<"$exp" && mal "la exportación contiene hashes" || ok "la exportación no contiene contraseñas ni hashes"
esperar "EXPORTACION_CLIENTES registra cuántos registros salieron" "admin@huellitas.gt|$(jq '.clientes | length' <<<"$exp")|pdf" "$(evento_ultimo EXPORTACION_CLIENTES | jq -r '"\(.usuario_email)|\(.dato_nuevo.registros)|\(.dato_nuevo.formato)"')"
esperar "intento de un cliente de entrar al panel → ACCESO_ADMIN_PANEL FALLO" "FALLO" "$(codigo -X POST -H "Authorization: Bearer $T2" "$BASE/api/auth/admin/acceso" >/dev/null; evento_ultimo ACCESO_ADMIN_PANEL | jq -r .resultado)"

caso "CP-32 Evidencia SEC-2: ≥30 registros y ≥8 tipos de evento"
res=$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/auditoria/resumen")
[[ $(jq .total <<<"$res") -ge 30 ]] && ok "$(jq .total <<<"$res") registros en security_audit_logs" || mal "menos de 30 registros"
[[ $(jq .tipos_de_evento <<<"$res") -ge 8 ]] && ok "$(jq .tipos_de_evento <<<"$res") tipos de evento" || mal "menos de 8 tipos"
faltan=$(jq -r '[.por_evento[].accion] | unique as $hay | ["LOGIN_CLIENTE_EXITOSO","LOGIN_CLIENTE_FALLIDO","REGISTRO_CLIENTE","PEDIDO_CREADO","PAGO_INICIADO","PAGO_CONFIRMADO","PAGO_FALLIDO","PEDIDO_ESTADO_CAMBIADO","PRECIO_MODIFICADO","PRODUCTO_AGOTADO","EXPORTACION_CLIENTES","ACCESO_ADMIN_PANEL","WEBHOOK_STRIPE_RECIBIDO","TOKEN_REVOCADO"] - $hay | join(",")' <<<"$res")
esperar "los 14 eventos obligatorios aparecen en la bitácora" "" "$faltan"

caso "CP-33 Pedidos sin pagar vencen y devuelven el stock"
stock_admin() { auth_json GET "$ADMIN" /api/catalogo/admin/productos | jq --argjson v "$var_id" '.productos[].variantes[] | select(.id==$v) | .stock'; }
antes_stock=$(stock_admin)
read -r PED_V _ <<<"$(auth_json POST "$T2" /api/pedidos "{\"items\":[{\"variante_id\":$var_id,\"cantidad\":3}],$ENTREGA}" | jq -r '.pedido | "\(.id) \(.total)"')"
esperar "al crear el pedido se apartan 3 unidades" "$((antes_stock - 3))" "$(stock_admin)"
docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb-master mariadb -uroot -e \
    "UPDATE pedidos_db.pedidos SET fecha = NOW() - INTERVAL 25 HOUR WHERE id = '$PED_V'"
salida=$(docker compose exec -T pedidos-vencimientos php /var/www/app/bin/vencer.php)
esperar "el pedido de hace 25 h se vence" true "$(jq --arg p "$PED_V" '.vencidos | index($p) != null' <<<"$salida")"
esperar "queda cancelado con el motivo en el historial" "cancelado|Vencido: ${PEDIDO_VENCE_HORAS:-2} h sin pago" "$(auth_json GET "$T2" "/api/pedidos/$PED_V" | jq -r '.pedido | "\(.estado)|\(.historial[-1].comentario)"')"
esperar "el stock apartado vuelve al catálogo" "$antes_stock" "$(stock_admin)"
esperar "PEDIDO_ESTADO_CAMBIADO con origen vencimiento automático" "$PED_V|vencimiento automático" "$(evento_ultimo PEDIDO_ESTADO_CAMBIADO | jq -r '"\(.pedido_id)|\(.dato_nuevo.origen)"')"
esperar "un pedido reciente no se toca" "[]" "$(docker compose exec -T pedidos-vencimientos php /var/www/app/bin/vencer.php | jq -c .vencidos)"
# bin/ está fuera del DocumentRoot (public/): ni siquiera desde la red interna se puede ejecutar por HTTP.
esperar "el script no se puede llamar por HTTP (ni desde la red interna)" 404 "$(docker compose exec -T auth-service curl -s -o /dev/null -w '%{http_code}' http://pedidos-service:8083/bin/vencer.php)"

caso "CP-34 Verificación en dos pasos (TOTP, A07)"
totp() { # totp <secreto base32> [desfase de pasos]
    docker compose exec -T auth-service php -r 'const SERVICE_DIR = "/var/www/app"; require "/var/www/shared/bootstrap.php";
        $b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; $bits = "";
        foreach (str_split($argv[1]) as $c) $bits .= str_pad(decbin(strpos($b32, $c)), 5, "0", STR_PAD_LEFT);
        $k = ""; foreach (str_split($bits, 8) as $o) if (strlen($o) === 8) $k .= chr(bindec($o));
        echo App\Totp::codigo($k, intdiv(time(), 30) + (int) ($argv[2] ?? 0));' "$1" "${2:-0}"
}
CLIENTE3="mfa$SUF@correo.gt"
post /api/auth/registro "{\"nombre\":\"Usuario MFA\",\"email\":\"$CLIENTE3\",\"password\":\"Segura123\"}" >/dev/null
T3=$(login "$CLIENTE3" Segura123)
conf=$(auth_json POST "$T3" /api/auth/mfa/configurar)
SECRETO=$(jq -r .secreto <<<"$conf")
[[ "$SECRETO" =~ ^[A-Z2-7]{32}$ ]] && ok "secreto TOTP de 160 bits en base32" || mal "secreto inválido: $SECRETO"
[[ "$(jq -r .uri <<<"$conf")" == otpauth://totp/Huellitas* ]] && ok "URI otpauth:// para el QR" || mal "URI inválida"
guardado=$(docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb-master mariadb -N -uroot -e "SELECT HEX(mfa_secreto) FROM auth_db.usuarios WHERE email='$CLIENTE3'")
[[ -n "$guardado" && "$guardado" != *"$(printf '%s' "$SECRETO" | xxd -p | tr -d '\n' | tr a-f A-F)"* ]] && ok "el secreto se guarda cifrado (AES-256-GCM), no en claro" || mal "el secreto está en claro en la BD"
esperar "activar con un código incorrecto → 422" 422 "$(codigo -X POST -H "Authorization: Bearer $T3" -H 'Content-Type: application/json' -d '{"codigo":"000000"}' "$BASE/api/auth/mfa/activar")"
esperar "activar con el código de la app → MFA activo" true "$(auth_json POST "$T3" /api/auth/mfa/activar "{\"codigo\":\"$(totp "$SECRETO")\"}" | jq .mfa)"
esperar "MFA_CONFIGURADO en la bitácora" "$CLIENTE3|activado" "$(evento_ultimo MFA_CONFIGURADO | jq -r '"\(.usuario_email)|\(.dato_nuevo.mfa)"')"
r=$(intento_login "$CLIENTE3" Segura123); paso1=${r%$'\n'*}
esperar "con MFA, la contraseña sola no entrega token" "true|" "$(jq -r '"\(.mfa_requerido)|\(.token // "")"' <<<"$paso1")"
DESAFIO=$(jq -r .desafio <<<"$paso1")
esperar "el desafío no sirve como token de acceso" 401 "$(codigo -H "Authorization: Bearer $DESAFIO" "$BASE/api/auth/me")"
esperar "código incorrecto → 401" 401 "$(mfa_codigo "$DESAFIO" 123456)"
esperar "el código fallido se registra como LOGIN_CLIENTE_FALLIDO" "código MFA incorrecto (1/5)" "$(evento_ultimo LOGIN_CLIENTE_FALLIDO | jq -r .dato_nuevo.motivo)"
# El código del paso de la activación ya se usó: se espera al siguiente paso de 30 s para no reutilizarlo.
until (( $(date +%s) % 30 < 25 )); do sleep 1; done
CODIGO=$(totp "$SECRETO" 1)
r=$(mfa_intento "$DESAFIO" "$CODIGO"); r=${r%$'\n'*}
T3=$(jq -r '.token // empty' <<<"$r" 2>/dev/null)
[[ -n "$T3" ]] && ok "código correcto → JWT" || mal "no entregó token: $r"
esperar "LOGIN_CLIENTE_EXITOSO marca mfa=true" "$CLIENTE3|true" "$(evento_ultimo LOGIN_CLIENTE_EXITOSO | jq -r '"\(.usuario_email)|\(.dato_nuevo.mfa)"')"
esperar "el mismo desafío no se puede reutilizar" 401 "$(mfa_codigo "$DESAFIO" "$CODIGO")"
r=$(intento_login "$CLIENTE3" Segura123); D2=$(jq -r .desafio <<<"${r%$'\n'*}")
esperar "el mismo código con otro desafío tampoco (anti-replay)" 401 "$(mfa_codigo "$D2" "$CODIGO")"
esperar "desactivar sin el código correcto → 401" 401 "$(codigo -X POST -H "Authorization: Bearer $T3" -H 'Content-Type: application/json' -d '{"password":"Segura123","codigo":"000000"}' "$BASE/api/auth/mfa/desactivar")"

caso "CP-35 La IP del cliente no se puede falsificar con cabeceras"
correo_ip="ip$SUF@correo.gt"
for i in 1 2 3 4 5 6 7 8 9 10; do   # mismo reintento ante el 429 de /login que el resto de la suite
    r=$(codigo -X POST -H 'X-Forwarded-For: 6.6.6.6' -H 'X-Real-IP: 7.7.7.7' -H 'Content-Type: application/json' \
        -d "{\"email\":\"$correo_ip\",\"password\":\"x\"}" "$BASE/api/auth/login")
    [[ $r != 429 ]] && break
    sleep 3
done
ip=$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/auditoria/eventos?usuario_email=$correo_ip&limite=1" | jq -r '.eventos[0].ip_origen')
[[ -n "$ip" && "$ip" != null && "$ip" != 6.6.6.6 && "$ip" != 7.7.7.7 ]] && ok "la bitácora registra la IP real de la conexión ($ip), no la inventada" || mal "se aceptó una IP falsificada: $ip"

caso "CP-36 Clima del panel admin (API externa: OpenWeatherMap u Open-Meteo)"
esperar "un cliente no puede pedir el clima → 403" 403 "$(codigo -H "Authorization: Bearer $T2" "$BASE/api/pedidos/admin/clima")"
esperar "la ruta interna no se publica en el gateway" 404 "$(codigo -X POST "$BASE/internal/notificaciones/clima")"
clima=$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/pedidos/admin/clima")
if jq -e '(.temperatura | type) == "number" and (.descripcion | length) > 0' <<<"$clima" >/dev/null; then
    ok "el admin ve el clima: $(jq -r '"\(.temperatura) °C, \(.descripcion) (\(.proveedor))"' <<<"$clima")"
elif [[ $(jq -r .error <<<"$clima") == "Clima no disponible" ]]; then
    # El proveedor es externo: si no responde, lo que se prueba es que la falla sea controlada.
    ok "el proveedor del clima no respondió y el panel recibe un 503 controlado"
else
    mal "sin clima: $clima"
fi

# ======================= FASE 15: módulo de citas =======================
caso "CP-37 Mascotas: cada cliente ve y edita solo las suyas (A01)"
CLIENTE3="citas$SUF@correo.gt"
post /api/auth/registro "{\"nombre\":\"Dueña $SUF\",\"email\":\"$CLIENTE3\",\"password\":\"Segura123\"}" >/dev/null
T3=$(login "$CLIENTE3" Segura123)
mascota() { # mascota <token> <nombre> → id
    post /api/citas/mascotas "$(jq -nc --arg n "$2" '{nombre:$n, especie:"perro", raza:"Mestizo", peso_kg:12.5}')" -H "Authorization: Bearer $1" | jq -r .mascota.id
}
esperar "sin token → 401" 401 "$(codigo "$BASE/api/citas/mascotas")"
M1=$(mascota "$T2" "Firulais $SUF")
[[ "$M1" =~ $UUID_RE ]] && ok "la mascota se identifica con UUID ($M1)" || mal "id de mascota inválido: $M1"
esperar "MASCOTA_REGISTRADA en la bitácora" "$CLIENTE2|$M1" "$(evento_ultimo MASCOTA_REGISTRADA | jq -r '"\(.usuario_email)|\(.dato_nuevo.mascota_id)"')"
esperar "otro cliente no ve la mascota en su lista" 0 "$("${C[@]}" -H "Authorization: Bearer $T3" "$BASE/api/citas/mascotas" | jq --arg m "$M1" '[.mascotas[] | select(.id==$m)] | length')"
esperar "editar una mascota ajena → 404" 404 "$(codigo -X PATCH -H "Authorization: Bearer $T3" -H 'Content-Type: application/json' -d '{"nombre":"Robado"}' "$BASE/api/citas/mascotas/$M1")"
esperar "el intento queda como ACCESO_DENEGADO" "mascota|$CLIENTE3" "$(evento_ultimo ACCESO_DENEGADO | jq -r '"\(.dato_nuevo.recurso)|\(.usuario_email)"')"
esperar "especie inválida → 422" 422 "$(codigo -X POST -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d '{"nombre":"X","especie":"dragon"}' "$BASE/api/citas/mascotas")"
esperar "XSS en el nombre → 400" 400 "$(codigo -X POST -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d '{"nombre":"<script>alert(1)</script>","especie":"gato"}' "$BASE/api/citas/mascotas")"
esperar "editar la propia: peso actualizado" 14 "$("${C[@]}" -X PATCH -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d '{"peso_kg":14}' "$BASE/api/citas/mascotas/$M1" | jq .mascota.peso_kg)"
esperar "MASCOTA_ACTUALIZADA guarda el peso anterior y el nuevo" "12.5|14" "$(evento_ultimo MASCOTA_ACTUALIZADA | jq -r '"\(.dato_anterior.peso_kg)|\(.dato_nuevo.peso_kg)"')"

caso "CP-38 Disponibilidad y reserva de citas"
# Día al azar entre mañana y +40 días (nunca domingo), para que corridas seguidas no llenen la agenda.
# Las fechas se calculan en la hora de Guatemala (la del servicio), no en la de la máquina (el CI corre en UTC).
gt() { TZ=America/Guatemala date "$@"; }
DIA=$(gt -d "+$(( 1 + 10#$SUF % 40 )) day" +%F); [[ $(gt -d "$DIA" +%u) == 7 ]] && DIA=$(gt -d "$DIA +1 day" +%F)
DOMINGO=$(gt -d "next sunday" +%F)
disp() { "${C[@]}" "$BASE/api/citas/disponibilidad?servicio=${2:-veterinaria}&fecha=$1"; }
turnos=$(disp "$DIA")
esperar "disponibilidad pública (sin cuenta)" 200 "$(codigo "$BASE/api/citas/disponibilidad?servicio=veterinaria&fecha=$DIA")"
esperar "la consulta veterinaria se agenda en la sede Centro" centro "$(jq -r .sede.codigo <<<"$turnos")"
esperar "domingo cerrado: sin turnos" 0 "$(disp "$DOMINGO" | jq '.turnos | length')"
esperar "fecha pasada → 422" 422 "$(codigo "$BASE/api/citas/disponibilidad?servicio=veterinaria&fecha=$(gt -d yesterday +%F)")"
esperar "servicio inexistente → 422" 422 "$(codigo "$BASE/api/citas/disponibilidad?servicio=cirugia&fecha=$DIA")"
HORA=$(jq -r '[.turnos[] | select(.libres==2)][0].hora' <<<"$turnos")
reservar() { # reservar <token> <mascota> <hora> [dia] → cuerpo<LF>código
    "${C[@]}" -w '\n%{http_code}' -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg m "$2" --arg h "$3" --arg d "${4:-$DIA}" '{mascota_id:$m, servicio:"veterinaria", fecha:$d, hora:$h, nombre:"Compradora Prueba", telefono:"+502 5512-3478", notas:"Control"}')" "$BASE/api/citas"
}
esperar "fuera de horario (07:00) → 422" 422 "$(reservar "$T2" "$M1" 07:00 | tail -1)"
esperar "con la mascota de otro cliente → 404" 404 "$(reservar "$T3" "$M1" "$HORA" | tail -1)"
r=$(reservar "$T2" "$M1" "$HORA")
esperar "reserva → 201" 201 "$(tail -1 <<<"$r")"
CITA=$(head -n -1 <<<"$r" | jq -r .cita.id)
esperar "la cita queda pendiente con UUID" "pendiente|true" "$(head -n -1 <<<"$r" | jq -r --arg re "$UUID_RE" '"\(.cita.estado)|\(.cita.id | test($re))"')"
esperar "CITA_CREADA en la bitácora" "$CITA|$DIA ${HORA}:00" "$(evento_ultimo CITA_CREADA | jq -r '"\(.dato_nuevo.cita_id)|\(.dato_nuevo.inicio)"')"
esperar "el turno queda con 1 cupo libre" 1 "$(disp "$DIA" | jq --arg h "$HORA" '.turnos[] | select(.hora==$h) | .libres')"
esperar "la misma mascota no puede tener dos citas a la misma hora → 409" 409 "$(reservar "$T2" "$M1" "$HORA" | tail -1)"
esperar "otro cliente no puede cancelar la cita → 404" 404 "$(codigo -X POST -H "Authorization: Bearer $T3" "$BASE/api/citas/$CITA/cancelar")"
esperar "otro cliente no la ve en «mis citas»" 0 "$("${C[@]}" -H "Authorization: Bearer $T3" "$BASE/api/citas" | jq --arg c "$CITA" '[.citas[] | select(.id==$c)] | length')"

caso "CP-39 Sin doble reserva aunque lleguen a la vez (condición de carrera)"
HORA2=$(disp "$DIA" | jq -r '[.turnos[] | select(.libres==2)][0].hora')
P1=$(mascota "$T3" "Luna $SUF"); P2=$(mascota "$T3" "Max $SUF"); P3=$(mascota "$T3" "Toby $SUF")
carrera=$(mktemp -d)
for p in "$P1" "$P2" "$P3"; do { reservar "$T3" "$p" "$HORA2" | tail -1; echo; } > "$carrera/$p" & done; wait
codigos=$(cat "$carrera"/* | sort | tr '\n' ' ')
CON_CITA=$(grep -l '^201$' "$carrera"/* | head -1 | xargs -r basename); rm -rf "$carrera"
esperar "3 reservas simultáneas para 2 cupos: 2 entran y 1 recibe 409" "201 201 409 " "$codigos"
esperar "el turno desaparece de la disponibilidad" 0 "$(disp "$DIA" | jq --arg h "$HORA2" '[.turnos[] | select(.hora==$h)] | length')"
esperar "en la BD hay exactamente 2 citas activas en ese turno" 2 "$(docker compose exec -T mariadb-master mariadb -N -uroot -p"$DB_ROOT_PASSWORD" -e "SELECT COUNT(*) FROM citas_db.citas WHERE sede='centro' AND inicio='$DIA $HORA2:00' AND estado<>'cancelada'")"

caso "CP-40 Agenda del admin y estados de la cita (A01, A09)"
esperar "cliente → agenda 403" 403 "$(codigo -H "Authorization: Bearer $T2" "$BASE/api/citas/admin/agenda?fecha=$DIA")"
agenda=$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/agenda?fecha=$DIA&sede=centro")
esperar "el admin ve la cita con el teléfono del cliente" "+502 5512-3478" "$(jq -r --arg c "$CITA" '.citas[] | select(.id==$c) | .cliente.telefono' <<<"$agenda")"
estado() { "${C[@]}" -w '\n%{http_code}' -X PATCH -H "Authorization: Bearer $2" -H 'Content-Type: application/json' -d "{\"estado\":\"$3\"}" "$BASE/api/citas/admin/$1/estado"; }
esperar "un cliente no puede cambiar el estado → 403" 403 "$(estado "$CITA" "$T2" confirmada | tail -1)"
esperar "pendiente → confirmada" "confirmada" "$(estado "$CITA" "$ADMIN" confirmada | head -n -1 | jq -r .cita.estado)"
esperar "CITA_ESTADO_CAMBIADO con estado anterior y nuevo" "pendiente|confirmada" "$(evento_ultimo CITA_ESTADO_CAMBIADO | jq -r '"\(.dato_anterior.estado)|\(.dato_nuevo.estado)"')"
esperar "no se marca atendida antes del día de la cita → 422" 422 "$(estado "$CITA" "$ADMIN" atendida | tail -1)"
esperar "transición inválida (confirmada → pendiente) → 422" 422 "$(estado "$CITA" "$ADMIN" pendiente | tail -1)"
esperar "el cliente cancela su cita → 200" 200 "$(codigo -X POST -H "Authorization: Bearer $T2" "$BASE/api/citas/$CITA/cancelar")"
esperar "CITA_CANCELADA en la bitácora" "$CITA|cancelada" "$(evento_ultimo CITA_CANCELADA | jq -r '"\(.dato_nuevo.cita_id)|\(.dato_nuevo.estado)"')"
esperar "al cancelar se libera el cupo" 2 "$(disp "$DIA" | jq --arg h "$HORA" '.turnos[] | select(.hora==$h) | .libres')"
esperar "cancelar de nuevo → 409" 409 "$(codigo -X POST -H "Authorization: Bearer $T2" "$BASE/api/citas/$CITA/cancelar")"
esperar "no se desactiva una mascota con citas próximas → 409" 409 "$(codigo -X DELETE -H "Authorization: Bearer $T3" "$BASE/api/citas/mascotas/$CON_CITA")"

caso "CP-42 Correo de la cita con código HMAC (R de STRIDE) y Zero Trust"
# El gateway deja 10 r/s con ráfaga de 40 por IP en /api/citas; los casos de citas van seguidos y la
# agotan. Una pausa de 4 s la repone entera (un usuario real nunca se acerca a ese ritmo).
respiro() { sleep 4; }
respiro
# El código se recalcula con COMPROBANTE_SECRET: si el cliente niega haber reservado, se puede comprobar.
codigo_cita() { printf 'cita|%s|%s' "$1" "$2" | openssl dgst -sha256 -hmac "$COMPROBANTE_SECRET" | awk '{print toupper(substr($2,1,16))}' | sed 's/.\{4\}/&-/g; s/-$//'; }
HORA3=$(disp "$DIA" | jq -r '[.turnos[] | select(.libres==2)][0].hora')
r=$(reservar "$T3" "$P1" "$HORA3")
esperar "reserva → 201" 201 "$(tail -1 <<<"$r")"
CITA3=$(head -n -1 <<<"$r" | jq -r .cita.id)
COD3=$(head -n -1 <<<"$r" | jq -r .cita.codigo_verificacion)
esperar "la cita trae su código de verificación" "true" "$(jq -rn --arg c "$COD3" '$c | test("^[0-9A-F]{4}(-[0-9A-F]{4}){3}$")')"
esperar "el código es el HMAC de la cita y su hora" "$(codigo_cita "$CITA3" "$DIA $HORA3")" "$COD3"
esperar "EMAIL_ENVIADO con la plantilla de la cita y el mismo código" "$CITA3|cita_reservada|$COD3" "$(evento_ultimo EMAIL_ENVIADO | jq -r '"\(.dato_nuevo.cita_id)|\(.dato_nuevo.plantilla)|\(.dato_nuevo.codigo_verificacion)"')"
esperar "el admin confirma → correo de confirmación" "$CITA3|cita_confirmada" "$(estado "$CITA3" "$ADMIN" confirmada >/dev/null; evento_ultimo EMAIL_ENVIADO | jq -r '"\(.dato_nuevo.cita_id)|\(.dato_nuevo.plantilla)"')"
esperar "el admin ve el código en la agenda" "$COD3" "$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/agenda?fecha=$DIA" | jq -r --arg c "$CITA3" '.citas[] | select(.id==$c) | .codigo_verificacion')"
esperar "/internal/notificaciones/cita no se publica en el gateway" 404 "$(codigo -X POST "$BASE/internal/notificaciones/cita")"
esperar "auth-service no puede pedir correos de citas → 403" 403 "$(docker compose exec -T auth-service php -r '
    const SERVICE_DIR = "/var/www/app"; require "/var/www/shared/bootstrap.php";
    [$c] = Huellitas\Interno::post("http://notificaciones-service:8085/internal/notificaciones/cita", ["tipo" => "reservada"]); echo $c;')"

caso "CP-43 Bloqueo de turnos: feriados y mantenimiento (A01, A09)"
respiro
bloquear() { "${C[@]}" -w '\n%{http_code}' -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2" "$BASE/api/citas/admin/bloqueos"; }
mas30() { local m=$(( 10#${1%:*} * 60 + 10#${1#*:} + 30 )); printf '%02d:%02d' $((m / 60)) $((m % 60)); }
HORA4=$(disp "$DIA" | jq -r '[.turnos[] | select(.libres==2)][0].hora')
cuerpo=$(jq -nc --arg d "$DIA" --arg i "$HORA4" --arg f "$(mas30 "$HORA4")" '{sede:"centro", fecha:$d, hora_inicio:$i, hora_fin:$f, motivo:"Mantenimiento del consultorio"}')
esperar "un cliente no puede bloquear → 403" 403 "$(bloquear "$T2" "$cuerpo" | tail -1)"
esperar "hora fuera de la grilla (08:15) → 422" 422 "$(bloquear "$ADMIN" "$(jq -c '.hora_inicio="08:15"' <<<"$cuerpo")" | tail -1)"
esperar "hora final antes de la inicial → 422" 422 "$(bloquear "$ADMIN" "$(jq -c '.hora_fin="08:00" | .hora_inicio="09:00"' <<<"$cuerpo")" | tail -1)"
r=$(bloquear "$ADMIN" "$(jq -c --arg i "$HORA3" --arg f "$(mas30 "$HORA3")" '.hora_inicio=$i | .hora_fin=$f' <<<"$cuerpo")")
esperar "no se bloquea un turno con citas activas → 409 con cuántas hay" "409|1" "$(tail -1 <<<"$r")|$(head -n -1 <<<"$r" | jq -r .citas)"
r=$(bloquear "$ADMIN" "$cuerpo")
esperar "bloquear un turno libre → 201" 201 "$(tail -1 <<<"$r")"
BLOQ=$(head -n -1 <<<"$r" | jq -r .bloqueo.id)
esperar "TURNO_BLOQUEADO con el motivo" "$BLOQ|Mantenimiento del consultorio" "$(evento_ultimo TURNO_BLOQUEADO | jq -r '"\(.dato_nuevo.bloqueo_id)|\(.dato_nuevo.motivo)"')"
esperar "el turno desaparece de la disponibilidad" 0 "$(disp "$DIA" | jq --arg h "$HORA4" '[.turnos[] | select(.hora==$h)] | length')"
esperar "reservar en el turno bloqueado → 422" 422 "$(reservar "$T3" "$P2" "$HORA4" | tail -1)"
esperar "la agenda del día muestra el bloqueo" "$HORA4" "$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/agenda?fecha=$DIA&sede=centro" | jq -r --argjson b "$BLOQ" '.bloqueos[] | select(.id==$b) | .hora_inicio')"
respiro
esperar "un cliente no puede quitar el bloqueo → 403" 403 "$(codigo -X DELETE -H "Authorization: Bearer $T2" "$BASE/api/citas/admin/bloqueos/$BLOQ")"
esperar "el admin lo quita → 200" 200 "$(codigo -X DELETE -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/bloqueos/$BLOQ")"
esperar "TURNO_DESBLOQUEADO guarda el bloqueo anterior" "$BLOQ|Mantenimiento del consultorio|false" "$(evento_ultimo TURNO_DESBLOQUEADO | jq -r '"\(.dato_anterior.bloqueo_id)|\(.dato_anterior.motivo)|\(.dato_nuevo.activo)"')"
esperar "el turno vuelve a estar libre" 2 "$(disp "$DIA" | jq --arg h "$HORA4" '.turnos[] | select(.hora==$h) | .libres')"
esperar "quitarlo otra vez → 404" 404 "$(codigo -X DELETE -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/bloqueos/$BLOQ")"
# Feriado: el día entero de una sede, lejos de los días que usan las demás pruebas.
FERIADO=$(gt -d "+$(( 45 + 10#$SUF % 10 )) day" +%F); [[ $(gt -d "$FERIADO" +%u) == 7 ]] && FERIADO=$(gt -d "$FERIADO +1 day" +%F)
r=$(bloquear "$ADMIN" "$(jq -nc --arg d "$FERIADO" '{sede:"sur", fecha:$d, motivo:"Feriado"}')")
esperar "bloquear el día entero (feriado) → 201" 201 "$(tail -1 <<<"$r")"
esperar "ese día la sede no tiene turnos" 0 "$(disp "$FERIADO" paseos | jq '.turnos | length')"
esperar "las otras sedes siguen abiertas" true "$(disp "$FERIADO" veterinaria | jq '.turnos | length > 0')"
codigo -X DELETE -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/bloqueos/$(head -n -1 <<<"$r" | jq -r .bloqueo.id)" >/dev/null

caso "CP-44 Historial clínico de la consulta (A.5.34, A01, A09)"
respiro
# Una consulta de ayer: por la API no se puede reservar en el pasado, así que se crea en la BD.
cita_pasada() { # cita_pasada <mascota> <servicio> <hora> → id
    local id; id=$(cat /proc/sys/kernel/random/uuid)
    docker compose exec -T mariadb-master mariadb -uroot -p"$DB_ROOT_PASSWORD" citas_db -e "
        INSERT INTO citas (id, id_cliente, mascota_id, servicio, sede, inicio, cupo, estado, cliente_nombre, cliente_email, telefono)
        SELECT '$id', id_cliente, id, '$2', (SELECT sede FROM servicios WHERE slug='$2'), '$(gt -d yesterday +%F) $3:00',
               $(( 10 + 10#$SUF % 240 )), 'confirmada', 'Compradora Prueba', '$CLIENTE2', '+502 5512-3478' FROM mascotas WHERE id='$1'" && echo "$id"
}
historial() { "${C[@]}" -w '\n%{http_code}' -X POST -H "Authorization: Bearer $2" -H 'Content-Type: application/json' -d "$3" "$BASE/api/citas/admin/$1/historial"; }
CONSULTA=$(cita_pasada "$M1" veterinaria 10:00)
PELU=$(cita_pasada "$M1" peluqueria 11:00)
PROX=$(gt -d "+1 year" +%F)
FICHA=$(jq -nc --arg p "$PROX" '{peso_kg:15.2, diagnostico:"Otitis leve en oído derecho", tratamiento:"Gotas óticas cada 12 h por 7 días", vacunas:[{nombre:"Rabia", lote:"RB-2291", proxima_dosis:$p}, {nombre:"Séxtuple", proxima_dosis:$p}]}')
esperar "un cliente no puede registrar historial → 403" 403 "$(historial "$CONSULTA" "$T2" "$FICHA" | tail -1)"
esperar "un administrador sin vincular no escribe en la ficha → 403" 403 "$(historial "$CONSULTA" "$ADMIN" "$FICHA" | tail -1)"
esperar "se vincula su cuenta a un veterinario del equipo" 200 "$(codigo -X PATCH -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "$(jq -nc --argjson u "$(auth_json GET "$ADMIN" /api/auth/me | jq '.usuario.id')" '{usuario_id:$u, colegiado:"T-1234"}')" "$BASE/api/citas/admin/equipo/2")"
esperar "en una cita futura → 422" 422 "$(historial "$CITA3" "$ADMIN" "$FICHA" | tail -1)"
esperar "en una cita de peluquería → 422" 422 "$(historial "$PELU" "$ADMIN" "$FICHA" | tail -1)"
esperar "sin diagnóstico → 422" 422 "$(historial "$CONSULTA" "$ADMIN" "$(jq -c 'del(.diagnostico)' <<<"$FICHA")" | tail -1)"
esperar "próxima dosis antes de la aplicación → 422" 422 "$(historial "$CONSULTA" "$ADMIN" "$(jq -c '.vacunas[0].proxima_dosis="2020-01-01"' <<<"$FICHA")" | tail -1)"
esperar "XSS en el diagnóstico → 400" 400 "$(historial "$CONSULTA" "$ADMIN" "$(jq -c '.diagnostico="<img src=x onerror=alert(1)>"' <<<"$FICHA")" | tail -1)"
r=$(historial "$CONSULTA" "$ADMIN" "$FICHA")
esperar "registrar la consulta → 201 con 2 vacunas" "201|2" "$(tail -1 <<<"$r")|$(head -n -1 <<<"$r" | jq '.historial.vacunas | length')"
esperar "la cita pasa a atendida" atendida "$("${C[@]}" -H "Authorization: Bearer $T2" "$BASE/api/citas" | jq -r --arg c "$CONSULTA" '.citas[] | select(.id==$c) | .estado')"
esperar "CITA_ESTADO_CAMBIADO confirmada → atendida" "$CONSULTA|confirmada|atendida" "$(evento_ultimo CITA_ESTADO_CAMBIADO | jq -r '"\(.dato_nuevo.cita_id)|\(.dato_anterior.estado)|\(.dato_nuevo.estado)"')"
reg=$(evento_ultimo HISTORIAL_REGISTRADO)
esperar "HISTORIAL_REGISTRADO con las vacunas y el peso anterior y nuevo" "$CONSULTA|Rabia,Séxtuple|14|15.2" "$(jq -r '"\(.dato_nuevo.cita_id)|\(.dato_nuevo.vacunas | join(","))|\(.dato_anterior.peso_kg)|\(.dato_nuevo.peso_kg)"' <<<"$reg")"
esperar "el diagnóstico no se copia a la bitácora (minimización)" false "$(jq '[.. | strings] | any(test("Otitis|Gotas"))' <<<"$reg")"
esperar "el peso de la mascota se actualiza" 15.2 "$("${C[@]}" -H "Authorization: Bearer $T2" "$BASE/api/citas/mascotas" | jq --arg m "$M1" '.mascotas[] | select(.id==$m) | .peso_kg')"
esperar "registrar otra vez la misma consulta → 409" 409 "$(historial "$CONSULTA" "$ADMIN" "$FICHA" | tail -1)"

caso "CP-45 Carné de vacunas: solo el dueño; el historial, solo el admin y auditado"
carne=$("${C[@]}" -H "Authorization: Bearer $T2" "$BASE/api/citas/mascotas/$M1/carne")
esperar "el dueño ve el carné con la próxima dosis" "Rabia|$PROX|vigente" "$(jq -r '.vacunas[] | select(.nombre=="Rabia") | "\(.nombre)|\(.proxima_dosis)|\(.estado)"' <<<"$carne")"
esperar "el carné no trae diagnósticos ni tratamientos" false "$(jq '[.. | strings] | any(test("Otitis|Gotas"))' <<<"$carne")"
esperar "sin token → 401" 401 "$(codigo "$BASE/api/citas/mascotas/$M1/carne")"
esperar "otro cliente → 404" 404 "$(codigo -H "Authorization: Bearer $T3" "$BASE/api/citas/mascotas/$M1/carne")"
esperar "el intento queda como ACCESO_DENEGADO al carné" "carné de vacunas|$CLIENTE3" "$(evento_ultimo ACCESO_DENEGADO | jq -r '"\(.dato_nuevo.recurso)|\(.usuario_email)"')"
esperar "un cliente no puede leer el historial clínico → 403" 403 "$(codigo -H "Authorization: Bearer $T2" "$BASE/api/citas/admin/mascotas/$M1/historial")"
hist=$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/mascotas/$M1/historial")
esperar "el admin ve el diagnóstico y el tratamiento" "Otitis leve en oído derecho|Gotas óticas cada 12 h por 7 días" "$(jq -r '.consultas[0] | "\(.diagnostico)|\(.tratamiento)"' <<<"$hist")"
esperar "cada lectura del admin queda como HISTORIAL_CONSULTADO" "$M1|admin@huellitas.gt" "$(evento_ultimo HISTORIAL_CONSULTADO | jq -r '"\(.dato_nuevo.mascota_id)|\(.usuario_email)"')"
esperar "la agenda marca la consulta con historial" true "$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/agenda?fecha=$(gt -d yesterday +%F)" | jq --arg c "$CONSULTA" '.citas[] | select(.id==$c) | .tiene_historial')"

caso "CP-46 Recordatorios: cita de mañana, vacuna por vencer y citas sin atender (C1)"
respiro
sqlc() { docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb-master mariadb -N -uroot citas_db -e "$1"; }
cupo_bd=$(( 10 + 10#$SUF % 200 ))
cita_bd() { # cita_bd <mascota> <servicio> <inicio> <creada> <email> → id   (cada una en su propio cupo)
    local id; id=$(cat /proc/sys/kernel/random/uuid); cupo_bd=$((cupo_bd + 1))
    sqlc "INSERT INTO citas (id, id_cliente, mascota_id, servicio, sede, inicio, cupo, estado, cliente_nombre, cliente_email, telefono, created_at)
          SELECT '$id', id_cliente, id, '$2', (SELECT sede FROM servicios WHERE slug='$2'), '$3', $((cupo_bd % 250 + 5)), 'confirmada',
                 'Dueña Prueba', '$5', '+502 5512-3478', '$4' FROM mascotas WHERE id='$1'" && echo "$id"
}
eventos() { "${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/auditoria/eventos?accion=$1&limite=30" | jq -c '.eventos'; }
MANANA=$(cita_bd "$P3" veterinaria "$(gt -d '+20 hour' '+%F %H:00:00')" "$(gt -d '-3 day' '+%F %T')" "$CLIENTE3")
RECIENTE=$(cita_bd "$P1" veterinaria "$(gt -d '+21 hour' '+%F %H:00:00')" "$(gt '+%F %T')" "$CLIENTE3")
VIEJA=$(cita_bd "$P2" peluqueria "$(gt -d '-3 day' '+%F') 10:00:00" "$(gt -d '-5 day' '+%F %T')" "$CLIENTE3")
HIST=$(jq -r '.consultas[0].id' <<<"$hist")
VAC_POR_VENCER=$(cat /proc/sys/kernel/random/uuid); VAC_RENOVADA=$(cat /proc/sys/kernel/random/uuid)
sqlc "INSERT INTO vacunas (id, mascota_id, historial_id, nombre, fecha_aplicacion, proxima_dosis) VALUES
      ('$VAC_POR_VENCER', '$M1', '$HIST', 'Leptospirosis', '$(gt -d '-1 year' +%F)', '$(gt -d '+5 day' +%F)'),
      ('$VAC_RENOVADA',   '$M1', '$HIST', 'Rabia',         '$(gt -d '-1 year' +%F)', '$(gt -d '+3 day' +%F)')"
docker compose exec -T citas-recordatorios php /var/www/app/bin/recordatorios.php >/dev/null
esperar "la cita de mañana queda con su recordatorio" 1 "$(sqlc "SELECT recordatorio_at IS NOT NULL FROM citas WHERE id='$MANANA'")"
esperar "RECORDATORIO_ENVIADO de la cita" "$CLIENTE3" "$(eventos RECORDATORIO_ENVIADO | jq -r --arg c "$MANANA" '.[] | select(.dato_nuevo.cita_id==$c) | .usuario_email')"
esperar "con su correo de recordatorio (EMAIL_ENVIADO)" cita_recordatorio "$(eventos EMAIL_ENVIADO | jq -r --arg c "$MANANA" '[.[] | select(.dato_nuevo.cita_id==$c)][0].dato_nuevo.plantilla')"
esperar "si se reservó hace unas horas no se manda (ya recibió el de la reserva)" 0 "$(sqlc "SELECT recordatorio_at IS NOT NULL FROM citas WHERE id='$RECIENTE'")"
esperar "la vacuna que vence en 5 días se avisa" "1|Leptospirosis" "$(sqlc "SELECT aviso_at IS NOT NULL FROM vacunas WHERE id='$VAC_POR_VENCER'")|$(eventos RECORDATORIO_ENVIADO | jq -r --arg v "$VAC_POR_VENCER" '.[] | select(.dato_nuevo.vacuna_id==$v) | .dato_nuevo.vacuna')"
esperar "una dosis ya renovada no se avisa" 0 "$(sqlc "SELECT aviso_at IS NOT NULL FROM vacunas WHERE id='$VAC_RENOVADA'")"
esperar "la cita de hace 3 días sin atender queda «no asistió»" no_asistio "$(sqlc "SELECT estado FROM citas WHERE id='$VIEJA'")"
esperar "y queda marcada como cierre automático, por revisar" 1 "$(sqlc "SELECT cierre_automatico FROM citas WHERE id='$VIEJA'")"
esperar "CITA_ESTADO_CAMBIADO con origen cierre automático" "confirmada|no_asistio|cierre automático" "$(eventos CITA_ESTADO_CAMBIADO | jq -r --arg c "$VIEJA" '.[] | select(.dato_nuevo.cita_id==$c) | "\(.dato_anterior.estado)|\(.dato_nuevo.estado)|\(.dato_nuevo.origen)"')"
esperar "la de ayer se deja abierta (el admin aún puede registrarla)" confirmada "$(sqlc "SELECT estado FROM citas WHERE id='$PELU'")"
antes=$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/auditoria/eventos?accion=RECORDATORIO_ENVIADO&limite=1" | jq -r '.eventos[0].id')
docker compose exec -T citas-recordatorios php /var/www/app/bin/recordatorios.php >/dev/null
esperar "una segunda corrida no repite avisos" "$antes" "$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/auditoria/eventos?accion=RECORDATORIO_ENVIADO&limite=1" | jq -r '.eventos[0].id')"
esperar "la tarea reporta su salud por el último ciclo correcto" healthy "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q citas-recordatorios)")"
esperar "el script no se puede llamar por HTTP (ni desde la red interna)" 404 "$(docker compose exec -T auth-service curl -s -o /dev/null -w '%{http_code}' http://citas-service:8087/bin/recordatorios.php)"
esperar "solo citas-service puede pedir avisos de vacunas → 403" 403 "$(docker compose exec -T auth-service php -r '
    const SERVICE_DIR = "/var/www/app"; require "/var/www/shared/bootstrap.php";
    [$c] = Huellitas\Interno::post("http://notificaciones-service:8085/internal/notificaciones/vacuna", []); echo $c;')"

caso "CP-41 Un cliente no puede acaparar la agenda (D de STRIDE)"
respiro
ultimo=""
for h in $(disp "$DIA" | jq -r '.turnos[].hora' | head -8); do
    ultimo=$(reservar "$T2" "$M1" "$h")
    [[ $(tail -1 <<<"$ultimo") == 409 ]] && break
done
esperar "la 4.ª cita próxima de la misma mascota → 409" "409|true" "$(tail -1 <<<"$ultimo")|$(head -n -1 <<<"$ultimo" | jq -r '.error | test("citas próximas")')"
esperar "la mascota tiene 3 citas próximas (límite por mascota)" 3 "$("${C[@]}" -H "Authorization: Bearer $T2" "$BASE/api/citas" | jq '[.citas[] | select(.estado=="pendiente")] | length')"

caso "CP-47 Alta de productos desde el panel (A01, A03, A09)"
nuevo_producto() { # nuevo_producto <cambios jq sobre el cuerpo válido>
    jq -nc --arg n "Producto de prueba $SUF" "{nombre:\$n, marca:\"Marca $SUF\", mascota:\"perro\", categoria:\"juguetes\",
        descripcion:\"Juguete de prueba creado por tests/seguridad.sh.\",
        imagen_url:\"https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=2000\",
        variantes:[{etiqueta:\"M\", precio:95, stock:10}, {etiqueta:\"L\", precio:120, precio_anterior:150, stock:0}]} | $1"
}
esperar "cliente no puede crear productos → 403" 403 "$(codigo -X POST -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d "$(nuevo_producto .)" "$BASE/api/catalogo/admin/productos")"
esperar "imagen de un dominio cualquiera → 422" 422 "$(codigo -X POST -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "$(nuevo_producto '.imagen_url="https://evil.example/x.png"')" "$BASE/api/catalogo/admin/productos")"
esperar "precio negativo en una presentación → 422" 422 "$(codigo -X POST -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "$(nuevo_producto '.variantes[0].precio=-5')" "$BASE/api/catalogo/admin/productos")"
esperar "presentaciones repetidas → 422" 422 "$(codigo -X POST -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "$(nuevo_producto '.variantes[1].etiqueta="m"')" "$BASE/api/catalogo/admin/productos")"
esperar "XSS en la descripción → 400" 400 "$(codigo -X POST -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "$(nuevo_producto '.descripcion="<script>alert(1)</script> juguete"')" "$BASE/api/catalogo/admin/productos")"
r=$(auth_json POST "$ADMIN" /api/catalogo/admin/productos "$(nuevo_producto '. + {slug:"hackeado", sku:"X-1"}')")
PROD=$(jq '.producto.id' <<<"$r")
esperar "admin crea el producto; el slug lo pone el servidor" "producto-de-prueba-$SUF" "$(jq -r .producto.slug <<<"$r")"
esperar "los SKU los pone el servidor" "$(printf 'HU-%03d-1,HU-%03d-2' "$PROD" "$PROD")" "$(jq -r '[.producto.variantes[].sku] | join(",")' <<<"$r")"
esperar "la imagen de Unsplash se normaliza al tamaño del catálogo" true "$(jq '.producto.imagen_url | endswith("w=600&h=600&q=75")' <<<"$r")"
esperar "aparece en el catálogo público (caché invalidada)" "M,L" "$("${C[@]}" "$BASE/api/catalogo/productos" | jq -r --arg s "producto-de-prueba-$SUF" '.productos[] | select(.slug==$s) | [.variantes[].etiqueta] | join(",")')"
esperar "PRODUCTO_CREADO con quién y qué" "$PROD|admin|2" "$(evento_ultimo PRODUCTO_CREADO | jq -r '"\(.dato_nuevo.producto_id)|\(.rol)|\(.dato_nuevo.variantes | length)"')"
auth_json PATCH "$ADMIN" "/api/catalogo/admin/productos/$PROD" '{"activo":false}' >/dev/null  # no deja el producto de prueba en la tienda

caso "CP-50 Reembolsos, reseñas y edición del catálogo (A01, A08, A09)"
pedido_pagado() { # → id de un pedido de T2 pagado con un webhook firmado (igual que en CP-26)
    local id tot pi ev ts
    read -r id tot <<<"$(nuevo_pedido)"; pi="pi_reemb_$SUF$RANDOM"; fixture_pago "$id" "$tot" "$pi"
    ev=$(evento_stripe payment_intent.succeeded "$pi" "$(jq -n "$tot*100|round")" "$id"); ts=$(date +%s)
    webhook "$ev" "t=$ts,v1=$(firmar "$ts" "$ev")" >/dev/null
    echo "$id"
}
reembolsos_de() { "${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/auditoria/eventos?accion=REEMBOLSO_PENDIENTE&limite=50" | jq --arg p "$1" '[.eventos[] | select(.pedido_id==$p)] | length'; }
auth_json PATCH "$ADMIN" "/api/catalogo/admin/variantes/$var_id" '{"stock":500}' >/dev/null
R1=$(pedido_pagado)
esperar "pedido de prueba pagado" pagado "$(estado_pedido "$R1")"
esperar "un cliente no puede cancelar desde el panel → 403" 403 "$(codigo -X PATCH -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d '{"estado":"cancelado"}' "$BASE/api/pedidos/admin/$R1/estado")"
esperar "cancelar un pedido cobrado deja el reembolso pendiente" "cancelado|pendiente" "$(auth_json PATCH "$ADMIN" "/api/pedidos/admin/$R1/estado" '{"estado":"cancelado","comentario":"Sin stock"}' | jq -r '"\(.pedido.estado)|\(.pedido.reembolso.estado)"')"
esperar "REEMBOLSO_PENDIENTE con el motivo y quién canceló" "$R1|pedido cobrado y cancelado|admin" "$(evento_ultimo REEMBOLSO_PENDIENTE | jq -r '"\(.pedido_id)|\(.dato_nuevo.motivo)|\(.rol)"')"
# Pago que llega después de que el cliente canceló: no reactiva el pedido.
read -r R2 TOT2 <<<"$(nuevo_pedido)"; PI_R2="pi_tarde_$SUF$RANDOM"; fixture_pago "$R2" "$TOT2" "$PI_R2"
esperar "el cliente cancela su pedido sin pagar" 200 "$(codigo -X POST -H "Authorization: Bearer $T2" "$BASE/api/pedidos/$R2/cancelar")"
for i in 1 2; do  # la pasarela reintenta: dos avisos distintos del mismo cobro
    EV=$(evento_stripe payment_intent.succeeded "$PI_R2" "$(jq -n "$TOT2*100|round")" "$R2"); TS=$(date +%s)
    webhook "$EV" "t=$TS,v1=$(firmar "$TS" "$EV")" >/dev/null
done
esperar "el pago tardío no reactiva el pedido" "cancelado|pendiente" "$(auth_json GET "$ADMIN" "/api/pedidos/$R2" | jq -r '"\(.pedido.estado)|\(.pedido.reembolso.estado)"')"
esperar "REEMBOLSO_PENDIENTE por pago tardío, una sola vez" "pago recibido después de cancelar|1" "$(evento_ultimo REEMBOLSO_PENDIENTE | jq -r .dato_nuevo.motivo)|$(reembolsos_de "$R2")"
# Reembolso por la pasarela: sin claves no se puede, y solo pedidos-service puede pedirlo a pagos.
r=$(codigo -X POST -H "Authorization: Bearer $ADMIN" "$BASE/api/pedidos/admin/$R1/reembolso/pasarela")
[[ $r =~ ^50[23]$ ]] && ok "sin claves, reembolsar por la pasarela → $r" || mal "reembolsar sin claves respondió $r"
esperar "el reembolso sigue pendiente" pendiente "$(auth_json GET "$ADMIN" "/api/pedidos/$R1" | jq -r .pedido.reembolso.estado)"
r=$(docker compose exec -T catalogo-service php -r '
    const SERVICE_DIR = "/var/www/app"; require "/var/www/shared/bootstrap.php";
    [$c] = Huellitas\Interno::post("http://pagos-service:8084/internal/pagos/reembolsar", ["pedido_id" => Huellitas\Jwt::uuid()]);
    echo $c;')
esperar "catalogo-service no puede pedir reembolsos → 403" 403 "$r"
# Registrar a mano el reembolso hecho en el panel de la pasarela.
esperar "un cliente no puede registrar reembolsos → 403" 403 "$(codigo -X PATCH -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d '{"referencia":"re_x"}' "$BASE/api/pedidos/admin/$R1/reembolso")"
esperar "XSS en la referencia → 400" 400 "$(codigo -X PATCH -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"referencia":"<script>alert(1)</script>"}' "$BASE/api/pedidos/admin/$R1/reembolso")"
esperar "registrar el reembolso → hecho" "hecho|re_manual_$SUF" "$(auth_json PATCH "$ADMIN" "/api/pedidos/admin/$R1/reembolso" "{\"referencia\":\"re_manual_$SUF\"}" | jq -r '"\(.pedido.reembolso.estado)|\(.pedido.reembolso.referencia)"')"
esperar "REEMBOLSO_REGISTRADO con quién y la referencia" "$R1|admin@huellitas.gt|re_manual_$SUF" "$(evento_ultimo REEMBOLSO_REGISTRADO | jq -r '"\(.pedido_id)|\(.usuario_email)|\(.dato_nuevo.referencia)"')"
esperar "registrarlo otra vez → 409" 409 "$(codigo -X PATCH -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"referencia":"re_otra"}' "$BASE/api/pedidos/admin/$R1/reembolso")"
# Si la pasarela ya lo había reembolsado, no se le vuelve a pedir: se reutiliza la referencia guardada.
docker compose exec -T mariadb-master mariadb -uroot -p"$DB_ROOT_PASSWORD" -e "UPDATE pagos_db.pagos SET reembolso_ref='re_previo_$SUF', reembolsado_en=NOW() WHERE payment_intent_id='$PI_R2'"
esperar "un reembolso ya hecho en la pasarela no se repite" "hecho|Stripe re_previo_$SUF" "$(auth_json POST "$ADMIN" "/api/pedidos/admin/$R2/reembolso/pasarela" | jq -r '"\(.pedido.reembolso.estado)|\(.pedido.reembolso.referencia)"')"
# Reseñas: solo quien compró, y no se publican hasta moderarlas.
SLUG=alimento-seco-pollo-arroz
resena() { "${C[@]}" -w '\n%{http_code}' -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2" "$BASE/api/catalogo/productos/$SLUG/resenas"; }
NO_COMPRO="sincompra$SUF@correo.gt"
post /api/auth/registro "{\"nombre\":\"Sin Compra $SUF\",\"email\":\"$NO_COMPRO\",\"password\":\"Segura123\"}" >/dev/null
esperar "quien no compró no puede opinar → 403" 403 "$(resena "$(login "$NO_COMPRO" Segura123)" '{"calificacion":5,"comentario":"Excelente"}' | tail -1)"
esperar "el personal no publica reseñas → 403" 403 "$(resena "$ADMIN" '{"calificacion":5}' | tail -1)"
esperar "calificación fuera de 1–5 → 422" 422 "$(resena "$T2" '{"calificacion":7}' | tail -1)"
esperar "XSS en el comentario → 400" 400 "$(resena "$T2" '{"calificacion":4,"comentario":"<img src=x onerror=alert(1)>"}' | tail -1)"
COMENT="Prueba $SUF: a mi perro le encantó"
esperar "quien compró publica su reseña → 201" 201 "$(resena "$T2" "$(jq -nc --arg c "$COMENT" '{calificacion:5, comentario:$c}')" | tail -1)"
PROD_ID=$(auth_json GET "$ADMIN" /api/catalogo/admin/productos | jq --argjson v "$var_id" '.productos[] | select(any(.variantes[]; .id==$v)) | .id')
esperar "RESENA_PUBLICADA con el producto y la calificación" "$CLIENTE2|$PROD_ID|5" "$(evento_ultimo RESENA_PUBLICADA | jq -r '"\(.usuario_email)|\(.dato_nuevo.producto_id)|\(.dato_nuevo.calificacion)"')"
publica() { "${C[@]}" "$BASE/api/catalogo/productos/$SLUG/resenas" | jq --arg c "$COMENT" '[.. | objects | select(.comentario? == $c)] | length'; }
esperar "no aparece en la tienda hasta moderarla" 0 "$(publica)"
RES_ID=$(auth_json GET "$ADMIN" /api/catalogo/admin/resenas | jq --arg c "$COMENT" '.resenas[] | select(.comentario==$c) | .id')
esperar "un cliente no puede moderar → 403" 403 "$(codigo -X PATCH -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d '{"visible":true}' "$BASE/api/catalogo/admin/resenas/$RES_ID")"
esperar "el admin la aprueba → 200" 200 "$(codigo -X PATCH -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"visible":true}' "$BASE/api/catalogo/admin/resenas/$RES_ID")"
esperar "aprobada, aparece en la tienda con nombre e inicial" 1 "$(publica)"
esperar "PRODUCTO_ACTUALIZADO por la moderación (visible antes y después)" "$RES_ID|false|true" "$(evento_ultimo PRODUCTO_ACTUALIZADO | jq -r '"\(.dato_anterior.resena_id)|\(.dato_anterior.visible)|\(.dato_nuevo.visible)"')"
auth_json PATCH "$ADMIN" "/api/catalogo/admin/resenas/$RES_ID" '{"visible":false}' >/dev/null  # no deja la reseña de prueba en la tienda
# Edición de un producto (el de prueba de CP-47).
esperar "un cliente no puede editar productos → 403" 403 "$(codigo -X PATCH -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d '{"destacado":true}' "$BASE/api/catalogo/admin/productos/$PROD")"
auth_json PATCH "$ADMIN" "/api/catalogo/admin/productos/$PROD" '{"destacado":true}' >/dev/null
esperar "PRODUCTO_ACTUALIZADO con el valor anterior y el nuevo" "$PROD|0|1" "$(evento_ultimo PRODUCTO_ACTUALIZADO | jq -r '"\(.dato_nuevo.producto_id // .dato_anterior.producto_id)|\(.dato_anterior.destacado)|\(.dato_nuevo.destacado)"')"
auth_json PATCH "$ADMIN" "/api/catalogo/admin/productos/$PROD" '{"destacado":false}' >/dev/null

caso "CP-51 Citas: reprogramar, horarios del equipo y correcciones del historial (A01, R de STRIDE)"
respiro
DIA_R=$(gt -d "+$(( 3 + 10#$SUF % 30 )) day" +%F); [[ $(gt -d "$DIA_R" +%u) == 7 ]] && DIA_R=$(gt -d "$DIA_R +1 day" +%F)
read -r H1 H2 <<<"$(disp "$DIA_R" | jq -r '[.turnos[] | select(.libres>=1) | .hora] | "\(.[0]) \(.[-1])"')"
MR=$(mascota "$T3" "Rocky $SUF")
r=$(reservar "$T3" "$MR" "$H1" "$DIA_R")
esperar "cita de prueba reservada" 201 "$(tail -1 <<<"$r")"
CITA_R=$(head -n -1 <<<"$r" | jq -r .cita.id)
repro() { "${C[@]}" -w '\n%{http_code}' -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "{\"fecha\":\"$DIA_R\",\"hora\":\"$2\"}" "$BASE/api/citas/$CITA_R/reprogramar"; }
esperar "otro cliente no puede reprogramarla → 404" 404 "$(repro "$T2" "$H2" | tail -1)"
esperar "al mismo día y hora → 422" 422 "$(repro "$T3" "$H1" | tail -1)"
esperar "el dueño la reprograma → 200" 200 "$(repro "$T3" "$H2" | tail -1)"
esperar "CITA_REPROGRAMADA con el horario anterior y el nuevo" "$CITA_R|$DIA_R $H1:00|$DIA_R $H2:00|$CLIENTE3" "$(evento_ultimo CITA_REPROGRAMADA | jq -r '"\(.dato_nuevo.cita_id)|\(.dato_anterior.inicio)|\(.dato_nuevo.inicio)|\(.usuario_email)"')"
esperar "el historial de la cita dice quién la movió" "Reprogramada de $DIA_R $H1 a $DIA_R $H2 por el cliente" "$(sqlc "SELECT comentario FROM historial_citas WHERE cita_id='$CITA_R' AND comentario LIKE 'Reprogramada de %'")"
# Horario de un profesional: no se puede dejar fuera una cita ya agendada.
PROF=$(sqlc "SELECT cupo FROM citas WHERE id='$CITA_R'")
OTROS=$(jq -nc --argjson d "$(gt -d "$DIA_R" +%u)" '[1,2,3,4,5,6] | map(select(. != $d))')
equipo() { "${C[@]}" -o /dev/null -w '%{http_code}' -X PATCH -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2" "$BASE/api/citas/admin/equipo/$PROF"; }
esperar "un cliente no puede cambiar horarios → 403" 403 "$(equipo "$T2" '{}')"
esperar "quitarle el día de una cita agendada → 409" 409 "$(equipo "$ADMIN" "{\"dias\":$OTROS}")"
esperar "XSS en el nombre → 400" 400 "$(equipo "$ADMIN" '{"nombre":"<script>alert(1)</script>"}')"
esperar "guardar el horario sin cambios → 200" 200 "$(equipo "$ADMIN" '{}')"
esperar "PROFESIONAL_ACTUALIZADO con el horario anterior y el nuevo" "$PROF|admin@huellitas.gt|true" "$(evento_ultimo PROFESIONAL_ACTUALIZADO | jq -r '"\(.dato_nuevo.profesional_id)|\(.usuario_email)|\(.dato_anterior.dias == .dato_nuevo.dias)"')"
esperar "el dueño cancela la cita de prueba" 200 "$(codigo -X POST -H "Authorization: Bearer $T3" "$BASE/api/citas/$CITA_R/cancelar")"
# Corrección del historial de CP-44: la ficha no cambia, se agrega una adenda.
HIST_ID=$(auth_json GET "$ADMIN" "/api/citas/admin/mascotas/$M1/historial" | jq -r '.consultas[0].id')
adenda() { "${C[@]}" -w '\n%{http_code}' -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2" "$BASE/api/citas/admin/historial/${3:-$HIST_ID}/adendas"; }
esperar "un cliente no puede corregir el historial → 403" 403 "$(adenda "$T2" '{"texto":"Cambio"}' | tail -1)"
esperar "consulta inexistente → 404" 404 "$(adenda "$ADMIN" '{"texto":"Corrección"}' "$(cat /proc/sys/kernel/random/uuid)" | tail -1)"
esperar "XSS en la adenda → 400" 400 "$(adenda "$ADMIN" '{"texto":"<script>alert(1)</script>"}' | tail -1)"
r=$(adenda "$ADMIN" '{"texto":"Corrección: el oído afectado es el izquierdo"}')
esperar "la adenda se agrega y la ficha original no cambia" "201|Otitis leve en oído derecho|Corrección: el oído afectado es el izquierdo" "$(tail -1 <<<"$r")|$(head -n -1 <<<"$r" | jq -r --arg h "$HIST_ID" '.consultas[] | select(.id==$h) | "\(.diagnostico)|\(.adendas[-1].texto)"')"
cor=$(evento_ultimo HISTORIAL_CORREGIDO)
esperar "HISTORIAL_CORREGIDO con la consulta y quién la corrigió" "$HIST_ID|$M1|admin@huellitas.gt" "$(jq -r '"\(.dato_nuevo.historial_id)|\(.dato_nuevo.mascota_id)|\(.usuario_email)"' <<<"$cor")"
esperar "el texto de la corrección no va a la bitácora" false "$(jq '[.. | strings] | any(test("izquierdo"))' <<<"$cor")"

caso "CP-49 Roles del personal: mínimo privilegio y cambios auditados (A01, A.5.15, A09)"
# Un usuario temporal pasa por cada rol del personal y vuelve a cliente. El rol nuevo rige al iniciar sesión otra vez.
ROLU="rol$SUF@correo.gt"
post /api/auth/registro "{\"nombre\":\"Rol Prueba $SUF\",\"email\":\"$ROLU\",\"password\":\"Segura123\"}" >/dev/null
TR=$(login "$ROLU" Segura123)
ROL_ID=$(auth_json GET "$TR" /api/auth/me | jq -r '.usuario.id')
HIST_X=$(cat /proc/sys/kernel/random/uuid)
# ruta → roles que deben pasar (el resto debe recibir 403)
declare -A RUTAS=(
    [/api/pedidos/admin/todos]="tienda"
    [/api/catalogo/admin/productos]="tienda"
    [/api/citas/admin/semana]="veterinario recepcion"
    [/api/citas/admin/mascotas/$HIST_X/historial]="veterinario"
    [/api/auth/admin/clientes]="veterinario recepcion tienda"
    [/api/auth/admin/clientes/exportar]=""
    [/api/auth/admin/personal]=""
    [/api/auditoria/eventos]=""
)
for rol in veterinario recepcion tienda; do
    esperar "el admin asigna el rol $rol" "$rol" "$(auth_json PATCH "$ADMIN" "/api/auth/admin/usuarios/$ROL_ID/rol" "{\"rol\":\"$rol\"}" | jq -r .usuario.rol)"
    TROL=$(login "$ROLU" Segura123)
    esperar "$rol entra al panel" 200 "$(codigo -X POST -H "Authorization: Bearer $TROL" "$BASE/api/auth/admin/acceso")"
    mal_rol=""
    for ruta in "${!RUTAS[@]}"; do
        c=$(codigo -H "Authorization: Bearer $TROL" "$BASE$ruta")
        if [[ " ${RUTAS[$ruta]} " == *" $rol "* ]]; then [[ $c == 403 ]] && mal_rol+=" $ruta(403)"; else [[ $c != 403 ]] && mal_rol+=" $ruta($c)"; fi
    done
    esperar "$rol solo llega a las rutas de su trabajo" "" "${mal_rol# }"
done
esperar "el personal no puede cambiar roles → 403" 403 "$(codigo -X PATCH -H "Authorization: Bearer $TROL" -H 'Content-Type: application/json' -d '{"rol":"admin"}' "$BASE/api/auth/admin/usuarios/$ROL_ID/rol")"
ADMIN_ID=$(auth_json GET "$ADMIN" /api/auth/me | jq -r '.usuario.id')
esperar "el admin no puede cambiar su propio rol → 409" 409 "$(codigo -X PATCH -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"rol":"admin"}' "$BASE/api/auth/admin/usuarios/$ADMIN_ID/rol")"
esperar "rol inexistente → 422" 422 "$(codigo -X PATCH -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"rol":"superadmin"}' "$BASE/api/auth/admin/usuarios/$ROL_ID/rol")"
auth_json PATCH "$ADMIN" "/api/auth/admin/usuarios/$ROL_ID/rol" '{"rol":"cliente"}' >/dev/null
esperar "ROL_CAMBIADO guarda quién, el rol anterior y el nuevo" "admin@huellitas.gt|tienda|cliente|$ROLU" "$(evento_ultimo ROL_CAMBIADO | jq -r '"\(.usuario_email)|\(.dato_anterior.rol)|\(.dato_nuevo.rol)|\(.dato_nuevo.email)"')"
TR=$(login "$ROLU" Segura123)
esperar "de vuelta a cliente ya no entra al panel → 403" 403 "$(codigo -X POST -H "Authorization: Bearer $TR" "$BASE/api/auth/admin/acceso")"
esperar "cambiar la contraseña con la actual equivocada → 422" 422 "$(codigo -X PATCH -H "Authorization: Bearer $TR" -H 'Content-Type: application/json' -d '{"actual":"Otra1234","nueva":"Nueva12345"}' "$BASE/api/auth/password")"
esperar "cambiar la contraseña con la actual → 200" 200 "$(codigo -X PATCH -H "Authorization: Bearer $TR" -H 'Content-Type: application/json' -d '{"actual":"Segura123","nueva":"Nueva12345"}' "$BASE/api/auth/password")"
esperar "PASSWORD_CAMBIADO sin la contraseña en la bitácora" "$ROLU|false|false" "$(evento_ultimo PASSWORD_CAMBIADO | jq -r '"\(.usuario_email)|\(.dato_nuevo.era_temporal)|\(tostring | test("Nueva12345|Segura123"))"')"
esperar "la contraseña vieja ya no sirve" 401 "$(login_codigo "$ROLU" Segura123)"

caso "CP-52 Inicio de sesión con Google: token falso, repetido y cuentas existentes (A07, S de STRIDE)"
docker compose exec -T redis sh -c 'redis-cli --scan --pattern "login:*" | xargs -r redis-cli del' >/dev/null
sqlg() { docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb-master mariadb -N -uroot auth_db -e "$1"; }
GCID=$(jq -r '.client_id // empty' <<<"$("${C[@]}" "$BASE/api/auth/google/config")")
G_REINICIAR=
if [[ -z "$GCID" ]]; then
    esperar "sin GOOGLE_CLIENT_ID el servicio no acepta tokens → 503" 503 "$(codigo -X POST -H 'Content-Type: application/json' -d '{"credential":"x"}' "$BASE/api/auth/google")"
    GCID=prueba.apps.googleusercontent.com; G_REINICIAR=1
    GOOGLE_CLIENT_ID=$GCID docker compose up -d --wait auth-service >/dev/null 2>&1
fi
esperar "la configuración pública entrega el ID de cliente" "$GCID" "$("${C[@]}" "$BASE/api/auth/google/config" | jq -r .client_id)"
# Los tokens de prueba se firman con una clave propia, puesta unos minutos en la caché de certificados.
G_DIR=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$G_DIR/k.pem" -out "$G_DIR/c.pem" -subj /CN=prueba -days 1 2>/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$G_DIR/otra.pem" -out /dev/null -subj /CN=otra -days 1 2>/dev/null
jq -cn --arg c "$(cat "$G_DIR/c.pem")" '{prueba: $c}' | docker compose exec -T redis redis-cli -x SETEX google:certificados 300 >/dev/null
b64u() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
g_datos() { # g_datos <sub> <email> [ajuste jq] → datos del token
    jq -cn --arg aud "$GCID" --arg sub "$1" --arg email "$2" --argjson t "$(date +%s)" --arg j "$RANDOM$RANDOM$RANDOM" \
        '{iss: "https://accounts.google.com", aud: $aud, sub: $sub, email: $email, email_verified: true, name: "Cliente Google", iat: $t, exp: ($t + 600), jti: $j}' | jq -c "${3:-.}"
}
g_firmar() { # g_firmar <datos> [clave] [kid] [alg] → token
    local cab dat
    cab=$(printf '{"alg":"%s","kid":"%s","typ":"JWT"}' "${4:-RS256}" "${3:-prueba}" | b64u); dat=$(printf '%s' "$1" | b64u)
    printf '%s.%s.%s' "$cab" "$dat" "$(printf '%s.%s' "$cab" "$dat" | openssl dgst -sha256 -sign "${2:-$G_DIR/k.pem}" -binary | b64u)"
}
g_post() { # g_post <token> → "cuerpo<LF>código", reintentando en 429 (comparte cupo con /login)
    local r i
    for i in 1 2 3 4 5 6 7 8 9 10; do
        r=$("${C[@]}" -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"credential\":\"$1\"}" "$BASE/api/auth/google")
        [[ "${r##*$'\n'}" != 429 ]] && break
        sleep 3
    done
    printf '%s' "$r"
}
g_codigo() { local r; r=$(g_post "$1"); echo "${r##*$'\n'}"; }
GSUB="g$SUF"; GMAIL="google$SUF@correo.gt"
esperar "token que no es un JWT → 401" 401 "$(g_codigo basura.basura.basura)"
esperar "firmado con otra clave → 401" 401 "$(g_codigo "$(g_firmar "$(g_datos "$GSUB" "$GMAIL")" "$G_DIR/otra.pem")")"
esperar "con un certificado que no existe → 401" 401 "$(g_codigo "$(g_firmar "$(g_datos "$GSUB" "$GMAIL")" "$G_DIR/k.pem" desconocido)")"
esperar "algoritmo none → 401" 401 "$(g_codigo "$(printf '{"alg":"none","kid":"prueba"}' | b64u).$(g_datos "$GSUB" "$GMAIL" | b64u).")"
esperar "para otra aplicación (aud) → 401" 401 "$(g_codigo "$(g_firmar "$(g_datos "$GSUB" "$GMAIL" '.aud="otra.apps.googleusercontent.com"')")")"
esperar "de otro emisor (iss) → 401" 401 "$(g_codigo "$(g_firmar "$(g_datos "$GSUB" "$GMAIL" '.iss="https://evil.example"')")")"
esperar "token vencido → 401" 401 "$(g_codigo "$(g_firmar "$(g_datos "$GSUB" "$GMAIL" '.exp=(.iat-300)')")")"
esperar "correo sin verificar por Google → 401" 401 "$(g_codigo "$(g_firmar "$(g_datos "$GSUB" "$GMAIL" '.email_verified=false')")")"
esperar "ningún token falso creó la cuenta" 0 "$(sqlg "SELECT COUNT(*) FROM usuarios WHERE google_sub='$GSUB' OR email='$GMAIL'")"
esperar "el intento falso queda en la bitácora" "(google)|FALLO" "$(evento_ultimo LOGIN_CLIENTE_FALLIDO | jq -r '"\(.usuario_email)|\(.resultado)"')"
G_TOK=$(g_firmar "$(g_datos "$GSUB" "$GMAIL" '.email=(.email|ascii_upcase)')")
r=$(g_post "$G_TOK")
esperar "un token válido crea la cuenta → 200" 200 "${r##*$'\n'}"
G_JWT=$(jq -r '.token // empty' <<<"${r%$'\n'*}")
esperar "siempre con rol cliente y el correo en minúsculas" "cliente|$GMAIL|true" "$(jq -r '.usuario | "\(.rol)|\(.email)|\(.google)"' <<<"${r%$'\n'*}")"
esperar "la sesión sirve" 200 "$(codigo -H "Authorization: Bearer $G_JWT" "$BASE/api/auth/me")"
esperar "REGISTRO_CLIENTE con origen google" "$GMAIL|google" "$(evento_ultimo REGISTRO_CLIENTE | jq -r '"\(.usuario_email)|\(.dato_nuevo.origen)"')"
esperar "LOGIN_CLIENTE_EXITOSO con método google" "$GMAIL|google" "$(evento_ultimo LOGIN_CLIENTE_EXITOSO | jq -r '"\(.usuario_email)|\(.dato_nuevo.metodo)"')"
esperar "el mismo token no sirve dos veces → 401" 401 "$(g_codigo "$G_TOK")"
r=$(g_post "$(g_firmar "$(g_datos "$GSUB" "otro$GMAIL" '.name="<script>alert(1)</script>"')")")
esperar "otro token de esa cuenta entra en la misma, aunque cambie el correo" "200|1" "${r##*$'\n'}|$(sqlg "SELECT COUNT(*) FROM usuarios WHERE google_sub='$GSUB'")"
r=$(g_post "$(g_firmar "$(g_datos "n$SUF" "nombre$SUF@correo.gt" '.name="<script>alert(1)</script>"')")")
esperar "un nombre con código no se guarda" "nombre$SUF" "$(sqlg "SELECT nombre FROM usuarios WHERE google_sub='n$SUF'")"
for correo in admin@huellitas.gt veterinaria@huellitas.gt "$CLIENTE"; do
    esperar "una cuenta con contraseña no se vincula sola: $correo → 409" "409|0" "$(g_codigo "$(g_firmar "$(g_datos "x$RANDOM$SUF" "$correo")")")|$(sqlg "SELECT COUNT(*) FROM usuarios WHERE email='$correo' AND google_sub IS NOT NULL")"
done
esperar "la cuenta de Google no entra con contraseña" 401 "$(login_codigo "$GMAIL" Segura123)"
esperar "la cuenta de Google no cambia contraseña → 409" 409 "$(codigo -X PATCH -H "Authorization: Bearer $G_JWT" -H 'Content-Type: application/json' -d '{"actual":"x","nueva":"Segura123"}' "$BASE/api/auth/password")"
esperar "la cuenta de Google no configura MFA aquí → 409" 409 "$(codigo -X POST -H "Authorization: Bearer $G_JWT" "$BASE/api/auth/mfa/configurar")"
G_ID=$(sqlg "SELECT id FROM usuarios WHERE google_sub='$GSUB'")
esperar "una cuenta de Google no pasa a ser personal → 409" 409 "$(codigo -X PATCH -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"rol":"recepcion"}' "$BASE/api/auth/admin/usuarios/$G_ID/rol")"
esperar "los certificados no se publican por el gateway" 404 "$(codigo -X POST "$BASE/internal/notificaciones/google-certificados")"
esperar "ni se entregan sin JWT de servicio" 401 "$(docker compose exec -T auth-service curl -s -o /dev/null -w '%{http_code}' -X POST http://notificaciones-service:8085/internal/notificaciones/google-certificados)"
docker compose exec -T redis redis-cli DEL google:certificados >/dev/null
esperar "con los certificados reales de Google, un token falso → 401" 401 "$(g_codigo "$(g_firmar "$(g_datos "$GSUB" "$GMAIL")")")"
esperar "los certificados reales quedaron en caché" true "$(docker compose exec -T redis redis-cli GET google:certificados | jq 'length > 0')"
docker compose exec -T redis redis-cli DEL google:certificados >/dev/null
rm -rf "$G_DIR"
[[ -n "$G_REINICIAR" ]] && docker compose up -d --wait auth-service >/dev/null 2>&1

caso "CP-53 Sedes, horarios y precios desde el panel (A01, A03, A09)"
respiro
sede_patch() { "${C[@]}" -o /dev/null -w '%{http_code}' -X PATCH -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3" "$BASE/api/citas/admin/sedes/$2"; }
srv_patch() { "${C[@]}" -o /dev/null -w '%{http_code}' -X PATCH -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3" "$BASE/api/citas/admin/servicios/$2"; }
publicas=$("${C[@]}" "$BASE/api/citas/sedes")
esperar "las sedes activas son públicas" true "$(jq '[.sedes[].codigo] | index("centro") != null' <<<"$publicas")"
esperar "lo público no trae datos internos" false "$(jq '.sedes[0] | has("simultaneas") or has("citas_proximas")' <<<"$publicas")"
esperar "sin token, el panel de sedes → 401" 401 "$(codigo "$BASE/api/citas/admin/sedes")"
esperar "un cliente no administra sedes → 403" 403 "$(codigo -H "Authorization: Bearer $T2" "$BASE/api/citas/admin/sedes")"
esperar "un cliente no cambia una sede → 403" 403 "$(sede_patch "$T2" centro '{"direccion":"Otra dirección 1-23"}')"
esperar "un cliente no cambia precios → 403" 403 "$(srv_patch "$T2" veterinaria '{"precio_desde":1}')"
DIR_ORIG=$(jq -r '.sedes[] | select(.codigo=="centro") | .direccion' <<<"$publicas")
esperar "XSS en el nombre → 400" 400 "$(sede_patch "$ADMIN" centro '{"nombre":"<script>alert(1)</script>"}')"
esperar "teléfono no válido → 422" 422 "$(sede_patch "$ADMIN" centro '{"telefono":"abc"}')"
esperar "mascotas a la vez 0 → 422" 422 "$(sede_patch "$ADMIN" centro '{"simultaneas":0}')"
esperar "cierre antes de la apertura → 422" 422 "$(sede_patch "$ADMIN" centro '{"horarios":[{"dia":1,"abre":"12:00","cierra":"10:00"}]}')"
esperar "hora fuera de los 30 minutos → 422" 422 "$(sede_patch "$ADMIN" centro '{"horarios":[{"dia":1,"abre":"08:15","cierra":"10:00"}]}')"
esperar "una sede cerrada toda la semana → 422" 422 "$(sede_patch "$ADMIN" centro '{"horarios":[{"dia":1,"abre":null,"cierra":null}]}')"
esperar "desactivar una sede con servicios → 409" 409 "$(sede_patch "$ADMIN" centro '{"activa":false}')"
esperar "cambiar la dirección → 200" 200 "$(sede_patch "$ADMIN" centro "{\"direccion\":\"Avenida Prueba $SUF\"}")"
esperar "la dirección nueva llega a las reservas" true "$("${C[@]}" "$BASE/api/citas/servicios" | jq --arg s "Avenida Prueba $SUF" '[.servicios[] | select(.sede.codigo=="centro") | .sede.nombre | contains($s)] | all')"
esperar "y a la lista de retiro de la tienda" true "$("${C[@]}" "$BASE/api/pedidos/sedes" | jq --arg s "Avenida Prueba $SUF" '[.sedes[] | contains($s)] | any')"
esperar "SEDE_ACTUALIZADA guarda la dirección anterior y la nueva" "$DIR_ORIG|Avenida Prueba $SUF|admin@huellitas.gt" "$(evento_ultimo SEDE_ACTUALIZADA | jq -r '"\(.dato_anterior.direccion)|\(.dato_nuevo.direccion)|\(.usuario_email)"')"
esperar "se restaura la dirección" 200 "$(sede_patch "$ADMIN" centro "$(jq -nc --arg d "$DIR_ORIG" '{direccion:$d}')")"
esperar "la ruta interna no se publica por el gateway" 404 "$(codigo -X POST "$BASE/internal/citas/sedes-retiro")"
esperar "ni responde sin JWT de servicio" 401 "$(docker compose exec -T auth-service curl -s -o /dev/null -w '%{http_code}' -X POST http://citas-service:8087/internal/citas/sedes-retiro)"
PRECIO=$("${C[@]}" "$BASE/api/citas/servicios" | jq -r '.servicios[] | select(.slug=="veterinaria") | .precio_desde')
esperar "precio no válido → 422" 422 "$(srv_patch "$ADMIN" veterinaria '{"precio_desde":-5}')"
esperar "cambiar un precio → 200" 200 "$(srv_patch "$ADMIN" veterinaria '{"precio_desde":321.5}')"
esperar "el precio nuevo es público" 321.5 "$("${C[@]}" "$BASE/api/citas/sedes" | jq '.servicios[] | select(.slug=="veterinaria") | .precio_desde')"
esperar "SERVICIO_ACTUALIZADO guarda el precio anterior y el nuevo" "$PRECIO|321.5" "$(evento_ultimo SERVICIO_ACTUALIZADO | jq -r '"\(.dato_anterior.precio_desde)|\(.dato_nuevo.precio_desde)"')"
srv_patch "$ADMIN" veterinaria "{\"precio_desde\":$PRECIO}" >/dev/null
NUEVA=$(auth_json POST "$ADMIN" /api/citas/admin/sedes "$(jq -nc --arg n "Sede Prueba $SUF" '{nombre:$n, direccion:"Calle de prueba 1-23", telefono:"+502 5555-1234", horarios:([range(1;7)|{dia:., abre:"10:00", cierra:"12:00"}])}')")
SEDE_N=$(jq -r .creada <<<"$NUEVA")
esperar "crear una sede nueva (la base ya no se limita a tres)" true "$("${C[@]}" "$BASE/api/citas/sedes" | jq --arg c "$SEDE_N" '[.sedes[].codigo] | index($c) != null')"
SRV_LIBRE=$(jq -r '[.servicios[] | select(.citas_proximas==0 and .modalidad=="turno" and .activo)][0].slug // empty' <<<"$NUEVA")
if [[ -n "$SRV_LIBRE" ]]; then
    SEDE_SRV=$(jq -r --arg s "$SRV_LIBRE" '.servicios[] | select(.slug==$s) | .sede' <<<"$NUEVA")
    DIA_H=$(gt -d "+$(( 42 + 10#$SUF % 14 )) day" +%F); [[ $(gt -d "$DIA_H" +%u) == 7 ]] && DIA_H=$(gt -d "$DIA_H +1 day" +%F)
    esperar "mover un servicio sin citas a la sede nueva → 200" 200 "$(srv_patch "$ADMIN" "$SRV_LIBRE" "{\"sede\":\"$SEDE_N\"}")"
    esperar "los turnos siguen el horario de esa sede (10:00 a 11:30)" "10:00|11:30" "$(disp "$DIA_H" "$SRV_LIBRE" | jq -r '"\(.turnos[0].hora)|\(.turnos[-1].hora)"')"
    esperar "se devuelve a su sede" 200 "$(srv_patch "$ADMIN" "$SRV_LIBRE" "{\"sede\":\"$SEDE_SRV\"}")"
fi
esperar "desactivar una sede sin servicios ni citas → 200" 200 "$(sede_patch "$ADMIN" "$SEDE_N" '{"activa":false}')"
esperar "ya no se muestra en el sitio" false "$("${C[@]}" "$BASE/api/citas/sedes" | jq --arg c "$SEDE_N" '[.sedes[].codigo] | index($c) != null')"

borrar_sede() { "${C[@]}" -w '\n%{http_code}' -X DELETE -H "Authorization: Bearer $1" "$BASE/api/citas/admin/sedes/$2"; }
esperar "sin token no se elimina una sede → 401" 401 "$(codigo -X DELETE "$BASE/api/citas/admin/sedes/$SEDE_N")"
esperar "un cliente no elimina sedes → 403" 403 "$(borrar_sede "$T2" "$SEDE_N" | tail -1)"
r=$(borrar_sede "$ADMIN" centro)
esperar "una sede con servicios no se elimina → 409" "409|true" "$(tail -1 <<<"$r")|$(head -n -1 <<<"$r" | jq '.servicios | length > 0')"
esperar "una sede inexistente → 404" 404 "$(borrar_sede "$ADMIN" no-existe | tail -1)"
CITA_N=$(cita_bd "$M1" peluqueria "$(gt -d '+9 day' '+%F') 10:00:00" "$(gt '+%F %T')" "$CLIENTE2")
sqlc "UPDATE citas SET sede='$SEDE_N' WHERE id='$CITA_N'"
r=$(borrar_sede "$ADMIN" "$SEDE_N")
esperar "con una cita próxima no se elimina → 409" "409|1" "$(tail -1 <<<"$r")|$(head -n -1 <<<"$r" | jq .citas)"
sqlc "UPDATE citas SET sede='centro', estado='cancelada' WHERE id='$CITA_N'"
# Una cita pasada en esa sede: al eliminarla debe seguir diciendo dónde fue.
sqlc "UPDATE citas SET sede='$SEDE_N' WHERE id='$CONSULTA'"
esperar "sin servicios ni citas próximas se elimina → 200" 200 "$(borrar_sede "$ADMIN" "$SEDE_N" | tail -1)"
esperar "SEDE_ELIMINADA guarda qué sede y quién" "$SEDE_N|Sede Prueba $SUF|admin@huellitas.gt" "$(evento_ultimo SEDE_ELIMINADA | jq -r '"\(.dato_nuevo.codigo)|\(.dato_anterior.nombre)|\(.usuario_email)"')"
esperar "ya no sale en el panel" false "$(auth_json GET "$ADMIN" /api/citas/admin/sedes | jq --arg c "$SEDE_N" '[.sedes[].codigo] | index($c) != null')"
esperar "ni se puede editar → 404" 404 "$(sede_patch "$ADMIN" "$SEDE_N" '{"activa":true}')"
esperar "ni eliminar otra vez → 404" 404 "$(borrar_sede "$ADMIN" "$SEDE_N" | tail -1)"
esperar "ni recibe servicios → 422" 422 "$(srv_patch "$ADMIN" veterinaria "{\"sede\":\"$SEDE_N\"}")"
esperar "la fila sigue en la base, sin borrarse" 1 "$(sqlc "SELECT COUNT(*) FROM sedes WHERE codigo='$SEDE_N' AND eliminada_el IS NOT NULL")"
esperar "la cita pasada conserva dónde fue" true "$(auth_json GET "$ADMIN" "/api/citas/admin/agenda?fecha=$(gt -d yesterday +%F)&sede=$SEDE_N" | jq --arg c "$CONSULTA" --arg n "Sede Prueba $SUF" '[.citas[] | select(.id==$c) | .sede.nombre | contains($n)] | any')"
sqlc "UPDATE citas SET sede='centro' WHERE id='$CONSULTA'"

caso "CP-54 Mascotas a la vez en una sede: sin doble reserva, aun con peticiones simultáneas (A04)"
respiro
agendar() { # agendar <mascota> <servicio> <día> <hora> → cuerpo<LF>código
    "${C[@]}" -w '\n%{http_code}' -X POST -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg m "$1" --arg s "$2" --arg d "$3" --arg h "$4" '{mascota_id:$m, servicio:$s, fecha:$d, hora:$h, nombre:"Dueña Prueba", email:"duena@correo.gt", telefono:"+502 5512-3478", notas:"Revisión general"}')" "$BASE/api/citas/admin/citas"
}
DIA_L=$(gt -d "+$(( 20 + 10#$SUF % 18 )) day" +%F); [[ $(gt -d "$DIA_L" +%u) == 7 ]] && DIA_L=$(gt -d "$DIA_L +1 day" +%F)
PA=$(mascota "$T2" "Limite A $SUF"); PB=$(mascota "$T2" "Limite B $SUF"); PC=$(mascota "$T2" "Limite C $SUF")
esperar "sin límite elegido y con varias sedes: consulta a las 09:00 → 201" 201 "$(agendar "$PA" veterinaria "$DIA_L" 09:00 | tail -1)"
esperar "y peluquería a la misma hora (otra persona) → 201" 201 "$(agendar "$PB" peluqueria "$DIA_L" 09:00 | tail -1)"
aviso=$(auth_json PATCH "$ADMIN" /api/citas/admin/sedes/centro '{"simultaneas":1}' | jq -r '.aviso // empty')
esperar "al poner 1 a la vez, avisa de los horarios que ya lo superan" true "$(grep -q 'más de 1 a la vez' <<<"$aviso" && echo true || echo false)"
r=$(agendar "$PA" veterinaria "$DIA_L" 10:00); CITA_L=$(head -n -1 <<<"$r" | jq -r .cita.id)
esperar "con 1 a la vez: la primera mascota a las 10:00 → 201" 201 "$(tail -1 <<<"$r")"
r=$(agendar "$PB" peluqueria "$DIA_L" 10:00)
esperar "otra mascota a esa hora en otro servicio → 409" "409|sede_llena" "$(tail -1 <<<"$r")|$(head -n -1 <<<"$r" | jq -r .motivo)"
esperar "el cliente tampoco puede reservarla → 409" 409 "$(reservar "$T2" "$PC" 10:00 "$DIA_L" | tail -1)"
esperar "esa hora deja de ofrecerse en los dos servicios" 0 "$( (disp "$DIA_L" veterinaria; disp "$DIA_L" peluqueria) | jq -s '[.[].turnos[] | select(.hora=="10:00")] | length')"
esperar "la hora siguiente sigue libre" 1 "$(disp "$DIA_L" peluqueria | jq '[.turnos[] | select(.hora=="10:30")][0].libres')"
r=$(agendar "$PB" peluqueria "$DIA_L" 11:00); CITA_M=$(head -n -1 <<<"$r" | jq -r .cita.id)
esperar "otra cita a las 11:00 → 201" 201 "$(tail -1 <<<"$r")"
mover() { "${C[@]}" -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "{\"fecha\":\"$DIA_L\",\"hora\":\"$2\"}" "$BASE/api/citas/$1/reprogramar"; }
esperar "reprogramarla a una hora ocupada → 409" 409 "$(mover "$CITA_M" 10:00)"
esperar "reprogramarla a una hora libre → 200" 200 "$(mover "$CITA_M" 11:30)"
esperar "cancelar libera el lugar" 200 "$(estado "$CITA_L" "$ADMIN" cancelada | tail -1)"
esperar "otra mascota toma ese horario → 201" 201 "$(agendar "$PC" peluqueria "$DIA_L" 10:00 | tail -1)"
esperar "reactivar la cancelada ya no cabe → 409" 409 "$("${C[@]}" -o /dev/null -w '%{http_code}' -X PATCH -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"estado":"pendiente","comentario":"Se reactivó por error"}' "$BASE/api/citas/admin/$CITA_L/estado")"
# Varias reservas a la vez, de mascotas y servicios distintos, por el último lugar: solo una puede ganar.
respiro
PAR_DIR=$(mktemp -d); i=0
for s in veterinaria peluqueria veterinaria peluqueria veterinaria peluqueria; do i=$((i+1)); PM[$i]=$(mascota "$T2" "Par $i $SUF"); done
i=0
for s in veterinaria peluqueria veterinaria peluqueria veterinaria peluqueria; do i=$((i+1)); (agendar "${PM[$i]}" "$s" "$DIA_L" 14:00 | tail -1 >"$PAR_DIR/$i") & done
wait
esperar "6 reservas simultáneas a la misma hora: exactamente 1 entra" 1 "$(for f in "$PAR_DIR"/*; do cat "$f"; echo; done | grep -c '^201$')"
esperar "y en la base queda una sola" 1 "$(sqlc "SELECT COUNT(*) FROM citas WHERE sede='centro' AND inicio='$DIA_L 14:00:00' AND ocupa=1")"
rm -rf "$PAR_DIR"
esperar "con 2 a la vez entran dos" 200 "$(sede_patch "$ADMIN" centro '{"simultaneas":2}')"
esperar "la segunda a las 14:00 → 201" 201 "$(agendar "$PA" veterinaria "$DIA_L" 14:00 | tail -1)"
esperar "la tercera → 409" 409 "$(agendar "$PB" peluqueria "$DIA_L" 14:00 | tail -1)"
# Si solo queda una sede activa, sin elegir nada, se atiende de una en una.
esperar "se vuelve a automático" 200 "$(sede_patch "$ADMIN" centro '{"simultaneas":null}')"
SEDES_ON=$(sqlc "SELECT GROUP_CONCAT(CONCAT('''', codigo, '''')) FROM sedes WHERE activa = 1 AND codigo <> 'centro'")
sqlc "UPDATE sedes SET activa = 0 WHERE codigo IN ($SEDES_ON)"
esperar "con una sola sede activa, el límite automático es 1" 1 "$(auth_json GET "$ADMIN" /api/citas/admin/sedes | jq '.sedes[] | select(.codigo=="centro") | .limite')"
esperar "la primera a las 15:00 → 201" 201 "$(agendar "$PA" veterinaria "$DIA_L" 15:00 | tail -1)"
esperar "la segunda a esa hora → 409" 409 "$(agendar "$PB" peluqueria "$DIA_L" 15:00 | tail -1)"
esperar "los servicios de una sede apagada no se ofrecen" 0 "$("${C[@]}" "$BASE/api/citas/servicios" | jq '[.servicios[] | select(.sede.codigo != "centro")] | length')"
sqlc "UPDATE sedes SET activa = 1 WHERE codigo IN ($SEDES_ON)"
esperar "con varias sedes activas vuelve a decidir el equipo" 201 "$(agendar "$PB" peluqueria "$DIA_L" 15:00 | tail -1)"

caso "CP-55 Parte clínica: faltas, ficha, firma y fallecimiento (A01, A.5.34, R de STRIDE)"
respiro
CONSULTA2=$(cita_pasada "$PA" veterinaria 11:30)
PELU2=$(cita_pasada "$PB" peluqueria 12:00)
esperar "una consulta no se marca atendida sin su ficha → 422" 422 "$(estado "$CONSULTA2" "$ADMIN" atendida | tail -1)"
esperar "peluquería sí se marca atendida sin ficha → 200" 200 "$(estado "$PELU2" "$ADMIN" atendida | tail -1)"
FICHA2=$(jq -nc '{diagnostico:"Control general sin hallazgos", medicamentos:[{nombre:"Probiótico", dosis:"1 sobre", lote:"LT-77"}]}')
r=$(historial "$CONSULTA2" "$ADMIN" "$FICHA2")
esperar "guardar la ficha la marca atendida → 201" "201|atendida" "$(tail -1 <<<"$r")|$(sqlc "SELECT estado FROM citas WHERE id='$CONSULTA2'")"
esperar "la ficha queda firmada con nombre y colegiado" "Dr. Luis Pérez|T-1234" "$(head -n -1 <<<"$r" | jq -r '"\(.historial.registrado_por)|\(.historial.registrado_colegiado)"')"
esperar "el medicamento guarda su lote" LT-77 "$(head -n -1 <<<"$r" | jq -r '.historial.medicamentos[0].lote')"
T_F=$(login "$(post /api/auth/registro "$(jq -nc --arg e "faltas$SUF@correo.gt" '{nombre:"Faltas Prueba", email:$e, password:"Segura123"}')" >/dev/null; echo "faltas$SUF@correo.gt")" Segura123)
PF=$(mascota "$T_F" "Faltas $SUF")
for h in 8 9 10; do cita_bd "$PF" peluqueria "$(gt -d "-$h day" '+%F') 10:00:00" "$(gt -d "-$((h+2)) day" '+%F %T')" "faltas$SUF@correo.gt" >/dev/null; done
sqlc "UPDATE citas SET estado='no_asistio', cierre_automatico=1 WHERE mascota_id='$PF'"
DIA_F=$(gt -d "+$(( 3 + 10#$SUF % 15 )) day" +%F); [[ $(gt -d "$DIA_F" +%u) == 7 ]] && DIA_F=$(gt -d "$DIA_F +1 day" +%F)
HORA_F=$(disp "$DIA_F" veterinaria | jq -r '.turnos[0].hora')
r=$(reservar "$T_F" "$PF" "$HORA_F" "$DIA_F")
esperar "3 citas cerradas solas no bloquean al cliente → 201" 201 "$(tail -1 <<<"$r")"
CITA_F=$(head -n -1 <<<"$r" | jq -r .cita.id)
revisar=$(auth_json GET "$ADMIN" /api/citas/admin/resumen)
esperar "aparecen por revisar en el panel" 3 "$(jq --arg m "$PF" '[.por_revisar[] | select(.mascota.id==$m)] | length' <<<"$revisar")"
esperar "y todavía no cuentan como falta" 0 "$(jq --arg m "$PF" '[.faltas[] | select(.mascota.id==$m)] | length' <<<"$revisar")"
cerradas=$(sqlc "SELECT id FROM citas WHERE mascota_id='$PF' AND estado='no_asistio'")
PRIMERA=$(head -1 <<<"$cerradas")
esperar "un cliente no confirma faltas → 403" 403 "$(codigo -X POST -H "Authorization: Bearer $T2" "$BASE/api/citas/admin/$PRIMERA/confirmar-falta")"
for c in $cerradas; do codigo -X POST -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/$c/confirmar-falta" >/dev/null; done
esperar "confirmar otra vez la misma → 409" 409 "$(codigo -X POST -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/$PRIMERA/confirmar-falta")"
HORA_F2=$(disp "$DIA_F" veterinaria | jq -r '.turnos[1].hora')
PF2=$(mascota "$T_F" "Faltas Dos $SUF")
r=$(reservar "$T_F" "$PF2" "$HORA_F2" "$DIA_F")
esperar "confirmadas las 3 faltas, ya no reserva en línea → 409" "409|faltas" "$(tail -1 <<<"$r")|$(head -n -1 <<<"$r" | jq -r .motivo)"
fallecer() { "${C[@]}" -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3" "$BASE/api/citas/admin/mascotas/$2/fallecimiento"; }
esperar "un cliente no registra un fallecimiento → 403" 403 "$(fallecer "$T2" "$PF" '{}')"
esperar "con citas próximas se pide cancelarlas → 409" 409 "$(fallecer "$ADMIN" "$PF" '{}')"
estado "$CITA_F" "$ADMIN" cancelada >/dev/null
esperar "sin citas próximas → 200" 200 "$(fallecer "$ADMIN" "$PF" '{}')"
esperar "ya no se le puede agendar → 422" 422 "$(agendar "$PF" veterinaria "$DIA_F" "$HORA_F2" | tail -1)"
esperar "su ficha se conserva" 200 "$(codigo -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/mascotas/$PF/historial")"
HIST_C=$(cat /proc/sys/kernel/random/uuid)
sqlc "INSERT INTO historial_clinico (id, mascota_id, fecha, diagnostico, proximo_control, registrado_por) VALUES ('$HIST_C', '$PC', NOW(), 'Control indicado', '$(gt -d '+5 day' +%F)', 1)"
sqlc "UPDATE citas SET estado='cancelada' WHERE mascota_id='$PC' AND servicio='veterinaria'"
cita_bd "$PC" peluqueria "$(gt -d '-40 day' '+%F') 10:00:00" "$(gt '+%F %T')" "$CLIENTE2" >/dev/null
docker compose exec -T citas-recordatorios php /var/www/app/bin/recordatorios.php >/dev/null
esperar "el próximo control se avisa una vez, 7 días antes" 1 "$(sqlc "SELECT control_aviso_at IS NOT NULL FROM historial_clinico WHERE id='$HIST_C'")"
esperar "RECORDATORIO_ENVIADO del control" "control" "$(eventos RECORDATORIO_ENVIADO | jq -r --arg h "$HIST_C" '.[] | select(.dato_nuevo.historial_id==$h) | .dato_nuevo.tipo')"

caso "CP-56 Cobros y recibos (A01, A04, A09, R de STRIDE)"
respiro
cobrar() { "${C[@]}" -w '\n%{http_code}' -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2" "$BASE/api/citas/admin/cobros"; }
CUENTA=$(jq -nc --arg c "$CONSULTA2" '{cita_id:$c, lineas:[{concepto:"Consulta veterinaria", cantidad:1, precio_unitario:250, subtotal:1}, {concepto:"Vacuna de refuerzo", cantidad:2, precio_unitario:75.5}]}')
esperar "sin token → 401" 401 "$(codigo -X POST -H 'Content-Type: application/json' -d "$CUENTA" "$BASE/api/citas/admin/cobros")"
esperar "un cliente no cobra → 403" 403 "$(cobrar "$T2" "$CUENTA" | tail -1)"
esperar "sin conceptos → 422" 422 "$(cobrar "$ADMIN" "$(jq -nc --arg c "$CONSULTA2" '{cita_id:$c, lineas:[]}')" | tail -1)"
esperar "precio negativo → 422" 422 "$(cobrar "$ADMIN" "$(jq -nc --arg c "$CONSULTA2" '{cita_id:$c, lineas:[{concepto:"Consulta", cantidad:1, precio_unitario:-5}]}')" | tail -1)"
esperar "total en cero → 422" 422 "$(cobrar "$ADMIN" "$(jq -nc --arg c "$CONSULTA2" '{cita_id:$c, lineas:[{concepto:"Consulta", cantidad:1, precio_unitario:0}]}')" | tail -1)"
esperar "XSS en el concepto → 400" 400 "$(cobrar "$ADMIN" "$(jq -nc --arg c "$CONSULTA2" '{cita_id:$c, lineas:[{concepto:"<script>alert(1)</script>", cantidad:1, precio_unitario:5}]}')" | tail -1)"
esperar "una cita inexistente → 404" 404 "$(cobrar "$ADMIN" "$(jq -nc --arg c "$(cat /proc/sys/kernel/random/uuid)" '{cita_id:$c, lineas:[{concepto:"Consulta", cantidad:1, precio_unitario:5}]}')" | tail -1)"
r=$(cobrar "$ADMIN" "$CUENTA"); COBRO=$(head -n -1 <<<"$r" | jq -r .cobro.id)
esperar "el total lo calcula el servidor, no el navegador" "201|401|pendiente" "$(tail -1 <<<"$r")|$(head -n -1 <<<"$r" | jq -r '"\(.cobro.total)|\(.cobro.estado)"')"
esperar "una cita no tiene dos cobros vigentes → 409" 409 "$(cobrar "$ADMIN" "$CUENTA" | tail -1)"
pagar() { "${C[@]}" -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3" "$BASE/api/citas/admin/cobros/$2/pagar"; }
anular() { "${C[@]}" -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3" "$BASE/api/citas/admin/cobros/$2/anular"; }
esperar "método de pago no válido → 422" 422 "$(pagar "$ADMIN" "$COBRO" '{"metodo":"bitcoin"}')"
esperar "un cliente no marca como pagado → 403" 403 "$(pagar "$T2" "$COBRO" '{"metodo":"efectivo"}')"
esperar "pagar en efectivo → 200" 200 "$(pagar "$ADMIN" "$COBRO" '{"metodo":"efectivo"}')"
esperar "pagarlo dos veces → 409" 409 "$(pagar "$ADMIN" "$COBRO" '{"metodo":"efectivo"}')"
HOY=$(gt +%F)
caja=$(auth_json GET "$ADMIN" "/api/citas/admin/cobros?desde=$HOY&hasta=$HOY")
esperar "la caja del día suma lo recibido por método" true "$(jq '.por_metodo.efectivo >= 401' <<<"$caja")"
esperar "un cliente no ve la caja → 403" 403 "$(codigo -H "Authorization: Bearer $T2" "$BASE/api/citas/admin/cobros")"
esperar "el cliente ve su recibo" true "$(auth_json GET "$T2" /api/citas/cobros | jq --arg c "$COBRO" '[.cobros[].id] | index($c) != null')"
esperar "otro cliente no lo ve" false "$(auth_json GET "$T3" /api/citas/cobros | jq --arg c "$COBRO" '[.cobros[].id] | index($c) != null')"
reg=$(evento_ultimo COBRO_PAGADO)
esperar "COBRO_PAGADO guarda total, método y quién" "401|efectivo|admin@huellitas.gt" "$(jq -r '"\(.dato_nuevo.total)|\(.dato_nuevo.metodo)|\(.usuario_email)"' <<<"$reg")"
esperar "los conceptos no van a la bitácora" false "$(evento_ultimo COBRO_REGISTRADO | jq '[.. | strings] | any(test("Vacuna de refuerzo"))')"
auth_json PATCH "$ADMIN" "/api/auth/admin/usuarios/$ROL_ID/rol" '{"rol":"recepcion"}' >/dev/null
T_REC=$(login "$ROLU" Nueva12345)
esperar "recepción ve la caja" 200 "$(codigo -H "Authorization: Bearer $T_REC" "$BASE/api/citas/admin/cobros")"
esperar "recepción no anula un cobro ya pagado → 403" 403 "$(anular "$T_REC" "$COBRO" '{"motivo":"Error de digitación"}')"
esperar "recepción no administra sedes → 403" 403 "$(codigo -H "Authorization: Bearer $T_REC" "$BASE/api/citas/admin/sedes")"
esperar "recepción no escribe fichas → 403" 403 "$(historial "$CONSULTA2" "$T_REC" "$FICHA2" | tail -1)"
esperar "anular sin motivo → 422" 422 "$(anular "$ADMIN" "$COBRO" '{}')"
esperar "el administrador anula con motivo → 200" 200 "$(anular "$ADMIN" "$COBRO" '{"motivo":"Error de digitación"}')"
esperar "COBRO_ANULADO guarda el motivo" "Error de digitación|pagado" "$(evento_ultimo COBRO_ANULADO | jq -r '"\(.dato_nuevo.motivo)|\(.dato_anterior.estado)"')"
esperar "anular dos veces → 409" 409 "$(anular "$ADMIN" "$COBRO" '{"motivo":"Otra vez"}')"
esperar "ya anulado, la cita admite otro cobro → 201" 201 "$(cobrar "$T_REC" "$CUENTA" | tail -1)"
auth_json PATCH "$ADMIN" "/api/auth/admin/usuarios/$ROL_ID/rol" '{"rol":"tienda"}' >/dev/null
T_TI=$(login "$ROLU" Nueva12345)
esperar "tienda no ve la caja de la clínica → 403" 403 "$(codigo -H "Authorization: Bearer $T_TI" "$BASE/api/citas/admin/cobros")"
PAGADO=$(pedido_pagado)
SIN_PAGO=$(nuevo_pedido | cut -d' ' -f1)
comprobar() { "${C[@]}" -w '\n%{http_code}' -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3" "$BASE/api/pedidos/admin/$2/comprobante/verificar"; }
esperar "un cliente no comprueba comprobantes → 403" 403 "$(comprobar "$T2" "$PAGADO" '{"codigo":"AAAA-AAAA-AAAA-AAAA"}' | tail -1)"
esperar "código con formato inválido → 422" 422 "$(comprobar "$T_TI" "$PAGADO" '{"codigo":"123"}' | tail -1)"
esperar "un pedido sin pago → 409" 409 "$(comprobar "$T_TI" "$SIN_PAGO" '{"codigo":"AAAA-AAAA-AAAA-AAAA"}' | tail -1)"
esperar "un código falso → no es válido" false "$(comprobar "$T_TI" "$PAGADO" '{"codigo":"AAAA-AAAA-AAAA-AAAA"}' | head -n -1 | jq .valido)"
REF_P=$(docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb-master mariadb -N -uroot pagos_db -e "SELECT payment_intent_id FROM pagos WHERE id_pedido='$PAGADO' AND estado='confirmado' LIMIT 1")
TOT_P=$(docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb-master mariadb -N -uroot pedidos_db -e "SELECT total FROM pedidos WHERE id='$PAGADO'")
COD_P=$(printf '%s|%s|%s' "$PAGADO" "$TOT_P" "$REF_P" | openssl dgst -sha256 -hmac "$COMPROBANTE_SECRET" | awk '{print toupper(substr($2,1,16))}' | sed 's/.\{4\}/&-/g; s/-$//')
esperar "el código real del comprobante → válido" true "$(comprobar "$T_TI" "$PAGADO" "{\"codigo\":\"$COD_P\"}" | head -n -1 | jq .valido)"
reenvio=$(codigo -X POST -H "Authorization: Bearer $T_TI" "$BASE/api/pedidos/admin/$PAGADO/comprobante/reenviar")
esperar "reenviar el comprobante responde (sale el correo o avisa que no salió)" true "$([[ $reenvio == 200 || $reenvio == 502 ]] && echo true || echo false)"
esperar "reenviar uno sin pago → 409" 409 "$(codigo -X POST -H "Authorization: Bearer $T_TI" "$BASE/api/pedidos/admin/$SIN_PAGO/comprobante/reenviar")"
auth_json PATCH "$ADMIN" "/api/auth/admin/usuarios/$ROL_ID/rol" '{"rol":"cliente"}' >/dev/null

caso "CP-57 Cobro ligado a una mascota y reportes en PDF (A01, A09, A.5.34)"
respiro
esperar "un cobro sin cita ni mascota → 422" 422 "$(cobrar "$ADMIN" '{"lineas":[{"concepto":"Consulta","cantidad":1,"precio_unitario":100}]}' | tail -1)"
esperar "solo con un nombre escrito → 422" 422 "$(cobrar "$ADMIN" '{"cliente_nombre":"Alguien","lineas":[{"concepto":"Consulta","cantidad":1,"precio_unitario":100}]}' | tail -1)"
esperar "una mascota inexistente → 404" 404 "$(cobrar "$ADMIN" "$(jq -nc --arg m "$(cat /proc/sys/kernel/random/uuid)" '{mascota_id:$m, lineas:[{concepto:"Consulta",cantidad:1,precio_unitario:100}]}')" | tail -1)"
r=$(cobrar "$ADMIN" "$(jq -nc --arg m "$PB" '{mascota_id:$m, pago:{metodo:"efectivo"}, lineas:[{concepto:"Baño medicado",cantidad:1,precio_unitario:95}]}')"); COBRO_M=$(head -n -1 <<<"$r" | jq -r .cobro.id)
DUENO=$(sqlc "SELECT id_cliente FROM mascotas WHERE id='$PB'")
esperar "el cobro queda con su mascota y su dueño" "201|$PB|$DUENO" "$(tail -1 <<<"$r")|$(head -n -1 <<<"$r" | jq -r '"\(.cobro.mascota_id)|\(.cobro.cliente.id)"')"
esperar "aparece en los cobros de la mascota" true "$(auth_json GET "$ADMIN" "/api/citas/admin/cobros/de?mascota=$PB" | jq --arg c "$COBRO_M" '[.cobros[].id] | index($c) != null')"
esperar "y en los de su dueño" true "$(auth_json GET "$ADMIN" "/api/citas/admin/cobros/de?cliente=$DUENO" | jq --arg c "$COBRO_M" '[.cobros[].id] | index($c) != null')"
esperar "no en los de otra mascota" false "$(auth_json GET "$ADMIN" "/api/citas/admin/cobros/de?mascota=$PA" | jq --arg c "$COBRO_M" '[.cobros[].id] | index($c) != null')"
esperar "sin mascota ni cliente → 422" 422 "$(codigo -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/cobros/de")"
esperar "un cliente no consulta esa lista → 403" 403 "$(codigo -H "Authorization: Bearer $T2" "$BASE/api/citas/admin/cobros/de?mascota=$PB")"
HOY=$(gt +%F); RANGO="desde=$HOY&hasta=$HOY"
caja_r=$(auth_json GET "$ADMIN" "/api/citas/admin/reportes/caja?$RANGO")
esperar "el reporte de caja suma lo cobrado hoy" true "$(jq '.total >= 95 and (.cobros | length > 0)' <<<"$caja_r")"
esperar "y lista la mascota de cada cobro" true "$(jq --arg m "Limite B $SUF" '[.cobros[].mascota] | index($m) != null' <<<"$caja_r")"
esperar "REPORTE_GENERADO con reporte, periodo y cantidad, sin los datos" "caja|$HOY|pdf|false" "$(evento_ultimo REPORTE_GENERADO | jq -r '"\(.dato_nuevo.reporte)|\(.dato_nuevo.desde)|\(.dato_nuevo.formato)|\(tostring | test("Baño medicado"))"')"
citas_r=$(auth_json GET "$ADMIN" "/api/citas/admin/reportes/citas?desde=$DIA_L&hasta=$DIA_L")
esperar "el reporte de citas trae las del periodo" true "$(jq '.citas | length > 0' <<<"$citas_r")"
esperar "y no trae notas ni teléfono" false "$(jq '.citas[0] | has("notas") or has("telefono") or has("diagnostico")' <<<"$citas_r")"
ventas_r=$(auth_json GET "$ADMIN" "/api/pedidos/admin/reportes/ventas?desde=$(gt -d '-2 day' +%F)&hasta=$HOY")
esperar "el reporte de ventas no trae correo, teléfono ni dirección" false "$(jq '[.pedidos[]? | has("email") or has("telefono") or has("direccion")] | any' <<<"$ventas_r")"
esperar "y registra su generación" ventas "$(evento_ultimo REPORTE_GENERADO | jq -r .dato_nuevo.reporte)"
for ruta in "citas/admin/reportes/caja?$RANGO" "citas/admin/reportes/citas?$RANGO" "pedidos/admin/reportes/ventas?$RANGO"; do
    esperar "sin token, /api/${ruta%%\?*} → 401" 401 "$(codigo "$BASE/api/$ruta")"
    esperar "un cliente, /api/${ruta%%\?*} → 403" 403 "$(codigo -H "Authorization: Bearer $T2" "$BASE/api/$ruta")"
done
esperar "tienda no saca el reporte de caja → 403" 403 "$(codigo -H "Authorization: Bearer $T_TI" "$BASE/api/citas/admin/reportes/caja?$RANGO")"
esperar "tienda sí saca el de ventas" 200 "$(codigo -H "Authorization: Bearer $T_TI" "$BASE/api/pedidos/admin/reportes/ventas?$RANGO")"
esperar "recepción no saca el de ventas → 403" 403 "$(codigo -H "Authorization: Bearer $T_REC" "$BASE/api/pedidos/admin/reportes/ventas?$RANGO")"
esperar "recepción sí saca el de citas" 200 "$(codigo -H "Authorization: Bearer $T_REC" "$BASE/api/citas/admin/reportes/citas?$RANGO")"
esperar "recepción no saca el de clientes → 403" 403 "$(codigo -H "Authorization: Bearer $T_REC" "$BASE/api/auth/admin/clientes/exportar")"
esperar "fecha no válida → 422" 422 "$(codigo -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/reportes/caja?desde=ayer&hasta=$HOY")"
esperar "periodo invertido → 422" 422 "$(codigo -H "Authorization: Bearer $ADMIN" "$BASE/api/citas/admin/reportes/caja?desde=$HOY&hasta=2020-01-01")"
esperar "periodo de más de un año → 422" 422 "$(codigo -H "Authorization: Bearer $ADMIN" "$BASE/api/pedidos/admin/reportes/ventas?desde=2020-01-01&hasta=$HOY")"

caso "CP-16 Rate limiting en /login (gateway, se corre al final)"
codigos=$(for i in $(seq 1 15); do codigo -X POST -H 'Content-Type: application/json' -d '{"email":"flood@correo.gt","password":"x"}' "$BASE/api/auth/login"; echo; done)
grep -q 429 <<<"$codigos" && ok "ráfaga de logins → 429" || mal "ninguna respuesta 429 en la ráfaga"

echo
echo "Resultado: $pasaron pasaron, $fallaron fallaron"
[[ $fallaron -eq 0 ]]
