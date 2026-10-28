-- auth-service · roles del personal y teléfono en el perfil.
-- A01 / A.5.15 (control de acceso): cada quien ve solo lo de su trabajo.
--   veterinario → agenda, pacientes e historial clínico
--   recepcion   → agenda y clientes (sin historial clínico)
--   tienda      → pedidos y catálogo
--   admin       → todo, incluida la bitácora, la exportación de clientes y los roles
-- Idempotente: ops/migrar-v2.sh lo aplica también a una base ya creada.
USE auth_db;

ALTER TABLE usuarios
    MODIFY COLUMN rol ENUM('admin','cliente','veterinario','recepcion','tienda') NOT NULL DEFAULT 'cliente',
    ADD COLUMN IF NOT EXISTS telefono VARCHAR(20) NULL AFTER email;

-- Personal de prueba (contraseña Personal#2026, documentada en usuarios.md).
INSERT IGNORE INTO usuarios (nombre, email, password_hash, rol) VALUES
 ('Dra. Andrea Morales',  'veterinaria@huellitas.gt', '$2y$12$k3hWxKPsM02Zfph7m6gee.L.Jeewavr4dRAt6i69JQroPTIGfxpp6', 'veterinario'),  -- nosemgrep: detected-bcrypt-hash (usuario de prueba)
 ('Recepción Huellitas',  'recepcion@huellitas.gt',   '$2y$12$k3hWxKPsM02Zfph7m6gee.L.Jeewavr4dRAt6i69JQroPTIGfxpp6', 'recepcion'),    -- nosemgrep: detected-bcrypt-hash (usuario de prueba)
 ('Tienda Huellitas',     'tienda@huellitas.gt',      '$2y$12$k3hWxKPsM02Zfph7m6gee.L.Jeewavr4dRAt6i69JQroPTIGfxpp6', 'tienda');       -- nosemgrep: detected-bcrypt-hash (usuario de prueba)
