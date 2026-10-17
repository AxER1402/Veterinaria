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
ENTREGA='"nombre":"Compradora Prueba","telefono":"5555-1234","metodo_entrega":"domicilio","direccion":"4a avenida 10-20, zona 1","ciudad":"Guatemala"'

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
esperar "PRECIO_MODIFICADO guarda antes y después" "$precio_real→$nuevo" "$(evento_ultimo PRECIO_MODIFICADO | jq -r '"\(.dato_anterior.precio)→\(.dato_nuevo.precio)"')"
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
esperar "SQLi en la dirección → 400" 400 "$(codigo -X POST -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' -d "{\"items\":[{\"variante_id\":$var_id,\"cantidad\":1}],\"nombre\":\"Ana\",\"telefono\":\"5555-1234\",\"metodo_entrega\":\"domicilio\",\"direccion\":\"x'; DROP TABLE pedidos; --\",\"ciudad\":\"Guatemala\"}" "$BASE/api/pedidos")"
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
evento_stripe() { # evento_stripe <tipo> <pi> <centavos> <pedido>
    jq -cn --arg t "$1" --arg pi "$2" --argjson c "$3" --arg p "$4" --arg e "evt_$RANDOM$RANDOM" \
      '{id:$e,type:$t,data:{object:{id:$pi,amount_received:$c,currency:"usd",status:"succeeded",metadata:{pedido_id:$p},last_payment_error:{code:"card_declined"}}}}'
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
EV=$(evento_stripe payment_intent.succeeded "$PI_F" 1 "$PED_F"); TS=$(date +%s)
webhook "$EV" "t=$TS,v1=$(firmar "$TS" "$EV")" >/dev/null
esperar "cobro de 1 centavo no confirma el pedido" pendiente_pago "$(estado_pedido "$PED_F")"
esperar "queda PAGO_FALLIDO como FRAUDE" "$PED_F|FRAUDE" "$(evento_ultimo PAGO_FALLIDO | jq -r '"\(.pedido_id)|\(.resultado)"')"
EV=$(evento_stripe payment_intent.payment_failed "$PI_F" 0 "$PED_F"); TS=$(date +%s)
webhook "$EV" "t=$TS,v1=$(firmar "$TS" "$EV")" >/dev/null
esperar "tarjeta rechazada → PAGO_FALLIDO con el código" "FALLO|card_declined" "$(evento_ultimo PAGO_FALLIDO | jq -r '"\(.resultado)|\(.dato_nuevo.motivo)"')"

caso "CP-28 Sin datos de tarjeta en la base (PCI-DSS, SEC-3)"
cols=$(docker compose exec -T mariadb-master mariadb -N -uroot -p"$DB_ROOT_PASSWORD" -e "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA IN ('auth_db','catalogo_db','pedidos_db','pagos_db','citas_db') AND COLUMN_NAME REGEXP 'card|tarjeta|cvv|cvc|pan$|expir|vencimiento|track'")
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

caso "CP-30 Secretos fuera del repositorio (A05, penalización -4)"
fugas=$(git grep -nE 'sk_(test|live)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|EMAILJS_PRIVATE_KEY=[^ ]+|PAYPAL_CLIENT_SECRET=[^ ]+|CLOUDINARY_API_SECRET=[^ ]+' -- . ':!tests' | wc -l)
esperar "ninguna API key en archivos versionados" 0 "$fugas"
esperar "solo pagos y notificaciones tienen salida a Internet" "000" "$(docker compose exec -T catalogo-service curl -s -o /dev/null -w '%{http_code}' --max-time 3 https://api.stripe.com || true)"

# ======================= Semana 4: panel de administración y evidencia =======================
caso "CP-31 Exportación de clientes auditada (A09, A.5.34)"
esperar "cliente no puede exportar → 403" 403 "$(codigo -H "Authorization: Bearer $T2" "$BASE/api/auth/admin/clientes/exportar")"
csv=$("${C[@]}" -H "Authorization: Bearer $ADMIN" "$BASE/api/auth/admin/clientes/exportar")
esperar "CSV solo con columnas mínimas" "id,nombre,email,activo,creado" "$(head -1 <<<"$csv" | sed 's/^\xEF\xBB\xBF//')"
grep -q 'password\|\$2y\$' <<<"$csv" && mal "el CSV contiene hashes" || ok "el CSV no contiene contraseñas ni hashes"
esperar "EXPORTACION_CLIENTES registra cuántos registros salieron" "admin@huellitas.gt|$(($(wc -l <<<"$csv") - 1))" "$(evento_ultimo EXPORTACION_CLIENTES | jq -r '"\(.usuario_email)|\(.dato_nuevo.registros)"')"
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
esperar "queda cancelado con el motivo en el historial" "cancelado|Vencido: 24 h sin pago" "$(auth_json GET "$T2" "/api/pedidos/$PED_V" | jq -r '.pedido | "\(.estado)|\(.historial[-1].comentario)"')"
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
        -d "$(jq -nc --arg m "$2" --arg h "$3" --arg d "${4:-$DIA}" '{mascota_id:$m, servicio:"veterinaria", fecha:$d, hora:$h, nombre:"Compradora Prueba", telefono:"5555-1234"}')" "$BASE/api/citas"
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
esperar "el admin ve la cita con el teléfono del cliente" "5555-1234" "$(jq -r --arg c "$CITA" '.citas[] | select(.id==$c) | .cliente.telefono' <<<"$agenda")"
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
               $(( 10 + 10#$SUF % 240 )), 'confirmada', 'Compradora Prueba', '$CLIENTE2', '5555-1234' FROM mascotas WHERE id='$1'" && echo "$id"
}
historial() { "${C[@]}" -w '\n%{http_code}' -X POST -H "Authorization: Bearer $2" -H 'Content-Type: application/json' -d "$3" "$BASE/api/citas/admin/$1/historial"; }
CONSULTA=$(cita_pasada "$M1" veterinaria 10:00)
PELU=$(cita_pasada "$M1" peluqueria 11:00)
PROX=$(gt -d "+1 year" +%F)
FICHA=$(jq -nc --arg p "$PROX" '{peso_kg:15.2, diagnostico:"Otitis leve en oído derecho", tratamiento:"Gotas óticas cada 12 h por 7 días", vacunas:[{nombre:"Rabia", lote:"RB-2291", proxima_dosis:$p}, {nombre:"Séxtuple", proxima_dosis:$p}]}')
esperar "un cliente no puede registrar historial → 403" 403 "$(historial "$CONSULTA" "$T2" "$FICHA" | tail -1)"
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

caso "CP-41 Un cliente no puede acaparar la agenda (D de STRIDE)"
respiro
ultimo=""
for h in $(disp "$DIA" | jq -r '.turnos[].hora' | head -8); do
    ultimo=$(reservar "$T2" "$M1" "$h")
    [[ $(tail -1 <<<"$ultimo") == 409 ]] && break
done
esperar "la 6.ª cita próxima → 409" "409|true" "$(tail -1 <<<"$ultimo")|$(head -n -1 <<<"$ultimo" | jq -r '.error | test("citas próximas")')"
esperar "el cliente tiene 5 citas próximas" 5 "$("${C[@]}" -H "Authorization: Bearer $T2" "$BASE/api/citas" | jq '[.citas[] | select(.estado=="pendiente")] | length')"

caso "CP-16 Rate limiting en /login (gateway, se corre al final)"
codigos=$(for i in $(seq 1 15); do codigo -X POST -H 'Content-Type: application/json' -d '{"email":"flood@correo.gt","password":"x"}' "$BASE/api/auth/login"; echo; done)
grep -q 429 <<<"$codigos" && ok "ráfaga de logins → 429" || mal "ninguna respuesta 429 en la ráfaga"

echo
echo "Resultado: $pasaron pasaron, $fallaron fallaron"
[[ $fallaron -eq 0 ]]
