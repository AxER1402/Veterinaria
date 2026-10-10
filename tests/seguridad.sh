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

caso "CP-16 Rate limiting en /login (gateway, se corre al final)"
codigos=$(for i in $(seq 1 15); do codigo -X POST -H 'Content-Type: application/json' -d '{"email":"flood@correo.gt","password":"x"}' "$BASE/api/auth/login"; echo; done)
grep -q 429 <<<"$codigos" && ok "ráfaga de logins → 429" || mal "ninguna respuesta 429 en la ráfaga"

echo
echo "Resultado: $pasaron pasaron, $fallaron fallaron"
[[ $fallaron -eq 0 ]]
