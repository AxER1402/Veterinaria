# Simulacro DRP — ransomware en la BD maestra · 2026-10-10 10:23

Escenario 1 de [docs/04-bcp-drp.md](../04-bcp-drp.md). Ejecutado con `ops/simulacro-drp.sh`.

| Paso | Duración |
|---|---|
| Respaldo cifrado (AES-256) | 0,4 s |
| Incidente → detección (API caída) | 0,9 s |
| Maestro nuevo levantado | 5,8 s |
| Restauración del respaldo + binlogs (PITR) | 0,7 s |
| Réplica nueva sincronizada y API operativa | 6,4 s |
| **RTO medido (detección → operativo)** | **12,8 s** |

Objetivo de la BIA para la BD maestra: RTO 10 min · RPO 5 min.

## Verificación

| | usuarios · productos · stock · pedidos · líneas · pagos |
|---|---|
| Antes del incidente | `17 24 1560 26 26 9` |
| Maestro restaurado | `17 24 1560 26 26 9` |
| Réplica reconstruida | `17 24 1560 26 26 9` |

- Cambio posterior al respaldo completo (registro de `simulacro1791649380@correo.gt`): **recuperado desde los binlogs**.
- Bitácora antes: `true 326` · después: `true 327` (íntegra, registros). Al vivir en su propio volumen, el incidente no la alcanzó.
- Resultado: **RECUPERACIÓN COMPLETA, sin pérdida de datos**.
- Respaldo usado: `backups/20261010-102259` (verificado con SHA-256 antes de restaurar).

> RPO: el respaldo completo se complementa con los binlogs archivados (`ops/backup-binlogs.sh`, cron cada 5 min).
> Lo que se pierde en el peor caso es lo escrito desde el último archivado: **≤ 5 min**, como pide la BIA.
