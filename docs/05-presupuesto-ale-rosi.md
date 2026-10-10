# Huellitas — Presupuesto de ciberseguridad (ALE / ROSI)

## Supuestos del negocio

| Dato | Valor | Origen |
|---|---|---|
| Ventas anuales en línea | USD 96,000 | ≈ USD 8,000/mes, tienda pequeña de productos para mascotas |
| Ticket promedio | USD 40 | Catálogo de 24 productos con precios de USD 7 a 110 |
| Pedidos al año | ≈ 2,400 | ventas / ticket |
| Venta por hora | ≈ USD 11 | 96,000 / 8,760 h |
| Costo de una hora técnica | USD 25 | Desarrollador local |

## Fórmulas

- **SLE** (pérdida por evento) = valor del activo × factor de exposición
- **ALE** (pérdida anual esperada) = SLE × ARO (ocurrencias por año)
- **Beneficio neto** = ALE antes − ALE después − costo anual del control
- **ROSI** = beneficio neto / costo del control. Si el control cuesta 0, el ROSI no está definido (∞) y se reporta el beneficio neto.

## 1. Análisis ALE por amenaza

| # | Amenaza | SLE | ARO | ALE antes | Control implementado | Costo/año | ARO después | ALE después | Beneficio neto | ROSI |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Fuga de datos de tarjetas | 25,000 | 0.3 | 7,500 | No se almacenan tarjetas: Stripe.js / PayPal (SAQ A) | 0 | 0.01 | 250 | 7,250 | ∞ |
| 2 | Cuenta de cliente comprometida | 300 | 12 | 3,600 | bcrypt 12, bloqueo 5 intentos/15 min, rate limit, detección multi-IP, JWT 1 h revocable | 0 | 1.5 | 450 | 3,150 | ∞ |
| 3 | Ransomware en el servidor | 12,000 | 0.3 | 3,600 | Respaldos cifrados en R2 + binlogs cada 5 min + DRP probado (RTO ≈ 13 s en el simulacro) → SLE baja a 300 | 12 | 0.3 | 90 | 3,498 | 29,150 % |
| 4 | DDoS (4 h sin ventas + horas técnicas) | 250 | 4 | 1,000 | Cloudflare gratuito + rate limit + límites por contenedor → SLE baja a 100 | 0 | 1 | 100 | 900 | ∞ |
| 5 | Scraping de precios y catálogo | 1,500 | 2 | 3,000 | Caché Redis + rate limit por IP + stock exacto no publicado | 0 | 0.4 | 600 | 2,400 | ∞ |
| 6 | Webhook de pago falso | 2,000 | 1 | 2,000 | Firma `Stripe-Signature`, tolerancia 5 min, idempotencia, verificación de monto | 0 | 0.01 | 20 | 1,980 | ∞ |
| 7 | Precio manipulado en el carrito | 1,000 | 2 | 2,000 | Precio, cupón y envío calculados en el servidor | 0 | 0 | 0 | 2,000 | ∞ |
| 8 | Credenciales de administrador comprometidas | 8,000 | 0.2 | 1,600 | Bitácora append-only, revocación de JWT, alertas `FRAUDE`, rol desde el token firmado | 0 | 0.05 | 400 | 1,200 | ∞ |
| | **Total** | | | **24,300** | | **12** | | **1,910** | **22,378** | |

*Montos en USD por año. Los controles de código (filas 1, 2, 5, 6, 7 y 8) no tienen costo de licencia; su costo es el tiempo de desarrollo del proyecto, que no se repite cada año.*

**Lectura:** los controles reducen la pérdida anual esperada de **USD 24,300 a USD 1,910** (−92 %). La amenaza más cara antes de los controles era la fuga de tarjetas, y se elimina casi por completo con un control que no cuesta nada: no guardarlas.

## 2. Presupuesto anual

| Categoría | Herramienta | Costo/año (USD) | Nota |
|---|---|---|---|
| Pagos seguros | Stripe / PayPal (sandbox; en producción, comisión por transacción) | 0 | La comisión es un costo de venta, no de seguridad |
| CDN + anti-DDoS + DNS | Cloudflare Free | 0 | Proxy, "Under Attack", reglas WAF básicas |
| Certificado TLS | Let's Encrypt | 0 | Renovación automática |
| Respaldos remotos | Cloudflare R2 (10 GB gratis + Object Lock) | 12 | Margen para crecer más allá del tramo gratuito |
| Imágenes / CDN | Cloudinary Free (25 créditos/mes) | 0 | |
| Caché y lista negra de JWT | Redis en Docker | 0 | Corre en el mismo servidor |
| Hosting HTTPS | VPS (parte proporcional) o Railway Hobby | 120 | Sitio A. El sitio B se enciende solo en una contingencia |
| Dominio | `.com` | 15 | |
| Escáner de vulnerabilidades | OWASP ZAP | 0 | `docs/zap/` |
| SAST | GitHub CodeQL | 0 | Gratis en repos públicos. En repos privados requiere GitHub Advanced Security, y la alternativa gratuita es Semgrep CE |
| Correo transaccional | EmailJS Free (200/mes) | 0 | |
| **Subtotal** | | **147** | |
| Contingencia (10 %) | | 15 | |
| **Total** | | **USD 162 / año** | Dentro del rango del enunciado (USD 23–265) |

## 3. ROSI del programa completo

| | USD/año |
|---|---|
| ALE sin controles | 24,300 |
| ALE con controles | 1,910 |
| Reducción de riesgo | 22,390 |
| Costo total de seguridad | 162 |
| **Beneficio neto** | **22,228** |
| **ROSI** = 22,228 / 162 | **≈ 137× (13,721 %)** |

Cada dólar del presupuesto de seguridad evita unos USD 137 de pérdidas esperadas al año.

## 4. Riesgo residual y siguiente inversión

| Riesgo residual (ALE después) | Siguiente control | Costo estimado |
|---|---|---|
| Scraping (600) | Turnstile de Cloudflare en búsquedas masivas | 0 |
| Cuentas de cliente (450) | Aviso por correo ante un login desde un dispositivo nuevo | 0 (EmailJS) |
| Admin comprometido (400) | ✅ **Implementado:** MFA TOTP disponible para todas las cuentas, con aviso en el panel admin. Con MFA activo, el ARO estimado baja de 0.05 a 0.01 (ALE ≈ 80) | 0 |
