# Simulacro DRP — ransomware en la BD maestra · 2026-10-17 11:26

Escenario 1 de [docs/04-bcp-drp.md](../04-bcp-drp.md). Ejecutado con `ops/simulacro-drp.sh`.

| Paso | Duración |
|---|---|
| Respaldo cifrado (AES-256) | 0,5 s |
| Incidente → detección (API caída) | 1,1 s |
| Maestro nuevo levantado | 6,3 s |
| Restauración del respaldo + binlogs (PITR) | 0,9 s |
| Réplica nueva sincronizada y API operativa | 7,0 s |
| **RTO medido (detección → operativo)** | **14,2 s** |

Objetivo de la BIA para la BD maestra: RTO 10 min · RPO 5 min.

## Verificación

| | usuarios · productos · stock · pedidos · líneas · pagos · mascotas · citas · consultas · vacunas |
|---|---|
| Antes del incidente | `116 24 2027 161 161 64 64 148 7 20` |
| Maestro restaurado | `116 24 2027 161 161 64 64 148 7 20` |
| Réplica reconstruida | `116 24 2027 161 161 64 64 148 7 20` |

- Cambio posterior al respaldo completo (registro de `simulacro1792257965@correo.gt`): **recuperado desde los binlogs**.
- Bitácora antes: `true 2409` · después: `true 2410` (íntegra, registros). Al vivir en su propio volumen, el incidente no la alcanzó.
- Resultado: **RECUPERACIÓN COMPLETA, sin pérdida de datos**.
- Respaldo usado: `backups/20261017-112605` (verificado con SHA-256 antes de restaurar).

> RPO: el respaldo completo se complementa con los binlogs archivados (`ops/backup-binlogs.sh`, cron cada 5 min).
> Lo que se pierde en el peor caso es lo escrito desde el último archivado: **≤ 5 min**, como pide la BIA.
