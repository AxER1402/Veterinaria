import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Loading from '../../components/Loading'
import ConfirmDialog from '../../components/ConfirmDialog'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { STATUS, shortId, formatDate } from '../account/orderStatus'

// Solo para mostrar las opciones; la regla que vale es la del servidor (pedidos-service).
const NEXT = {
  pendiente_pago: ['cancelado'],
  pagado: ['preparando', 'cancelado'],
  preparando: ['listo_retiro', 'enviado', 'cancelado'],
  listo_retiro: ['entregado', 'cancelado'],
  enviado: ['entregado'],
  entregado: [],
  cancelado: [],
}
const COBRADOS = ['pagado', 'preparando', 'listo_retiro', 'enviado']
const MOTIVOS_CANCELAR = ['Sin stock', 'El cliente lo pidió', 'Dirección fuera de cobertura', 'Pago no reconocido']

// Ficha del pedido para el personal de tienda: contacto completo, sin el botón de pagar del cliente.
export default function AdminPedido() {
  const { id } = useParams()
  const [pedido, setPedido] = useState(null)
  const [error, setError] = useState('')
  const [dialogo, setDialogo] = useState(null)
  const [referencia, setReferencia] = useState('')

  useEffect(() => {
    api(`/api/pedidos/${id}`).then((d) => setPedido(d.pedido)).catch((e) => setError(e.message))
  }, [id])

  if (error && !pedido) return <div className="admin-card"><p className="form-alert">{error}</p><Link to="/admin/pedidos">Volver a pedidos</Link></div>
  if (!pedido) return <Loading />
  const p = pedido
  const opciones = NEXT[p.estado].filter((n) => !(n === 'enviado' && p.metodo_entrega === 'retiro') && !(n === 'listo_retiro' && p.metodo_entrega === 'domicilio'))

  const cambiar = async (nuevo, comentario) => {
    const d = await api(`/api/pedidos/admin/${p.id}/estado`, { method: 'PATCH', body: { estado: nuevo, comentario } })
    setPedido(d.pedido)
    setDialogo(null)
  }
  const reembolsar = async (e) => {
    e.preventDefault()
    setError('')
    try {
      setPedido((await api(`/api/pedidos/admin/${p.id}/reembolso`, { method: 'PATCH', body: { referencia } })).pedido)
      setReferencia('')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <Link to="/admin/pedidos" className="link-btn patient__back"><ArrowLeft size={16} /> Pedidos</Link>
      <div className="admin-grid">
        <div className="admin-card">
          <div className="admin-card__head">
            <h2>Pedido #{shortId(p.id)} <small>· {formatDate(p.fecha)}</small></h2>
            <span className={`status status--${STATUS[p.estado].tone}`}>{STATUS[p.estado].label}</span>
          </div>
          {opciones.length > 0 && (
            <div className="pedido__acciones">
              {opciones.map((n) => (
                <button key={n} className={`btn btn--xs ${n === 'cancelado' ? 'btn--ghost btn--danger-text' : 'btn--dark'}`} onClick={() => setDialogo(n)}>
                  {n === 'cancelado' ? 'Cancelar pedido' : `Pasar a «${STATUS[n].label}»`}
                </button>
              ))}
            </div>
          )}
          {p.reembolso?.estado === 'pendiente' && (
            <form className="pedido__reembolso" onSubmit={reembolsar}>
              <p><strong>Reembolso pendiente.</strong> El pedido se cobró y se canceló: devuelve {formatPrice(p.total)} en la pasarela y anota la referencia.</p>
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Referencia del reembolso" minLength={3} maxLength={100} required />
              <button className="btn btn--dark btn--xs">Registrar reembolso</button>
            </form>
          )}
          {p.reembolso?.estado === 'hecho' && <p className="form-ok">Reembolso hecho · referencia {p.reembolso.referencia}</p>}
          {error && <p className="form-alert" role="alert">{error}</p>}
          <table className="admin-table">
            <thead><tr><th>Producto</th><th className="num">Cant.</th><th className="num">Precio</th><th className="num">Subtotal</th></tr></thead>
            <tbody>
              {p.items.map((i) => (
                <tr key={i.variante_id}>
                  <td><strong>{i.nombre}</strong><small>{i.etiqueta}</small></td>
                  <td className="num">{i.cantidad}</td>
                  <td className="num">{formatPrice(i.precio_unitario)}</td>
                  <td className="num">{formatPrice(i.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="pedido__totales">
            <div><dt>Subtotal</dt><dd>{formatPrice(p.subtotal)}</dd></div>
            {p.descuento > 0 && <div><dt>Descuento {p.cupon && `(${p.cupon})`}</dt><dd>−{formatPrice(p.descuento)}</dd></div>}
            <div><dt>Envío</dt><dd>{p.envio ? formatPrice(p.envio) : 'Gratis'}</dd></div>
            <div><dt><strong>Total</strong></dt><dd><strong>{formatPrice(p.total)}</strong></dd></div>
          </dl>
        </div>
        <div className="admin-card">
          <h2>Cliente y entrega</h2>
          <p className="patient__meta"><strong>{p.contacto.nombre}</strong></p>
          <p className="patient__meta"><a href={`tel:${p.contacto.telefono}`}>{p.contacto.telefono}</a> · <a href={`mailto:${p.contacto.email}`}>{p.contacto.email}</a></p>
          <p className="patient__meta">
            {p.metodo_entrega === 'retiro' ? <>Retiro en <strong>{p.sede}</strong></>
              : <>Envío a <strong>{p.direccion.direccion}, {p.direccion.ciudad}</strong>{p.direccion.notas && ` (${p.direccion.notas})`}</>}
          </p>
          <h3 className="clinical__title">Historial</h3>
          <ol className="timeline">
            {p.historial.map((h, n) => (
              <li key={n}>
                <strong>{STATUS[h.estado_nuevo]?.label ?? h.estado_nuevo}</strong>
                <small>{formatDate(h.fecha)}{h.comentario ? ` · ${h.comentario}` : ''}</small>
              </li>
            ))}
          </ol>
          <p className="mono order-id">ID: {p.id}</p>
        </div>
      </div>
      {dialogo && (
        <ConfirmDialog title={dialogo === 'cancelado' ? 'Cancelar pedido' : `Pasar a «${STATUS[dialogo].label}»`} onClose={() => setDialogo(null)}
          peligro={dialogo === 'cancelado'} confirmLabel={dialogo === 'cancelado' ? 'Cancelar pedido' : 'Confirmar'}
          motivos={dialogo === 'cancelado' ? MOTIVOS_CANCELAR : null} requiereMotivo={dialogo === 'cancelado'}
          text={dialogo === 'cancelado'
            ? `El stock vuelve al catálogo y el cliente recibe el motivo por correo.${COBRADOS.includes(p.estado) ? ` Ya está cobrado: quedará un reembolso pendiente de ${formatPrice(p.total)}.` : ''}`
            : `#${shortId(p.id)} · ${p.contacto.nombre}. El cliente recibe un correo con el estado nuevo.`}
          onConfirm={(comentario) => cambiar(dialogo, comentario)} />
      )}
    </>
  )
}
