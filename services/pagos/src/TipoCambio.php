<?php
declare(strict_types=1);

namespace App;

use Huellitas\Cache;
use Huellitas\Env;

/**
 * Quetzales por dólar para cobrar con PayPal (que no acepta GTQ).
 *
 * Con PAYPAL_TIPO_CAMBIO_AUTO=1 (por defecto) se usa el tipo de cambio de referencia del día del
 * Banco de Guatemala (servicio TipoCambioDia), guardado 6 h en Redis. Si Banguat no responde o
 * devuelve algo fuera de rango, se usa PAYPAL_TIPO_CAMBIO y se vuelve a intentar a los 10 min.
 * Con PAYPAL_TIPO_CAMBIO_AUTO=0 siempre se usa PAYPAL_TIPO_CAMBIO.
 *
 * Lo que se cobró queda en pagos.monto_pasarela: un cambio de tasa no altera pagos ya iniciados.
 */
final class TipoCambio
{
    private const URL = 'https://www.banguat.gob.gt/variables/ws/TipoCambio.asmx';
    private const CLAVE = 'paypal:tipo_cambio';
    private const VIGENCIA_SEG = 6 * 3600;
    private const REINTENTO_SEG = 600;
    // Una tasa absurda (error del servicio o respuesta alterada) no debe cambiar lo que se cobra.
    private const MINIMO = 5.0;
    private const MAXIMO = 12.0;

    /** @return array{tasa: float, fuente: string, fecha: ?string} */
    public static function actual(): array
    {
        $fija = ['tasa' => (float) Env::get('PAYPAL_TIPO_CAMBIO', '7.75'), 'fuente' => 'fijo', 'fecha' => null];
        if (Env::get('PAYPAL_TIPO_CAMBIO_AUTO', '1') !== '1') {
            return $fija;
        }

        $redis = Cache::redis();
        $guardado = json_decode((string) $redis->get(self::CLAVE), true);
        if (is_array($guardado) && isset($guardado['tasa'], $guardado['fuente'])) {
            return $guardado;
        }

        $banguat = self::consultarBanguat();
        if ($banguat !== null) {
            $redis->setex(self::CLAVE, self::VIGENCIA_SEG, json_encode($banguat));
            return $banguat;
        }
        $redis->setex(self::CLAVE, self::REINTENTO_SEG, json_encode($fija));
        return $fija;
    }

    /** @return array{tasa: float, fuente: string, fecha: string}|null */
    private static function consultarBanguat(): ?array
    {
        $sobre = '<?xml version="1.0" encoding="utf-8"?>'
            . '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
            . '<TipoCambioDia xmlns="http://www.banguat.gob.gt/variables/ws/" />'
            . '</soap:Body></soap:Envelope>';
        $ch = curl_init(self::URL);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $sobre,
            CURLOPT_HTTPHEADER     => ['Content-Type: text/xml; charset=utf-8', 'SOAPAction: "http://www.banguat.gob.gt/variables/ws/TipoCambioDia"'],
            CURLOPT_RETURNTRANSFER => true,
            // Corto: se consulta dentro de la petición de pago (pedidos-service espera menos de 4 s).
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT        => 3,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        ]);
        $xml = curl_exec($ch);
        $codigo = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);

        // Se extraen solo los dos valores con una expresión regular: no se interpreta el XML (sin XXE).
        if ($xml === false || $codigo !== 200
            || !preg_match('#<referencia>(\d{1,2}\.\d{1,6})</referencia>#', $xml, $tasa)
            || !preg_match('#<fecha>(\d{2}/\d{2}/\d{4})</fecha>#', $xml, $fecha)) {
            error_log('TipoCambio: Banguat no respondió bien (' . ($xml === false ? curl_error($ch) : "HTTP $codigo") . '); se usa PAYPAL_TIPO_CAMBIO');
            return null;
        }
        $valor = (float) $tasa[1];
        if ($valor < self::MINIMO || $valor > self::MAXIMO) {
            error_log("TipoCambio: Banguat devolvió $valor, fuera de rango; se usa PAYPAL_TIPO_CAMBIO");
            return null;
        }
        return ['tasa' => $valor, 'fuente' => 'banguat', 'fecha' => $fecha[1]];
    }
}
