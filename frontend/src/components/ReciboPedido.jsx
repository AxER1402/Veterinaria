import HojaRecibo from './HojaRecibo'
import { useClinica } from '../context/useClinica'
import { formatPrice } from '../data/shop'
import { formatDate, shortId } from '../pages/account/orderStatus'

export default function ReciboPedido({ pedido: p, onDone }) {
  const { sedes } = useClinica()
  const totales = [
    { label: 'Subtotal', valor: formatPrice(p.subtotal) },
    ...(p.descuento > 0 ? [{ label: 'Descuento', valor: `−${formatPrice(p.descuento)}` }] : []),
    { label: 'Envío', valor: p.envio ? formatPrice(p.envio) : 'Gratis' },
  ]
  return (
    <HojaRecibo titulo="Comprobante de compra" numero={`#${shortId(p.id)}`} fecha={formatDate(p.fecha)} sede={sedes[0]?.texto}
      cliente={p.contacto.nombre} detalle={p.metodo_entrega === 'retiro' ? `Retiro en ${p.sede}` : `Envío a ${p.direccion?.direccion}, ${p.direccion?.ciudad}`}
      lineas={p.items.map((i) => ({ concepto: `${i.nombre} (${i.etiqueta})`, cantidad: i.cantidad, precio_unitario: i.precio_unitario ?? i.precio, subtotal: i.subtotal }))}
      totales={totales} total={p.total} onDone={onDone} />
  )
}
