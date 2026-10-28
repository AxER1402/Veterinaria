<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Auditoria;
use Huellitas\Db;
use Huellitas\Env;
use Huellitas\Guard;
use Huellitas\Http;
use Huellitas\Interno;
use Huellitas\Jwt;

/**
 * PCI-DSS (básico):
 * - Nunca se recibe ni se guarda la tarjeta: solo payment_intent_id / order id.
 * - Las rutas de pago solo las llama pedidos-service con JWT de servicio. La única ruta pública
 *   es el webhook, y se autentica con la firma Stripe-Signature.
 * - Cada intento (inicio, confirmación, fallo, webhook) queda en la bitácora con su referencia.
 */
final class PagosController
{
    /** Entrada: {pedido_id, id_cliente, monto: "41.97", metodo: stripe|paypal, actor} */
    /** Métodos con claves configuradas (solo pedidos-service). Sin claves, ese método no se ofrece. */
    public function metodos(): array
    {
        Guard::servicio(['pedidos-service']);
        return [200, ['metodos' => array_values(array_filter([Stripe::configurado() ? 'stripe' : null, PayPal::configurado() ? 'paypal' : null]))]];
    }

    /**
     * Reembolso total del pago confirmado de un pedido, por la API de la pasarela (solo pedidos-service).
     * Entrada: {pedido_id, actor}. Devuelve la referencia del reembolso.
     */
    public function reembolsar(): array
    {
        Guard::servicio(['pedidos-service']);
        $d = Http::body();
        $pedidoId = is_string($d['pedido_id'] ?? null) ? $d['pedido_id'] : throw new ApiError(422, 'Pedido no válido');
        $q = Db::escritura()->prepare("SELECT id, metodo, payment_intent_id, monto, moneda, reembolso_ref FROM pagos
                                        WHERE id_pedido = ? AND estado = 'confirmado' ORDER BY fecha_pago DESC LIMIT 1");
        $q->execute([$pedidoId]);
        $pago = $q->fetch() ?: throw new ApiError(409, 'Este pedido no tiene un pago confirmado en la pasarela: reembolsa a mano y anota la referencia');
        if ($pago['reembolso_ref'] !== null) {
            return [200, ['referencia' => $pago['reembolso_ref'], 'metodo' => $pago['metodo']]];
        }
        if (!($pago['metodo'] === 'stripe' ? Stripe::configurado() : PayPal::configurado())) {
            throw new ApiError(503, 'La pasarela de ese pago no está configurada en este entorno');
        }
        $referencia = $pago['metodo'] === 'stripe' ? Stripe::reembolsar($pago['payment_intent_id']) : PayPal::reembolsar($pago['payment_intent_id']);
        Db::escritura()->prepare('UPDATE pagos SET reembolso_ref = ?, reembolsado_en = NOW() WHERE id = ?')->execute([$referencia, $pago['id']]);
        Auditoria::registrar('PAGO_REEMBOLSADO', 'EXITO', (is_array($d['actor'] ?? null) ? $d['actor'] : []) + [
            'pedido_id' => $pedidoId, 'pago_id' => $pago['id'],
            'dato_nuevo' => ['metodo' => $pago['metodo'], 'monto' => $pago['monto'], 'moneda' => $pago['moneda'], 'referencia' => $referencia],
        ]);
        return [200, ['referencia' => $referencia, 'metodo' => $pago['metodo']]];
    }

    public function iniciar(): array
    {
        Guard::servicio(['pedidos-service']);
        $d = Http::body();
        $pedidoId = self::uuid($d['pedido_id'] ?? null);
        $idCliente = is_int($d['id_cliente'] ?? null) ? $d['id_cliente'] : throw new ApiError(422, 'id_cliente inválido');
        $monto = is_string($d['monto'] ?? null) && preg_match('/^\d{1,8}\.\d{2}$/', $d['monto']) && (float) $d['monto'] > 0
            ? $d['monto'] : throw new ApiError(422, 'Monto inválido');
        $metodo = in_array($d['metodo'] ?? null, ['stripe', 'paypal'], true) ? $d['metodo'] : throw new ApiError(422, 'Método de pago no válido');
        $actor = self::actor($d['actor'] ?? []);

        $confirmado = Db::escritura()->prepare("SELECT 1 FROM pagos WHERE id_pedido = ? AND estado = 'confirmado'");
        $confirmado->execute([$pedidoId]);
        if ($confirmado->fetchColumn()) {
            throw new ApiError(409, 'Este pedido ya fue pagado');
        }

        $ref = ['metodo' => $metodo, 'monto' => $monto];
        [$montoPasarela, $monedaPasarela] = [$monto, 'GTQ'];
        try {
            if ($metodo === 'stripe') {
                if (!Stripe::configurado()) {
                    throw new ApiError(503, 'El pago con tarjeta no está habilitado en este entorno');
                }
                $pi = Stripe::crearIntento($pedidoId, (int) round((float) $monto * 100), $idCliente);
                $referencia = $pi['id'];
                $estado = $pi['status'];
                $respuesta = ['metodo' => 'stripe', 'client_secret' => $pi['client_secret'], 'publishable_key' => Env::required('STRIPE_PUBLISHABLE_KEY')];
            } else {
                if (!PayPal::configurado()) {
                    throw new ApiError(503, 'El pago con PayPal no está habilitado en este entorno');
                }
                [$montoPasarela, $monedaPasarela] = [PayPal::aDolares($monto), 'USD'];
                $orden = PayPal::crearOrden($pedidoId, $montoPasarela);
                $referencia = $orden['id'];
                $estado = $orden['status'] ?? 'CREATED';
                $respuesta = ['metodo' => 'paypal', 'orden_id' => $orden['id'], 'client_id' => Env::required('PAYPAL_CLIENT_ID'),
                              'monto_cobro' => $montoPasarela, 'moneda_cobro' => 'USD', 'tipo_cambio' => PayPal::tipoCambio()];
            }
        } catch (ApiError $e) {
            Auditoria::registrar('PAGO_INICIADO', 'FALLO', $actor + ['pedido_id' => $pedidoId, 'dato_nuevo' => $ref + ['motivo' => $e->getMessage()]]);
            throw $e;
        }

        // Un mismo PaymentIntent/orden (idempotencia de la pasarela) no crea filas duplicadas.
        $pagoId = Jwt::uuid();
        $db = Db::escritura();
        $db->prepare("INSERT INTO pagos (id, id_pedido, id_cliente, monto, moneda, monto_pasarela, moneda_pasarela, metodo, payment_intent_id, stripe_status)
                      VALUES (?, ?, ?, ?, 'GTQ', ?, ?, ?, ?, ?)
                      ON DUPLICATE KEY UPDATE stripe_status = VALUES(stripe_status)")
            ->execute([$pagoId, $pedidoId, $idCliente, $monto, $montoPasarela, $monedaPasarela, $metodo, $referencia, $estado]);
        $buscar = $db->prepare('SELECT id FROM pagos WHERE metodo = ? AND payment_intent_id = ?');
        $buscar->execute([$metodo, $referencia]);
        $pagoId = $buscar->fetchColumn();

        Auditoria::registrar('PAGO_INICIADO', 'EXITO', $actor + [
            'pedido_id' => $pedidoId, 'pago_id' => $pagoId,
            'dato_nuevo' => $ref + ['referencia' => $referencia, 'estado_pasarela' => $estado, 'cobro' => "$montoPasarela $monedaPasarela"],
        ]);
        return [200, $respuesta + ['pago_id' => $pagoId]];
    }

    /** Entrada: {pedido_id, orden_id, actor}. Captura del lado del servidor y verifica el monto. */
    public function capturarPayPal(): array
    {
        Guard::servicio(['pedidos-service']);
        $d = Http::body();
        $pedidoId = self::uuid($d['pedido_id'] ?? null);
        $ordenId = is_string($d['orden_id'] ?? null) && preg_match('/^[A-Z0-9]{5,40}$/', $d['orden_id'])
            ? $d['orden_id'] : throw new ApiError(422, 'Orden de PayPal inválida');
        $actor = self::actor($d['actor'] ?? []);

        // La orden debe pertenecer a ESTE pedido (no se puede usar el pago de otro).
        $consulta = Db::escritura()->prepare("SELECT * FROM pagos WHERE metodo = 'paypal' AND payment_intent_id = ? AND id_pedido = ?");
        $consulta->execute([$ordenId, $pedidoId]);
        $pago = $consulta->fetch() ?: throw new ApiError(404, 'Pago no encontrado');
        if ($pago['estado'] === 'confirmado') {
            return [200, ['confirmado' => true, 'pago_id' => $pago['id'], 'referencia' => $ordenId, 'monto' => $pago['monto']]];
        }

        $captura = PayPal::capturar($ordenId);
        $unidad = $captura['purchase_units'][0] ?? [];
        $cobro = $unidad['payments']['captures'][0] ?? [];
        // Se compara con lo que se le pidió cobrar a PayPal (USD), no con el total en quetzales.
        $montoOk = ($cobro['amount']['value'] ?? null) === ($pago['monto_pasarela'] ?? $pago['monto'])
            && ($cobro['amount']['currency_code'] ?? null) === ($pago['moneda_pasarela'] ?? 'USD');
        $pedidoOk = ($cobro['custom_id'] ?? $unidad['custom_id'] ?? $unidad['reference_id'] ?? null) === $pedidoId;

        if (($captura['status'] ?? null) === 'COMPLETED' && $montoOk && $pedidoOk) {
            $this->confirmar($pago, 'COMPLETED', $actor, ['captura_id' => $cobro['id'] ?? null]);
            return [200, ['confirmado' => true, 'pago_id' => $pago['id'], 'referencia' => $ordenId, 'monto' => $pago['monto']]];
        }

        $fraude = ($captura['status'] ?? null) === 'COMPLETED';  // cobrado, pero monto o pedido no cuadran
        $this->fallar($pago, $captura['status'] ?? 'FAILED', $actor, $fraude ? 'FRAUDE' : 'FALLO',
            $fraude ? 'el monto o el pedido capturado no coinciden' : ($captura['detalle'] ?? 'captura no completada'));
        throw new ApiError(402, 'PayPal no confirmó el pago');
    }

    /**
     * Webhook de Stripe (público). A08: sin firma válida no se procesa nada.
     * Se responde 2xx solo cuando el evento quedó procesado; si el pedido no se pudo
     * actualizar, 503 para que Stripe reintente.
     */
    public function webhookStripe(): array
    {
        $payload = (string) file_get_contents('php://input', false, null, 0, 262144);
        $cabecera = (string) ($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '');

        if (!Stripe::firmaValida($payload, $cabecera)) {
            Auditoria::registrar('WEBHOOK_STRIPE_RECIBIDO', $cabecera === '' ? 'FALLO' : 'FRAUDE', [
                'rol' => 'anonimo',
                'dato_nuevo' => ['firma' => $cabecera === '' ? 'ausente' : 'inválida', 'bytes' => strlen($payload)],
            ]);
            throw new ApiError(400, 'Firma inválida');
        }

        $evento = json_decode($payload, true);
        $eventoId = $evento['id'] ?? null;
        $tipo = $evento['type'] ?? null;
        $objeto = $evento['data']['object'] ?? null;
        if (!is_string($eventoId) || !is_string($tipo) || !is_array($objeto)) {
            throw new ApiError(400, 'Evento mal formado');
        }
        $referencia = is_string($objeto['id'] ?? null) ? $objeto['id'] : null;

        $db = Db::escritura();
        $visto = $db->prepare('SELECT 1 FROM webhook_eventos WHERE event_id = ?');
        $visto->execute([$eventoId]);
        if ($visto->fetchColumn()) {
            return [200, ['recibido' => true, 'duplicado' => true]];
        }

        $consulta = $db->prepare("SELECT * FROM pagos WHERE metodo = 'stripe' AND payment_intent_id = ?");
        $consulta->execute([$referencia]);
        $pago = $consulta->fetch() ?: null;

        Auditoria::registrar('WEBHOOK_STRIPE_RECIBIDO', 'EXITO', [
            'rol' => 'anonimo', 'pedido_id' => $pago['id_pedido'] ?? null, 'pago_id' => $pago['id'] ?? null,
            'dato_nuevo' => ['firma' => 'válida', 'evento' => $eventoId, 'tipo' => $tipo, 'referencia' => $referencia],
        ]);

        $resultado = 'ignorado';
        $actor = $pago ? ['usuario_id' => (int) $pago['id_cliente'], 'rol' => 'cliente'] : ['rol' => 'anonimo'];
        if ($pago && $tipo === 'payment_intent.succeeded') {
            $centavos = (int) round((float) ($pago['monto_pasarela'] ?? $pago['monto']) * 100);
            $cuadra = ($objeto['amount_received'] ?? null) === $centavos
                && ($objeto['currency'] ?? null) === strtolower($pago['moneda_pasarela'] ?? $pago['moneda'])
                && ($objeto['metadata']['pedido_id'] ?? null) === $pago['id_pedido'];
            if (!$cuadra) {
                $this->fallar($pago, (string) ($objeto['status'] ?? 'succeeded'), $actor, 'FRAUDE', 'monto, moneda o pedido no coinciden con el pago');
                $resultado = 'rechazado';
            } else {
                if ($pago['estado'] !== 'confirmado') {
                    $this->confirmar($pago, 'succeeded', $actor, ['evento' => $eventoId]);
                }
                // El pedido pasa a "pagado" en pedidos-service; si falla, Stripe reintenta.
                [$codigo] = Interno::post($this->pedidos('/internal/pedidos/pagado'), [
                    'pedido_id' => $pago['id_pedido'], 'pago_id' => $pago['id'], 'monto' => $pago['monto'],
                    'metodo' => 'stripe', 'referencia' => $referencia,
                ], 10);
                if ($codigo !== 200) {
                    error_log("Webhook $eventoId: pedidos-service respondió $codigo, se pide reintento a Stripe");
                    throw new ApiError(503, 'Reintentar más tarde');
                }
                $resultado = 'confirmado';
            }
        } elseif ($pago && $tipo === 'payment_intent.payment_failed') {
            $this->fallar($pago, (string) ($objeto['status'] ?? 'requires_payment_method'), $actor, 'FALLO',
                (string) ($objeto['last_payment_error']['code'] ?? 'pago rechazado'));
            $resultado = 'fallido';
        } elseif (!$pago) {
            $resultado = 'pago desconocido';
        }

        $db->prepare('INSERT INTO webhook_eventos (event_id, proveedor, tipo, payment_intent_id, resultado) VALUES (?, ?, ?, ?, ?)')
            ->execute([$eventoId, 'stripe', $tipo, $referencia, $resultado]);
        return [200, ['recibido' => true, 'resultado' => $resultado]];
    }

    private function confirmar(array $pago, string $estadoPasarela, array $actor, array $extra = []): void
    {
        Db::escritura()->prepare("UPDATE pagos SET estado = 'confirmado', stripe_status = ?, fecha_pago = NOW() WHERE id = ?")
            ->execute([$estadoPasarela, $pago['id']]);
        Auditoria::registrar('PAGO_CONFIRMADO', 'EXITO', $actor + [
            'pedido_id' => $pago['id_pedido'], 'pago_id' => $pago['id'],
            'dato_anterior' => ['estado' => $pago['estado']],
            'dato_nuevo'    => ['estado' => 'confirmado', 'metodo' => $pago['metodo'], 'referencia' => $pago['payment_intent_id'], 'monto' => $pago['monto']] + $extra,
        ]);
    }

    private function fallar(array $pago, string $estadoPasarela, array $actor, string $resultado, string $motivo): void
    {
        Db::escritura()->prepare("UPDATE pagos SET estado = 'fallido', stripe_status = ? WHERE id = ? AND estado <> 'confirmado'")
            ->execute([$estadoPasarela, $pago['id']]);
        Auditoria::registrar('PAGO_FALLIDO', $resultado, $actor + [
            'pedido_id' => $pago['id_pedido'], 'pago_id' => $pago['id'],
            'dato_nuevo' => ['metodo' => $pago['metodo'], 'referencia' => $pago['payment_intent_id'], 'monto' => $pago['monto'], 'motivo' => $motivo],
        ]);
    }

    private function pedidos(string $ruta): string
    {
        return rtrim(Env::get('PEDIDOS_URL', 'http://pedidos-service:8083'), '/') . $ruta;
    }

    private static function uuid(mixed $valor): string
    {
        if (!is_string($valor) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $valor)) {
            throw new ApiError(422, 'pedido_id inválido');
        }
        return $valor;
    }

    private static function actor(mixed $a): array
    {
        return [
            'usuario_id'    => is_int($a['usuario_id'] ?? null) ? $a['usuario_id'] : null,
            'usuario_email' => is_string($a['usuario_email'] ?? null) ? $a['usuario_email'] : null,
            'rol'           => in_array($a['rol'] ?? null, ['admin', 'cliente'], true) ? $a['rol'] : 'anonimo',
        ];
    }
}
