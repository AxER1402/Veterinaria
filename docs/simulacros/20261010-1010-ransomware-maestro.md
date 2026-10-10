# Simulacro DRP — ransomware en la BD maestra · 2026-10-10 10:10

Escenario 1 de [docs/04-bcp-drp.md](../04-bcp-drp.md). Ejecutado con `ops/simulacro-drp.sh`.

| Paso | Duración |
|---|---|
| Respaldo cifrado (AES-256) | 0,3 s |
| Incidente → detección (API caída) | 0,9 s |
| Maestro nuevo levantado | 5,7 s |
| Restauración del respaldo | 0,3 s |
| Réplica nueva sincronizada y API operativa | 6,4 s |
| **RTO medido (detección → operativo)** | **12,4 s** |

Objetivo de la BIA para la BD maestra: RTO 10 min · RPO 5 min.

## Verificación

| | usuarios · productos · stock · pedidos · líneas · pagos |
|---|---|
| Antes del incidente | `12 24 1568 18 18 5` |
| Maestro restaurado | `12 24 1568 18 18 5` |
| Réplica reconstruida | `12 24 1568 18 18 5` |

- Bitácora antes: `true 234` · después: `true 235` (íntegra, registros). Al vivir en su propio volumen, el incidente no la alcanzó.
- Resultado: **RECUPERACIÓN COMPLETA, sin pérdida de datos**.
- Respaldo usado: `backups/20261010-100957` (verificado con SHA-256 antes de restaurar).

> En el simulacro el respaldo se toma justo antes del incidente, así que el RPO es 0. En operación normal el
> respaldo completo es diario y el incremental cada 4 h (docs/04-bcp-drp.md §3). El RPO de 5 min de la BIA se
> logra conservando los binlogs del maestro en otro volumen o en S3 para recuperación a un punto en el tiempo.
