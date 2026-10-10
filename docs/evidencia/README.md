# Evidencia de seguridad · 2026-10-10 10:24

Generado con `ops/evidencia.sh` contra el stack en ejecución. Las capturas del panel están en esta misma carpeta.

## SEC-2 · Bitácora: ≥ 30 registros y ≥ 8 tipos de evento

```
+-----------+-----------------+
| registros | tipos_de_evento |
+-----------+-----------------+
|       368 |              16 |
+-----------+-----------------+
+-------------------------+-----------+-------+
| accion                  | resultado | total |
+-------------------------+-----------+-------+
| ACCESO_ADMIN_PANEL      | EXITO     |    16 |
| ACCESO_ADMIN_PANEL      | FALLO     |    13 |
| ACCESO_DENEGADO         | FALLO     |    13 |
| EMAIL_ENVIADO           | FALLO     |     6 |
| EXPORTACION_CLIENTES    | EXITO     |     6 |
| LOGIN_CLIENTE_EXITOSO   | EXITO     |    61 |
| LOGIN_CLIENTE_FALLIDO   | FALLO     |    96 |
| PAGO_CONFIRMADO         | EXITO     |     6 |
| PAGO_FALLIDO            | FALLO     |     5 |
| PAGO_FALLIDO            | FRAUDE    |     5 |
| PAGO_INICIADO           | FALLO     |     3 |
| PEDIDO_CREADO           | EXITO     |    30 |
| PEDIDO_ESTADO_CAMBIADO  | EXITO     |    13 |
| PRECIO_MODIFICADO       | EXITO     |    16 |
| PRODUCTO_AGOTADO        | EXITO     |     8 |
| REGISTRO_CLIENTE        | EXITO     |    22 |
| TOKEN_REVOCADO          | EXITO     |    11 |
| WEBHOOK_STRIPE_RECIBIDO | EXITO     |    16 |
| WEBHOOK_STRIPE_RECIBIDO | FALLO     |     6 |
| WEBHOOK_STRIPE_RECIBIDO | FRAUDE    |    16 |
+-------------------------+-----------+-------+
```

Últimos 30 registros:

```
+-----+-------------------------+-------------------------+-----------+------------------------+--------------------------+--------------+--------------+
| id  | timestamp               | accion                  | resultado | servicio               | usuario                  | ip_origen    | hash         |
+-----+-------------------------+-------------------------+-----------+------------------------+--------------------------+--------------+--------------+
| 368 | 2026-10-10 10:23:46.369 | ACCESO_ADMIN_PANEL      | FALLO     | auth-service           | compras4983105@correo.gt | 192.168.16.1 | 4a8e3fe2de16 |
| 367 | 2026-10-10 10:23:46.345 | EXPORTACION_CLIENTES    | EXITO     | auth-service           | admin@huellitas.gt       | 192.168.16.1 | e61881549225 |
| 366 | 2026-10-10 10:23:45.993 | ACCESO_DENEGADO         | FALLO     | pedidos-service        | cliente@huellitas.gt     | 192.168.16.1 | e01ae6f5f8cf |
| 365 | 2026-10-10 10:23:45.671 | PAGO_FALLIDO            | FALLO     | pagos-service          | cliente                  | 192.168.16.1 | 955946d99ad3 |
| 364 | 2026-10-10 10:23:45.668 | WEBHOOK_STRIPE_RECIBIDO | EXITO     | pagos-service          | anonimo                  | 192.168.16.1 | 0a9e27f9b00f |
| 363 | 2026-10-10 10:23:45.627 | PAGO_FALLIDO            | FRAUDE    | pagos-service          | cliente                  | 192.168.16.1 | c3e0fc160831 |
| 362 | 2026-10-10 10:23:45.624 | WEBHOOK_STRIPE_RECIBIDO | EXITO     | pagos-service          | anonimo                  | 192.168.16.1 | d0c3341b8bfd |
| 361 | 2026-10-10 10:23:45.512 | PEDIDO_CREADO           | EXITO     | pedidos-service        | compras4983105@correo.gt | 192.168.16.1 | ad755e7167f1 |
| 360 | 2026-10-10 10:23:45.429 | EMAIL_ENVIADO           | FALLO     | notificaciones-service | compras4983105@correo.gt | 192.168.16.1 | e6da90a3218d |
| 359 | 2026-10-10 10:23:45.425 | PEDIDO_ESTADO_CAMBIADO  | EXITO     | pedidos-service        | cliente                  | 192.168.16.1 | 2dfa82ddc27e |
| 358 | 2026-10-10 10:23:45.421 | PAGO_CONFIRMADO         | EXITO     | pagos-service          | cliente                  | 192.168.16.1 | 1b74d8395f50 |
| 357 | 2026-10-10 10:23:45.417 | WEBHOOK_STRIPE_RECIBIDO | EXITO     | pagos-service          | anonimo                  | 192.168.16.1 | 455540424851 |
| 356 | 2026-10-10 10:23:45.391 | WEBHOOK_STRIPE_RECIBIDO | FRAUDE    | pagos-service          | anonimo                  | 192.168.16.1 | f42d875f70c1 |
| 355 | 2026-10-10 10:23:45.377 | WEBHOOK_STRIPE_RECIBIDO | FRAUDE    | pagos-service          | anonimo                  | 192.168.16.1 | 48d3724632b9 |
| 354 | 2026-10-10 10:23:45.351 | WEBHOOK_STRIPE_RECIBIDO | FRAUDE    | pagos-service          | anonimo                  | 192.168.16.1 | bd272a691195 |
| 353 | 2026-10-10 10:23:45.329 | WEBHOOK_STRIPE_RECIBIDO | FALLO     | pagos-service          | anonimo                  | 192.168.16.1 | 7eb469440adf |
| 352 | 2026-10-10 10:23:45.201 | PEDIDO_CREADO           | EXITO     | pedidos-service        | compras4983105@correo.gt | 192.168.16.1 | 9445ded4f1cd |
| 351 | 2026-10-10 10:23:44.712 | PEDIDO_ESTADO_CAMBIADO  | EXITO     | pedidos-service        | admin@huellitas.gt       | 192.168.16.1 | 1c6db575bd57 |
| 350 | 2026-10-10 10:23:44.640 | PEDIDO_CREADO           | EXITO     | pedidos-service        | compras4983105@correo.gt | 192.168.16.1 | 36d3204fe190 |
| 349 | 2026-10-10 10:23:44.634 | PRODUCTO_AGOTADO        | EXITO     | catalogo-service       | compras4983105@correo.gt | 192.168.16.1 | 124cb1068dd8 |
| 348 | 2026-10-10 10:23:44.587 | PRECIO_MODIFICADO       | EXITO     | catalogo-service       | admin@huellitas.gt       | 192.168.16.1 | 85fb2d13f2d1 |
| 347 | 2026-10-10 10:23:44.549 | PRECIO_MODIFICADO       | EXITO     | catalogo-service       | admin@huellitas.gt       | 192.168.16.1 | b4d1c1c47bdb |
| 346 | 2026-10-10 10:23:44.475 | ACCESO_DENEGADO         | FALLO     | pedidos-service        | cliente@huellitas.gt     | 192.168.16.1 | 66d50f7230a9 |
| 345 | 2026-10-10 10:23:44.398 | PEDIDO_CREADO           | EXITO     | pedidos-service        | compras4983105@correo.gt | 192.168.16.1 | cb7751473e29 |
| 344 | 2026-10-10 10:23:44.358 | LOGIN_CLIENTE_EXITOSO   | EXITO     | auth-service           | cliente@huellitas.gt     | 192.168.16.1 | 38e1adb56793 |
| 343 | 2026-10-10 10:23:44.122 | LOGIN_CLIENTE_EXITOSO   | EXITO     | auth-service           | compras4983105@correo.gt | 192.168.16.1 | ee502b4b40d0 |
| 342 | 2026-10-10 10:23:43.896 | REGISTRO_CLIENTE        | EXITO     | auth-service           | compras4983105@correo.gt | 192.168.16.1 | b7488cc477c4 |
| 341 | 2026-10-10 10:23:42.546 | LOGIN_CLIENTE_FALLIDO   | FALLO     | auth-service           | prueba4983105@correo.gt  | 192.168.16.1 | 3bc6e04fa04c |
| 340 | 2026-10-10 10:23:42.533 | LOGIN_CLIENTE_FALLIDO   | FALLO     | auth-service           | prueba4983105@correo.gt  | 192.168.16.1 | 686414c74819 |
| 339 | 2026-10-10 10:23:42.520 | LOGIN_CLIENTE_FALLIDO   | FALLO     | auth-service           | prueba4983105@correo.gt  | 192.168.16.1 | ca904505e456 |
+-----+-------------------------+-------------------------+-----------+------------------------+--------------------------+--------------+--------------+
```

Append-only: incluso root recibe un error al intentar modificar la bitácora:

```
MariaDB [audit_db]> UPDATE security_audit_logs SET resultado='EXITO' WHERE id = 1;
ERROR 1644 (45000) at line 1: security_audit_logs es append-only: UPDATE prohibido
```

## SEC-3 · Sin datos de tarjeta en la base

```
MariaDB> DESCRIBE pagos_db.pagos;
+-------------------+-----------------------------------------+------+-----+---------------------+-------------------------------+
| Field             | Type                                    | Null | Key | Default             | Extra                         |
+-------------------+-----------------------------------------+------+-----+---------------------+-------------------------------+
| id                | char(36)                                | NO   | PRI | NULL                |                               |
| id_pedido         | char(36)                                | NO   | MUL | NULL                |                               |
| id_cliente        | int(10) unsigned                        | NO   |     | NULL                |                               |
| monto             | decimal(10,2)                           | NO   |     | NULL                |                               |
| moneda            | char(3)                                 | NO   |     | USD                 |                               |
| metodo            | enum('stripe','paypal')                 | NO   | MUL | NULL                |                               |
| payment_intent_id | varchar(255)                            | NO   |     | NULL                |                               |
| stripe_status     | varchar(40)                             | NO   |     | NULL                |                               |
| estado            | enum('iniciado','confirmado','fallido') | NO   |     | iniciado            |                               |
| fecha_pago        | datetime                                | YES  |     | NULL                |                               |
| created_at        | datetime                                | NO   |     | current_timestamp() |                               |
| updated_at        | datetime                                | NO   |     | current_timestamp() | on update current_timestamp() |
+-------------------+-----------------------------------------+------+-----+---------------------+-------------------------------+
MariaDB> SELECT * FROM pagos_db.pagos;
+--------------------------------------+--------------------------------------+-------+--------+--------+------------------------+---------------+------------+---------------------+
| id                                   | id_pedido                            | monto | moneda | metodo | payment_intent_id      | stripe_status | estado     | fecha_pago          |
+--------------------------------------+--------------------------------------+-------+--------+--------+------------------------+---------------+------------+---------------------+
| f714f636-c4c6-11f1-8f0a-5e4aef7008d5 | 65d4f654-a457-46f8-92d1-338486ea4f38 | 25.98 | USD    | stripe | pi_prueba_49831058546  | succeeded     | confirmado | 2026-10-10 10:23:45 |
| f741c046-c4c6-11f1-8f0a-5e4aef7008d5 | 37ef24bd-12f7-40a6-aa74-dfbe1d96b928 | 25.98 | USD    | stripe | pi_fraude_49831051833  | succeeded     | fallido    | NULL                |
| a1face10-c4c5-11f1-acae-aa8c21147f6f | dc6188a8-9591-42c7-9137-ee718ace1c8f | 25.98 | USD    | stripe | pi_fraude_957676111145 | succeeded     | fallido    | NULL                |
| a1cec54e-c4c5-11f1-acae-aa8c21147f6f | e9f2f359-cc35-4588-9878-a9de3ad767f3 | 25.98 | USD    | stripe | pi_prueba_95767618933  | succeeded     | confirmado | 2026-10-10 10:14:12 |
| 172f1ec8-c4c5-11f1-acae-aa8c21147f6f | 1585dee9-41f0-454c-bb84-6b747fed3999 | 25.98 | USD    | stripe | pi_fraude_70830113541  | succeeded     | fallido    | NULL                |
| 16fe6584-c4c5-11f1-acae-aa8c21147f6f | 325c3651-1ec3-41f6-8824-18150a1469ed | 25.98 | USD    | stripe | pi_prueba_708301116177 | succeeded     | confirmado | 2026-10-10 10:10:19 |
| 40237642-c4c3-11f1-9cde-0a5228d3b45d | 627d1f65-d25b-4081-9c98-0e91e85540c5 | 25.98 | USD    | stripe | pi_prueba_308026826961 | succeeded     | confirmado | 2026-10-10 09:57:16 |
| 4050dc37-c4c3-11f1-9cde-0a5228d3b45d | 7ff579db-def6-4db9-a509-dae0e16b763f | 25.98 | USD    | stripe | pi_fraude_308026810799 | succeeded     | fallido    | NULL                |
| e9f87ef5-c4c0-11f1-9cde-0a5228d3b45d | bdd579ab-e0cd-4158-ac25-1be52ef9dfa0 | 25.98 | USD    | stripe | pi_prueba_99331748542  | succeeded     | confirmado | 2026-10-10 09:40:32 |
| ea26baa2-c4c0-11f1-9cde-0a5228d3b45d | 4f7eb87d-96dd-4fae-98a4-371f4dd64de5 | 25.98 | USD    | stripe | pi_fraude_99331743453  | succeeded     | fallido    | NULL                |
| d47a25eb-c4bf-11f1-9cde-0a5228d3b45d | 1e9ebefe-8efe-4769-b4d5-928125821fe2 | 24.99 | USD    | stripe | pi_test_1791646367     | succeeded     | confirmado | 2026-10-10 09:32:47 |
+--------------------------------------+--------------------------------------+-------+--------+--------+------------------------+---------------+------------+---------------------+
MariaDB> -- columnas que parezcan de tarjeta en las 4 bases de negocio
+---------------------+
| columnas_de_tarjeta |
+---------------------+
|                   0 |
+---------------------+
```

## SEC-5 · Hardening Docker

```
$ docker ps --format "table {{.Names}}\t{{.Ports}}"
NAMES                                PORTS
huellitas-mariadb-slave-1            3306/tcp
huellitas-mariadb-master-1           3306/tcp
huellitas-gateway-1                  0.0.0.0:8088->80/tcp, [::]:8088->80/tcp, 0.0.0.0:8443->443/tcp, [::]:8443->443/tcp
huellitas-auth-service-1             80/tcp, 8081/tcp
huellitas-pedidos-service-1          80/tcp, 8083/tcp
huellitas-notificaciones-service-1   80/tcp, 8085/tcp
huellitas-pagos-service-1            80/tcp, 8084/tcp
huellitas-catalogo-service-1         80/tcp, 8082/tcp
huellitas-security-audit-service-1   80/tcp, 8086/tcp
huellitas-redis-1                    6379/tcp
huellitas-mariadb-audit-1            3306/tcp

$ docker ps | grep -E "0.0.0.0:(3306|6379)"   # sin resultados = BD y Redis no expuestos
(sin resultados)

$ docker compose exec auth-service whoami
www-data
```
