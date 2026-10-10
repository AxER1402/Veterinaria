<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Auditoria;
use Huellitas\Cache;
use Huellitas\Db;
use Huellitas\Env;
use Huellitas\Guard;
use Huellitas\Http;
use Huellitas\Jwt;
use Huellitas\Validar;

final class AuthController
{
    private const BCRYPT = ['cost' => 12];        // A02: bcrypt con costo ≥ 12
    private const MAX_INTENTOS = 5;               // A07: 5 intentos fallidos…
    private const BLOQUEO_SEG = 15 * 60;          // …bloquean la cuenta 15 min
    private const MAX_LOGIN_POR_IP = 50;          // por IP en 15 min (holgado: varios clientes pueden compartir IP)
    private const IPS_SOSPECHOSAS = 3;
    private const DESAFIO_MFA_SEG = 300;          // el segundo paso del login vence en 5 min            // S (STRIDE): misma cuenta atacada desde ≥3 IPs

    // Hash fijo para gastar el mismo tiempo cuando el correo no existe (evita enumerar usuarios).
    private const HASH_SENUELO = '$2y$12$RXrg6QrXzZtqAI8PEr/DF.dE62D.UFMHnAiqbjjKjdZCGHwxoG47a';

    public function registro(): array
    {
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $nombre = Validar::texto($datos, 'nombre', 2, 100);
        $email = Validar::email($datos);
        $password = Validar::password($datos);

        $db = Db::escritura();
        $existe = $db->prepare('SELECT 1 FROM usuarios WHERE email = ?');
        $existe->execute([$email]);
        if ($existe->fetchColumn()) {
            throw new ApiError(409, 'Ya existe una cuenta con ese correo');
        }

        // E (STRIDE): el rol nunca viene del cliente; todo registro público es "cliente".
        $db->prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)')
            ->execute([$nombre, $email, password_hash($password, PASSWORD_BCRYPT, self::BCRYPT), 'cliente']);
        $id = (int) $db->lastInsertId();

        Auditoria::registrar('REGISTRO_CLIENTE', 'EXITO', [
            'usuario_id' => $id, 'usuario_email' => $email, 'rol' => 'cliente',
            'dato_nuevo' => ['nombre' => $nombre, 'email' => $email],
        ]);

        return [201, ['usuario' => ['id' => $id, 'nombre' => $nombre, 'email' => $email, 'rol' => 'cliente']]];
    }

    public function login(): array
    {
        $datos = Http::body();
        $email = Validar::email($datos);
        $password = is_string($datos['password'] ?? null) ? $datos['password'] : '';
        $ip = Http::ip();

        if (Cache::golpe("login:ip:$ip", self::BLOQUEO_SEG) > self::MAX_LOGIN_POR_IP) {
            $this->fallo($email, null, 'demasiados intentos desde la IP');
            throw new ApiError(429, 'Demasiados intentos. Intenta de nuevo en 15 minutos.');
        }

        $db = Db::escritura();
        $consulta = $db->prepare('SELECT id, nombre, email, password_hash, rol, activo, intentos_fallidos, bloqueado_hasta, mfa_activo
                                    FROM usuarios WHERE email = ?');
        $consulta->execute([$email]);
        $usuario = $consulta->fetch() ?: null;

        if ($usuario && $usuario['bloqueado_hasta'] !== null && strtotime($usuario['bloqueado_hasta']) > time()) {
            $this->fallo($email, $usuario, 'cuenta bloqueada');
            throw new ApiError(423, 'Cuenta bloqueada temporalmente por intentos fallidos. Intenta más tarde.');
        }

        $valida = password_verify($password, $usuario['password_hash'] ?? self::HASH_SENUELO);
        if (!$usuario || !$valida || !$usuario['activo']) {
            if ($usuario) {
                $this->intentoFallido($usuario, 'contraseña incorrecta');
            } else {
                $this->fallo($email, null, 'correo no registrado');
            }
            throw new ApiError(401, 'Credenciales inválidas');
        }

        if (password_needs_rehash($usuario['password_hash'], PASSWORD_BCRYPT, self::BCRYPT)) {
            $db->prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?')
                ->execute([password_hash($password, PASSWORD_BCRYPT, self::BCRYPT), $usuario['id']]);
        }

        // Con MFA activo, la contraseña sola no basta: se entrega un desafío de 5 min, de un solo uso,
        // que no sirve como token de acceso (typ "mfa"; Guard solo acepta typ "user").
        if ($usuario['mfa_activo']) {
            $ahora = time();
            $desafio = Jwt::firmar([
                'iss' => 'huellitas-auth', 'typ' => 'mfa', 'sub' => (int) $usuario['id'], 'jti' => Jwt::uuid(),
                'iat' => $ahora, 'exp' => $ahora + self::DESAFIO_MFA_SEG,
            ], Env::required('JWT_SECRET'));
            return [200, ['mfa_requerido' => true, 'desafio' => $desafio, 'expira_en' => self::DESAFIO_MFA_SEG]];
        }

        return [200, $this->sesion($usuario, false)];
    }

    /** Segundo paso del login. Entrada: {desafio, codigo} */
    public function verificarMfa(): array
    {
        $datos = Http::body();
        $desafio = is_string($datos['desafio'] ?? null) ? $datos['desafio'] : throw new ApiError(422, 'Falta el desafío');
        $codigo = is_string($datos['codigo'] ?? null) ? trim($datos['codigo']) : '';
        $claims = Jwt::verificar($desafio, Env::required('JWT_SECRET'), 'mfa');

        $usuario = $this->usuarioPorId((int) $claims['sub']);
        if ($usuario['bloqueado_hasta'] !== null && strtotime($usuario['bloqueado_hasta']) > time()) {
            $this->fallo($usuario['email'], $usuario, 'cuenta bloqueada (MFA)');
            throw new ApiError(423, 'Cuenta bloqueada temporalmente por intentos fallidos. Intenta más tarde.');
        }
        if (!$usuario['mfa_activo'] || !$usuario['activo']) {
            throw new ApiError(401, 'Desafío inválido');
        }

        $paso = Totp::verificar(Totp::descifrar($usuario['mfa_secreto']), $codigo,
            $usuario['mfa_ultimo_paso'] === null ? null : (int) $usuario['mfa_ultimo_paso']);
        if ($paso === null) {
            // Cuenta como intento fallido: 5 códigos malos también bloquean la cuenta 15 min.
            $this->intentoFallido($usuario, 'código MFA incorrecto');
            throw new ApiError(401, 'Código de verificación incorrecto');
        }
        // El desafío es de un solo uso.
        if (!Cache::redis()->set("mfa:desafio:{$claims['jti']}", '1', ['nx', 'ex' => self::DESAFIO_MFA_SEG + 30])) {
            throw new ApiError(401, 'Desafío ya utilizado');
        }
        Db::escritura()->prepare('UPDATE usuarios SET mfa_ultimo_paso = ? WHERE id = ?')->execute([$paso, $usuario['id']]);
        return [200, $this->sesion($usuario, true)];
    }

    /** Paso 1 de la activación: genera el secreto (todavía inactivo) y la URI para el QR. */
    public function configurarMfa(): array
    {
        $claims = Guard::usuario();
        $usuario = $this->usuarioPorId((int) $claims['sub']);
        if ($usuario['mfa_activo']) {
            throw new ApiError(409, 'La verificación en dos pasos ya está activa');
        }
        $secreto = Totp::nuevoSecreto();
        Db::escritura()->prepare('UPDATE usuarios SET mfa_secreto = ?, mfa_ultimo_paso = NULL WHERE id = ?')
            ->execute([Totp::cifrar($secreto), $usuario['id']]);
        return [200, ['secreto' => $secreto, 'uri' => Totp::uri($secreto, $usuario['email'])]];
    }

    /** Paso 2: el usuario demuestra que su app genera códigos correctos. Entrada: {codigo} */
    public function activarMfa(): array
    {
        $claims = Guard::usuario();
        $usuario = $this->usuarioPorId((int) $claims['sub']);
        if ($usuario['mfa_activo'] || $usuario['mfa_secreto'] === null) {
            throw new ApiError(409, $usuario['mfa_activo'] ? 'La verificación en dos pasos ya está activa' : 'Primero genera el código QR');
        }
        $paso = Totp::verificar(Totp::descifrar($usuario['mfa_secreto']), trim((string) (Http::body()['codigo'] ?? '')), null);
        if ($paso === null) {
            throw new ApiError(422, 'El código no coincide. Revisa la hora del teléfono e intenta de nuevo.', ['campo' => 'codigo']);
        }
        Db::escritura()->prepare('UPDATE usuarios SET mfa_activo = 1, mfa_ultimo_paso = ? WHERE id = ?')->execute([$paso, $usuario['id']]);
        Auditoria::registrar('MFA_CONFIGURADO', 'EXITO', Auditoria::actor($claims) + ['dato_nuevo' => ['mfa' => 'activado']]);
        return [200, ['mfa' => true]];
    }

    /** Desactivar exige la contraseña y un código vigente. Entrada: {password, codigo} */
    public function desactivarMfa(): array
    {
        $claims = Guard::usuario();
        $usuario = $this->usuarioPorId((int) $claims['sub']);
        $datos = Http::body();
        if (!$usuario['mfa_activo']) {
            throw new ApiError(409, 'La verificación en dos pasos no está activa');
        }
        $passwordOk = password_verify(is_string($datos['password'] ?? null) ? $datos['password'] : '', $usuario['password_hash']);
        $paso = Totp::verificar(Totp::descifrar($usuario['mfa_secreto']), trim((string) ($datos['codigo'] ?? '')),
            $usuario['mfa_ultimo_paso'] === null ? null : (int) $usuario['mfa_ultimo_paso']);
        if (!$passwordOk || $paso === null) {
            Auditoria::registrar('MFA_CONFIGURADO', 'FALLO', Auditoria::actor($claims) + ['dato_nuevo' => ['mfa' => 'intento de desactivar', 'motivo' => 'contraseña o código incorrectos']]);
            throw new ApiError(401, 'Contraseña o código incorrectos');
        }
        Db::escritura()->prepare('UPDATE usuarios SET mfa_activo = 0, mfa_secreto = NULL, mfa_ultimo_paso = NULL WHERE id = ?')->execute([$usuario['id']]);
        Auditoria::registrar('MFA_CONFIGURADO', 'EXITO', Auditoria::actor($claims) + ['dato_nuevo' => ['mfa' => 'desactivado']]);
        return [200, ['mfa' => false]];
    }

    /** Emite el JWT después de un login correcto (con o sin segundo factor). */
    private function sesion(array $usuario, bool $conMfa): array
    {
        if ((int) $usuario['intentos_fallidos'] > 0 || $usuario['bloqueado_hasta'] !== null) {
            Db::escritura()->prepare('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?')->execute([$usuario['id']]);
        }
        [$token, $claims] = Jwt::tokenUsuario($usuario);
        Auditoria::registrar('LOGIN_CLIENTE_EXITOSO', 'EXITO', [
            'usuario_id' => (int) $usuario['id'], 'usuario_email' => $usuario['email'], 'rol' => $usuario['rol'],
            'dato_nuevo' => ['jti' => $claims['jti'], 'expira' => date('c', $claims['exp']), 'mfa' => $conMfa],
        ]);
        return ['token' => $token, 'expira_en' => Jwt::TTL_USUARIO, 'usuario' => $this->publico($usuario)];
    }

    /** Suma un intento fallido (contraseña o código MFA) y bloquea la cuenta al llegar a 5. */
    private function intentoFallido(array $usuario, string $motivo): void
    {
        $intentos = (int) $usuario['intentos_fallidos'] + 1;
        $bloquear = $intentos >= self::MAX_INTENTOS;
        Db::escritura()->prepare('UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?')->execute([
            $bloquear ? 0 : $intentos,
            $bloquear ? date('Y-m-d H:i:s', time() + self::BLOQUEO_SEG) : null,
            $usuario['id'],
        ]);
        $this->fallo($usuario['email'], $usuario, $bloquear ? "$motivo; cuenta bloqueada 15 min" : "$motivo ($intentos/" . self::MAX_INTENTOS . ')');
        if ($bloquear) {
            throw new ApiError(423, 'Cuenta bloqueada temporalmente por intentos fallidos. Intenta más tarde.');
        }
    }

    private function usuarioPorId(int $id): array
    {
        $consulta = Db::escritura()->prepare('SELECT id, nombre, email, password_hash, rol, activo, intentos_fallidos, bloqueado_hasta,
                                                     mfa_activo, mfa_secreto, mfa_ultimo_paso FROM usuarios WHERE id = ?');
        $consulta->execute([$id]);
        return $consulta->fetch() ?: throw new ApiError(401, 'Cuenta no disponible');
    }

    public function logout(): array
    {
        $claims = Guard::usuario();
        Cache::revocar($claims['jti'], (int) $claims['exp']);

        Auditoria::registrar('TOKEN_REVOCADO', 'EXITO', [
            'usuario_id' => (int) $claims['sub'], 'usuario_email' => $claims['email'], 'rol' => $claims['rol'],
            'dato_nuevo' => ['jti' => $claims['jti'], 'motivo' => 'logout'],
        ]);
        return [200, ['mensaje' => 'Sesión cerrada']];
    }

    public function me(): array
    {
        $claims = Guard::usuario();
        $consulta = Db::lectura()->prepare('SELECT id, nombre, email, rol, activo, mfa_activo FROM usuarios WHERE id = ?');
        $consulta->execute([$claims['sub']]);
        $usuario = $consulta->fetch();
        if (!$usuario || !$usuario['activo']) {
            throw new ApiError(401, 'Cuenta no disponible');
        }
        return [200, ['usuario' => $this->publico($usuario)]];
    }

    /** El panel de administración llama a esto al abrirse; queda registrado quién entró. */
    public function accesoAdmin(): array
    {
        $claims = Guard::usuario();
        $datos = ['usuario_id' => (int) $claims['sub'], 'usuario_email' => $claims['email'], 'rol' => $claims['rol']];
        if ($claims['rol'] !== 'admin') {
            Auditoria::registrar('ACCESO_ADMIN_PANEL', 'FALLO', $datos + ['dato_nuevo' => ['motivo' => 'rol sin permiso']]);
            throw new ApiError(403, 'No tienes permiso para esta acción');
        }
        Auditoria::registrar('ACCESO_ADMIN_PANEL', 'EXITO', $datos);
        return [200, ['acceso' => true]];
    }

    public function clientes(): array
    {
        Guard::usuario(['admin']);
        $filas = Db::lectura()->query("SELECT id, nombre, email, activo, bloqueado_hasta, created_at FROM usuarios
                                        WHERE rol = 'cliente' ORDER BY id DESC LIMIT 500")->fetchAll();
        return [200, ['clientes' => array_map(fn($u) => [
            'id' => (int) $u['id'], 'nombre' => $u['nombre'], 'email' => $u['email'], 'activo' => (bool) $u['activo'],
            'bloqueado' => $u['bloqueado_hasta'] !== null && strtotime($u['bloqueado_hasta']) > time(), 'creado' => $u['created_at'],
        ], $filas)]];
    }

    /**
     * CSV de clientes. A.5.34 (datos mínimos): sin hashes, intentos ni datos de pedidos.
     * Cada exportación queda en la bitácora con quién la hizo y cuántos registros salieron.
     */
    public function exportarClientes(): never
    {
        $claims = Guard::usuario(['admin']);
        $filas = Db::lectura()->query("SELECT id, nombre, email, activo, created_at FROM usuarios WHERE rol = 'cliente' ORDER BY id")->fetchAll();

        Auditoria::registrar('EXPORTACION_CLIENTES', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['registros' => count($filas), 'formato' => 'csv', 'columnas' => ['id', 'nombre', 'email', 'activo', 'creado']],
        ]);

        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="clientes-huellitas-' . date('Ymd-His') . '.csv"');
        header('Cache-Control: no-store');
        $salida = fopen('php://output', 'w');
        fwrite($salida, "\xEF\xBB\xBF");  // BOM para que Excel lea bien los acentos
        fputcsv($salida, ['id', 'nombre', 'email', 'activo', 'creado'], ',', '"', '');
        foreach ($filas as $f) {
            fputcsv($salida, [$f['id'], self::celdaSegura($f['nombre']), self::celdaSegura($f['email']), $f['activo'] ? 'sí' : 'no', $f['created_at']], ',', '"', '');
        }
        fclose($salida);
        exit;
    }

    /** Evita inyección de fórmulas en Excel/Sheets (=, +, -, @ al inicio de la celda). */
    private static function celdaSegura(string $valor): string
    {
        return preg_match('/^[=+\-@\t\r]/', $valor) ? "'" . $valor : $valor;
    }

    private function fallo(string $email, ?array $usuario, string $motivo): void
    {
        // Detección de credential stuffing: la misma cuenta fallando desde varias IPs.
        $clave = 'login:ips:' . hash('sha256', $email);
        $r = Cache::redis();
        $r->sAdd($clave, Http::ip());
        $r->expire($clave, self::BLOQUEO_SEG);
        $ips = (int) $r->sCard($clave);
        $sospechoso = $ips >= self::IPS_SOSPECHOSAS;

        Auditoria::registrar('LOGIN_CLIENTE_FALLIDO', $sospechoso ? 'FRAUDE' : 'FALLO', [
            'usuario_id'    => $usuario ? (int) $usuario['id'] : null,
            'usuario_email' => $email,
            'rol'           => $usuario['rol'] ?? 'anonimo',
            'dato_nuevo'    => ['motivo' => $motivo] + ($sospechoso ? ['ips_distintas_15min' => $ips] : []),
        ]);
    }

    private function publico(array $u): array
    {
        return ['id' => (int) $u['id'], 'nombre' => $u['nombre'], 'email' => $u['email'], 'rol' => $u['rol'], 'mfa' => (bool) ($u['mfa_activo'] ?? false)];
    }
}
