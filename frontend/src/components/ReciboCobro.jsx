import HojaRecibo from './HojaRecibo'
import { METODOS_PAGO } from '../data/recibos'
import { formatDate } from '../pages/account/orderStatus'

// Recibo de un cobro de la clínica (panel y Mi cuenta).
export default function ReciboCobro({ cobro: c, onDone }) {
  return (
    <HojaRecibo titulo="Recibo" numero={c.recibo} fecha={formatDate(c.cobrado_at || c.fecha)} sede={c.sede}
      cliente={c.cliente.nombre} detalle={c.mascota && <><b>Mascota:</b> {c.mascota}</>} lineas={c.lineas} total={c.total}
      pago={c.estado === 'pagado' ? `${METODOS_PAGO[c.metodo]}${c.referencia ? ` · ${c.referencia}` : ''}` : 'Pendiente de pago'}
      nota={c.estado === 'anulado' ? `ANULADO: ${c.motivo_anulacion}` : null} onDone={onDone} />
  )
}
