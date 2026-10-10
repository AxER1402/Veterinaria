<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Auditoria;
use Huellitas\Cache;
use Huellitas\Db;
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
    private const IPS_SOSPECHOSAS = 3;            // S (STRIDE): misma cuenta atacada desde ≥3 IPs

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
        $consulta = $db->prepare('SELECT id, nombre, email, password_hash, rol, activo, intentos_fallidos, bloqueado_hasta
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
                $intentos = (int) $usuario['intentos_fallidos'] + 1;
                $bloquear = $intentos >= self::MAX_INTENTOS;
                $db->prepare('UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?')->execute([
                    $bloquear ? 0 : $intentos,
                    $bloquear ? date('Y-m-d H:i:s', time() + self::BLOQUEO_SEG) : null,
                    $usuario['id'],
                ]);
                $this->fallo($email, $usuario, $bloquear ? 'contraseña incorrecta; cuenta bloqueada 15 min' : "contraseña incorrecta ($intentos/" . self::MAX_INTENTOS . ')');
                if ($bloquear) {
                    throw new ApiError(423, 'Cuenta bloqueada temporalmente por intentos fallidos. Intenta más tarde.');
                }
            } else {
                $this->fallo($email, null, 'correo no registrado');
            }
            throw new ApiError(401, 'Credenciales inválidas');
        }

        if ((int) $usuario['intentos_fallidos'] > 0 || $usuario['bloqueado_hasta'] !== null) {
            $db->prepare('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?')->execute([$usuario['id']]);
        }
        if (password_needs_rehash($usuario['password_hash'], PASSWORD_BCRYPT, self::BCRYPT)) {
            $db->prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?')
                ->execute([password_hash($password, PASSWORD_BCRYPT, self::BCRYPT), $usuario['id']]);
        }

        [$token, $claims] = Jwt::tokenUsuario($usuario);
        Auditoria::registrar('LOGIN_CLIENTE_EXITOSO', 'EXITO', [
            'usuario_id' => (int) $usuario['id'], 'usuario_email' => $usuario['email'], 'rol' => $usuario['rol'],
            'dato_nuevo' => ['jti' => $claims['jti'], 'expira' => date('c', $claims['exp'])],
        ]);

        return [200, [
            'token'     => $token,
            'expira_en' => Jwt::TTL_USUARIO,
            'usuario'   => $this->publico($usuario),
        ]];
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
        $consulta = Db::lectura()->prepare('SELECT id, nombre, email, rol, activo FROM usuarios WHERE id = ?');
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
        return ['id' => (int) $u['id'], 'nombre' => $u['nombre'], 'email' => $u['email'], 'rol' => $u['rol']];
    }
}
