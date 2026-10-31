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
use Huellitas\Interno;
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
    private const MAX_TOKEN_GOOGLE = 4096;
    private const TOLERANCIA_TOKEN_GOOGLE = 120;  // un token repetido se recuerda hasta después de vencer
    private const ORIGEN_GOOGLE = '(google)';     // en la bitácora, cuando el token no permite saber el correo

    // Hash fijo para gastar el mismo tiempo cuando el correo no existe (evita enumerar usuarios).
    // nosemgrep: detected-bcrypt-hash (señuelo sin contraseña asociada, no es un secreto)
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
        $consulta = $db->prepare('SELECT id, nombre, email, telefono, password_hash, debe_cambiar_password, rol, activo, intentos_fallidos, bloqueado_hasta, mfa_activo
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

    /** Lo que necesita el botón de Google en el navegador. Sin client_id, el botón no se muestra. */
    public function configGoogle(): array
    {
        return [200, ['client_id' => Env::get('GOOGLE_CLIENT_ID')]];
    }

    /**
     * Entra o se registra con Google. Entrada: {credential}. Solo para clientes: el personal sigue con
     * contraseña y verificación en dos pasos.
     * Una cuenta que ya existe con ese correo no se vincula sola: como el registro no comprueba el
     * correo, otra persona podría haberla creado antes y conservaría la contraseña.
     */
    public function loginGoogle(): array
    {
        $clientId = Env::get('GOOGLE_CLIENT_ID') ?? throw new ApiError(503, 'El inicio de sesión con Google no está disponible');
        $token = Http::body()['credential'] ?? null;
        if (!is_string($token) || $token === '' || strlen($token) > self::MAX_TOKEN_GOOGLE) {
            throw new ApiError(422, 'Falta el token de Google', ['campo' => 'credential']);
        }
        if (Cache::golpe('login:ip:' . Http::ip(), self::BLOQUEO_SEG) > self::MAX_LOGIN_POR_IP) {
            $this->fallo(self::ORIGEN_GOOGLE, null, 'demasiados intentos desde la IP');
            throw new ApiError(429, 'Demasiados intentos. Intenta de nuevo en 15 minutos.');
        }

        $url = Env::get('NOTIFICACIONES_URL', 'http://notificaciones-service:8085') . '/internal/notificaciones/google-certificados';
        $certificados = Interno::exigir($url, [], 'notificaciones')['certificados'] ?? [];
        $datos = Google::verificar($token, $clientId, $certificados);
        if ($datos === null) {
            $this->fallo(self::ORIGEN_GOOGLE, null, 'token de Google no válido');
            throw new ApiError(401, 'No se pudo verificar tu cuenta de Google');
        }
        // Cada token sirve una sola vez.
        $vigencia = max(self::TOLERANCIA_TOKEN_GOOGLE, $datos['exp'] - time() + self::TOLERANCIA_TOKEN_GOOGLE);
        if (!Cache::redis()->set('google:token:' . hash('sha256', $token), '1', ['nx', 'ex' => $vigencia])) {
            $this->fallo($datos['email'], null, 'token de Google repetido');
            throw new ApiError(401, 'No se pudo verificar tu cuenta de Google');
        }

        $consulta = Db::escritura()->prepare('SELECT id, nombre, email, telefono, password_hash, debe_cambiar_password, rol, activo, intentos_fallidos, bloqueado_hasta,
                                                     mfa_activo, google_sub FROM usuarios WHERE google_sub = ?');
        $consulta->execute([$datos['sub']]);
        $usuario = $consulta->fetch() ?: $this->crearUsuarioGoogle($datos);
        if (!$usuario['activo']) {
            $this->fallo($usuario['email'], $usuario, 'cuenta desactivada (Google)');
            throw new ApiError(401, 'Cuenta no disponible');
        }
        return [200, $this->sesion($usuario, false, 'google')];
    }

    private function crearUsuarioGoogle(array $datos): array
    {
        $email = Validar::email($datos);
        $existe = Db::escritura()->prepare('SELECT 1 FROM usuarios WHERE email = ?');
        $existe->execute([$email]);
        if ($existe->fetchColumn()) {
            $this->fallo($email, null, 'ya existe una cuenta con ese correo (Google)');
            throw new ApiError(409, 'Ya existe una cuenta con ese correo. Entra con tu contraseña.');
        }
        $nombre = self::nombreGoogle($datos['name'] ?? null, $email);
        // Nadie conoce esta contraseña: la cuenta entra con Google. Se guarda para no dejar el hash vacío.
        $hash = password_hash(bin2hex(random_bytes(32)), PASSWORD_BCRYPT, self::BCRYPT);
        $db = Db::escritura();
        try {
            $db->prepare('INSERT INTO usuarios (nombre, email, password_hash, rol, google_sub) VALUES (?, ?, ?, ?, ?)')
                ->execute([$nombre, $email, $hash, 'cliente', $datos['sub']]);
        } catch (\PDOException $e) {
            // Dos peticiones a la vez: gana la primera. El índice único decide.
            if ($e->getCode() === '23000') {
                throw new ApiError(409, 'Ya existe una cuenta con ese correo. Entra con tu contraseña.');
            }
            throw $e;
        }
        $id = (int) $db->lastInsertId();
        Auditoria::registrar('REGISTRO_CLIENTE', 'EXITO', [
            'usuario_id' => $id, 'usuario_email' => $email, 'rol' => 'cliente',
            'dato_nuevo' => ['nombre' => $nombre, 'email' => $email, 'origen' => 'google'],
        ]);
        return $this->usuarioPorId($id);
    }

    /** El nombre lo escribe el dueño de la cuenta de Google: se valida como el del registro. */
    private static function nombreGoogle(mixed $nombre, string $email): string
    {
        try {
            $datos = ['nombre' => $nombre];
            Validar::sinAtaques($datos);
            return Validar::texto($datos, 'nombre', 2, 100);
        } catch (ApiError) {
            return mb_substr(strstr($email, '@', true) ?: 'Cliente', 0, 100);
        }
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
        self::sinGoogle($usuario);
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
    private function sesion(array $usuario, bool $conMfa, ?string $metodo = null): array
    {
        if ((int) $usuario['intentos_fallidos'] > 0 || $usuario['bloqueado_hasta'] !== null) {
            Db::escritura()->prepare('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?')->execute([$usuario['id']]);
        }
        [$token, $claims] = Jwt::tokenUsuario($usuario);
        Auditoria::registrar('LOGIN_CLIENTE_EXITOSO', 'EXITO', [
            'usuario_id' => (int) $usuario['id'], 'usuario_email' => $usuario['email'], 'rol' => $usuario['rol'],
            'dato_nuevo' => ['jti' => $claims['jti'], 'expira' => date('c', $claims['exp']), 'mfa' => $conMfa] + ($metodo ? ['metodo' => $metodo] : []),
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
        $consulta = Db::escritura()->prepare('SELECT id, nombre, email, telefono, password_hash, debe_cambiar_password, rol, activo, intentos_fallidos, bloqueado_hasta,
                                                     mfa_activo, mfa_secreto, mfa_ultimo_paso, google_sub FROM usuarios WHERE id = ?');
        $consulta->execute([$id]);
        return $consulta->fetch() ?: throw new ApiError(401, 'Cuenta no disponible');
    }

    /** Una cuenta de Google no tiene contraseña propia: su seguridad se administra en Google. */
    private static function sinGoogle(array $usuario): void
    {
        if ($usuario['google_sub'] !== null) {
            throw new ApiError(409, 'Tu cuenta entra con Google: su seguridad se administra desde tu cuenta de Google');
        }
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
        $consulta = Db::escritura()->prepare('SELECT id, nombre, email, telefono, debe_cambiar_password, rol, activo, mfa_activo, google_sub FROM usuarios WHERE id = ?');
        $consulta->execute([$claims['sub']]);
        $usuario = $consulta->fetch();
        if (!$usuario || !$usuario['activo']) {
            throw new ApiError(401, 'Cuenta no disponible');
        }
        return [200, ['usuario' => $this->publico($usuario)]];
    }

    /** Nombre y teléfono del perfil. El teléfono se reutiliza al reservar y al comprar. */
    public function actualizarPerfil(): array
    {
        $claims = Guard::usuario();
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $cambios = [];
        if (array_key_exists('nombre', $datos)) {
            $cambios['nombre'] = Validar::texto($datos, 'nombre', 2, 100);
        }
        if (array_key_exists('telefono', $datos)) {
            $cambios['telefono'] = $datos['telefono'] === '' || $datos['telefono'] === null ? null : self::telefono($datos['telefono']);
        }
        if (!$cambios) {
            throw new ApiError(422, 'No hay cambios que aplicar');
        }
        $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($cambios)));
        Db::escritura()->prepare("UPDATE usuarios SET $set WHERE id = ?")->execute([...array_values($cambios), (int) $claims['sub']]);
        return [200, ['usuario' => $this->publico($this->usuarioPorId((int) $claims['sub']))]];
    }

    /** El panel llama a esto al abrirse; queda registrado quién entró. Entra todo el personal, cada rol a lo suyo. */
    public function accesoAdmin(): array
    {
        $claims = Guard::usuario();
        $datos = ['usuario_id' => (int) $claims['sub'], 'usuario_email' => $claims['email'], 'rol' => $claims['rol']];
        if (!in_array($claims['rol'], Guard::PERSONAL, true)) {
            Auditoria::registrar('ACCESO_ADMIN_PANEL', 'FALLO', $datos + ['dato_nuevo' => ['motivo' => 'rol sin permiso']]);
            throw new ApiError(403, 'No tienes permiso para esta acción');
        }
        Auditoria::registrar('ACCESO_ADMIN_PANEL', 'EXITO', $datos);
        return [200, ['acceso' => true]];
    }

    public function clientes(): array
    {
        Guard::usuario(Guard::PERSONAL);
        $filas = Db::lectura()->query("SELECT id, nombre, email, telefono, activo, bloqueado_hasta, created_at FROM usuarios
                                        WHERE rol = 'cliente' ORDER BY id DESC LIMIT 2000")->fetchAll();
        return [200, ['clientes' => array_map(fn($u) => self::clienteJson($u), $filas)]];
    }

    public function cliente(int $id): array
    {
        Guard::usuario(Guard::PERSONAL);
        $consulta = Db::escritura()->prepare("SELECT id, nombre, email, telefono, activo, bloqueado_hasta, created_at FROM usuarios
                                               WHERE id = ? AND rol = 'cliente'");
        $consulta->execute([$id]);
        $u = $consulta->fetch() ?: throw new ApiError(404, 'Cliente no encontrado');
        return [200, ['cliente' => self::clienteJson($u)]];
    }

    /**
     * Cuenta para alguien que llama o llega sin cuenta. Nace con una contraseña temporal (se muestra una
     * sola vez, para entregársela al cliente) que debe cambiar en su primer ingreso.
     */
    public function crearCliente(): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $nombre = Validar::texto($datos, 'nombre', 2, 100);
        $email = Validar::email($datos);
        $telefono = isset($datos['telefono']) && $datos['telefono'] !== '' ? self::telefono($datos['telefono']) : null;
        $db = Db::escritura();
        $existe = $db->prepare('SELECT id FROM usuarios WHERE email = ?');
        $existe->execute([$email]);
        if ($existe->fetchColumn()) {
            throw new ApiError(409, 'Ya existe una cuenta con ese correo: búscala en la lista');
        }
        // 10 caracteres sin los que se confunden al dictarlos (0/O, 1/l/I).
        $alfabeto = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        do {
            $temporal = '';
            for ($i = 0; $i < 10; $i++) {
                $temporal .= $alfabeto[random_int(0, strlen($alfabeto) - 1)];
            }
        } while (!preg_match('/\d/', $temporal) || !preg_match('/[a-zA-Z]/', $temporal));
        $db->prepare('INSERT INTO usuarios (nombre, email, telefono, password_hash, debe_cambiar_password, rol) VALUES (?, ?, ?, ?, 1, ?)')
            ->execute([$nombre, $email, $telefono, password_hash($temporal, PASSWORD_BCRYPT, self::BCRYPT), 'cliente']);
        $id = (int) $db->lastInsertId();
        Auditoria::registrar('REGISTRO_CLIENTE', 'EXITO', [
            'usuario_id' => $id, 'usuario_email' => $email, 'rol' => 'cliente',
            'dato_nuevo' => ['nombre' => $nombre, 'email' => $email, 'origen' => 'panel', 'creado_por' => $claims['email']],
        ]);
        return [201, ['cliente' => self::clienteJson($this->usuarioPorId($id) + ['created_at' => date('Y-m-d H:i:s'), 'bloqueado_hasta' => null]),
                      'password_temporal' => $temporal]];
    }

    /** Cambio de contraseña con la actual. Quita la marca de «contraseña temporal». */
    public function cambiarPassword(): array
    {
        $claims = Guard::usuario();
        $datos = Http::body();
        $usuario = $this->usuarioPorId((int) $claims['sub']);
        self::sinGoogle($usuario);
        if (!password_verify(is_string($datos['actual'] ?? null) ? $datos['actual'] : '', $usuario['password_hash'])) {
            throw new ApiError(422, 'La contraseña actual no es correcta', ['campo' => 'actual']);
        }
        $nueva = Validar::password($datos, 'nueva');
        if (password_verify($nueva, $usuario['password_hash'])) {
            throw new ApiError(422, 'La contraseña nueva debe ser distinta de la actual', ['campo' => 'nueva']);
        }
        Db::escritura()->prepare('UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 0 WHERE id = ?')
            ->execute([password_hash($nueva, PASSWORD_BCRYPT, self::BCRYPT), $usuario['id']]);
        Auditoria::registrar('PASSWORD_CAMBIADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['era_temporal' => (bool) $usuario['debe_cambiar_password']],
        ]);
        return [200, ['usuario' => $this->publico($this->usuarioPorId($usuario['id']))]];
    }

    /** Personal con acceso al panel (solo admin). */
    public function personal(): array
    {
        Guard::usuario(['admin']);
        $filas = Db::escritura()->query("SELECT id, nombre, email, rol, activo, mfa_activo FROM usuarios WHERE rol <> 'cliente' ORDER BY rol, nombre")->fetchAll();
        return [200, ['personal' => array_map(fn($u) => $this->publico($u) + ['activo' => (bool) $u['activo']], $filas)]];
    }

    /**
     * Asigna un rol (solo admin). E de STRIDE: nadie cambia su propio rol, y el cambio queda en la
     * bitácora. El rol nuevo rige en el próximo inicio de sesión (el JWT vigente dura como máximo 1 h).
     */
    public function cambiarRol(int $id): array
    {
        $claims = Guard::usuario(['admin']);
        $datos = Http::body();
        $rol = $datos['rol'] ?? null;
        if (!in_array($rol, ['cliente', ...Guard::PERSONAL], true)) {
            throw new ApiError(422, 'Rol no válido', ['campo' => 'rol']);
        }
        if ($id === (int) $claims['sub']) {
            throw new ApiError(409, 'No puedes cambiar tu propio rol');
        }
        $usuario = $this->usuarioPorId($id);
        if ($usuario['rol'] === $rol) {
            return [200, ['usuario' => $this->publico($usuario)]];
        }
        if ($usuario['google_sub'] !== null) {
            throw new ApiError(409, 'Esta cuenta entra con Google: el personal necesita una cuenta con contraseña');
        }
        Db::escritura()->prepare('UPDATE usuarios SET rol = ? WHERE id = ?')->execute([$rol, $id]);
        Auditoria::registrar('ROL_CAMBIADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => ['usuario_id' => $id, 'email' => $usuario['email'], 'rol' => $usuario['rol']],
            'dato_nuevo'    => ['usuario_id' => $id, 'email' => $usuario['email'], 'rol' => $rol],
        ]);
        return [200, ['usuario' => $this->publico($this->usuarioPorId($id))]];
    }

    private static function clienteJson(array $u): array
    {
        return [
            'id' => (int) $u['id'], 'nombre' => $u['nombre'], 'email' => $u['email'], 'telefono' => $u['telefono'], 'activo' => (bool) $u['activo'],
            'bloqueado' => $u['bloqueado_hasta'] !== null && strtotime($u['bloqueado_hasta']) > time(), 'creado' => $u['created_at'],
        ];
    }

    private static function telefono(mixed $valor): string
    {
        $valor = is_string($valor) ? trim($valor) : '';
        if (!preg_match('/^\+?[0-9 ()\-]{7,20}$/', $valor) || strlen(preg_replace('/\D/', '', $valor)) < 7) {
            throw new ApiError(422, 'Teléfono no válido', ['campo' => 'telefono']);
        }
        return $valor;
    }

    /**
     * Datos del reporte de clientes en PDF (se arma en el navegador). A.5.34 (datos mínimos): sin hashes, intentos ni datos de pedidos.
     * Cada exportación queda en la bitácora con quién la hizo y cuántos registros salieron.
     */
    public function exportarClientes(): array
    {
        $claims = Guard::usuario(['admin']);
        $filas = Db::lectura()->query("SELECT id, nombre, email, activo, created_at FROM usuarios WHERE rol = 'cliente' ORDER BY nombre")->fetchAll();

        Auditoria::registrar('EXPORTACION_CLIENTES', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['registros' => count($filas), 'formato' => 'pdf', 'columnas' => ['id', 'nombre', 'email', 'activo', 'creado']],
        ]);
        return [200, ['clientes' => array_map(fn($f) => [
            'id' => (int) $f['id'], 'nombre' => $f['nombre'], 'email' => $f['email'], 'activo' => (bool) $f['activo'], 'creado' => substr($f['created_at'], 0, 10),
        ], $filas)]];
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
        return ['id' => (int) $u['id'], 'nombre' => $u['nombre'], 'email' => $u['email'], 'telefono' => $u['telefono'] ?? null, 'rol' => $u['rol'],
                'mfa' => (bool) ($u['mfa_activo'] ?? false), 'cambiar_password' => (bool) ($u['debe_cambiar_password'] ?? false),
                'google' => ($u['google_sub'] ?? null) !== null];
    }
}
