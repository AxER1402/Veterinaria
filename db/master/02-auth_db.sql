-- auth-service · auth_db
USE auth_db;

CREATE TABLE usuarios (
    id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre             VARCHAR(100) NOT NULL,
    email              VARCHAR(120) NOT NULL,
    password_hash      VARCHAR(255) NOT NULL,          -- bcrypt cost 12 (A02)
    rol                ENUM('admin','cliente') NOT NULL DEFAULT 'cliente',
    activo             TINYINT(1) NOT NULL DEFAULT 1,
    intentos_fallidos  TINYINT UNSIGNED NOT NULL DEFAULT 0,  -- A07: bloqueo tras 5
    bloqueado_hasta    DATETIME NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Usuarios de prueba (contraseñas en el README; aquí solo el hash bcrypt):
--   admin@huellitas.gt   / Admin#2026
--   cliente@huellitas.gt / Cliente#2026
INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES
 ('Administración Huellitas', 'admin@huellitas.gt',   '$2y$12$aj.tR0aLCoLpyqJsZELX1uyxTvqoNi.As7hTi2H0SIwCGX9UOyhla', 'admin'),  -- nosemgrep: detected-bcrypt-hash (usuario de prueba; contraseña pública en el README)
 ('Cliente de Prueba',        'cliente@huellitas.gt', '$2y$12$E8pFqE9GppjA6fgIZ2qnHOr2eFhsvI2DJI.aUBDycNrQfnpNHNDpa', 'cliente');  -- nosemgrep: detected-bcrypt-hash (usuario de prueba)
