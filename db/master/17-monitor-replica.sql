-- Los servicios leen el estado de la réplica (SHOW SLAVE STATUS) para no leer datos atrasados:
-- si la replicación se detiene o se atrasa, Db::lectura() usa el maestro. REPLICA MONITOR solo
-- permite ver ese estado; no da acceso a datos. Los usuarios y el permiso llegan a la réplica por
-- la propia replicación.
-- Idempotente: ops/migrar-v2.sh lo aplica también a una base ya creada.
GRANT REPLICA MONITOR ON *.* TO 'auth_user'@'%', 'catalogo_user'@'%', 'pedidos_user'@'%', 'pagos_user'@'%', 'citas_user'@'%';
