import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Loading from '../../components/Loading'
import NotFound from '../NotFound'
import { useAuth } from '../../context/useAuth'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { STATUS, shortId, formatDate } from './orderStatus'
import PaymentPanel from '../../components/shop/PaymentPanel'

export default function OrderDetail() {
  const { id } = useParams()
  const { user, checking } = useAuth()
  const [order, setOrder] = useState(null)
  const [error, setError] = useState(null)
  const [cancelando, setCancelando] = useState(false)
  const [cancelError, setCancelError] = useState('')

  useEffect(() => {
    if (!user) return
    api(`/api/pedidos/${id}`).then((d) => setOrder(d.pedido)).catch(setError)
  }, [id, user])

  if (checking) return <Loading />
  if (!user) return <Navigate to="/cuenta" state={{ from: `/cuenta/pedidos/${id}` }} replace />
  if (error?.status === 404) return <NotFound />
  if (error) return <p className="container form-alert">{error.message}</p>
  if (!order) return <Loading />

  const status = STATUS[order.estado]
  const cancelar = async () => {
    setCancelError('')
    try {
      setOrder((await api(`/api/pedidos/${order.id}/cancelar`, { method: 'POST' })).pedido)
    } catch (e) {
      setCancelError(e.message)
    } finally {
      setCancelando(false)
    }
  }
  return (
    <>
      <PageHeader title={`Pedido #${shortId(order.id)}`} text={formatDate(order.fecha)} />
      <section className="section">
        <div className="container cart-layout">
          <div>
            <p><span className={`status status--${status.tone}`}>{status.label}</span></p>
            {order.estado === 'pendiente_pago' && <PaymentPanel order={order} onPaid={setOrder} />}
            {order.estado === 'pendiente_pago' && (
              <p className="order__cancel">
                {cancelando ? (
                  <>¿Cancelar el pedido? Los productos vuelven a la tienda.{' '}
                    <button className="btn btn--dark btn--xs" onClick={cancelar}>Sí, cancelar</button>{' '}
                    <button className="link-btn" onClick={() => setCancelando(false)}>No</button></>
                ) : <button className="link-btn link-btn--danger" onClick={() => setCancelando(true)}>Cancelar este pedido</button>}
                {cancelError && <small className="field-error">{cancelError}</small>}
              </p>
            )}
            {order.reembolso && (
              <p className={order.reembolso.estado === 'hecho' ? 'form-ok' : 'form-alert form-alert--soft'}>
                {order.reembolso.estado === 'hecho'
                  ? `Te devolvimos ${formatPrice(order.total)} (referencia ${order.reembolso.referencia}). Según tu banco puede tardar unos días en verse.`
                  : `Este pedido se canceló después de pagarse: te devolveremos ${formatPrice(order.total)} por el mismo medio de pago.`}
              </p>
            )}
            <ul className="summary__lines order-items">
              {order.items.map((i) => (
                <li key={i.variante_id}>
                  <span className="summary__thumb">
                    <img src={i.imagen} alt="" />
                    <em>{i.cantidad}</em>
                  </span>
                  <span>
                    {i.nombre}
                    <small>{i.etiqueta} · {formatPrice(i.precio_unitario)} c/u</small>
                  </span>
                  <strong>{formatPrice(i.subtotal)}</strong>
                </li>
              ))}
            </ul>
            <h3>Entrega</h3>
            <p>
              {order.metodo_entrega === 'retiro'
                ? `Retiro en ${order.sede}`
                : `${order.direccion.direccion}, ${order.direccion.ciudad}${order.direccion.notas ? ` (${order.direccion.notas})` : ''}`}
            </p>
            <h3>Historial</h3>
            <ol className="timeline">
              {order.historial.map((h, n) => (
                <li key={n}>
                  <strong>{STATUS[h.estado_nuevo]?.label ?? h.estado_nuevo}</strong>
                  <small>{formatDate(h.fecha)}{h.comentario ? ` · ${h.comentario}` : ''}</small>
                </li>
              ))}
            </ol>
            <p className="mono order-id">ID: {order.id}</p>
            <Link to="/cuenta/pedidos" className="link-arrow">← Mis pedidos</Link>
          </div>
          <aside className="summary">
            <h3>Resumen</h3>
            <dl>
              <div><dt>Subtotal</dt><dd>{formatPrice(order.subtotal)}</dd></div>
              {order.descuento > 0 && (
                <div className="summary__discount"><dt>Descuento {order.cupon && `(${order.cupon})`}</dt><dd>−{formatPrice(order.descuento)}</dd></div>
              )}
              <div><dt>Envío</dt><dd>{order.envio ? formatPrice(order.envio) : 'Gratis'}</dd></div>
              <div className="summary__total"><dt>Total</dt><dd>{formatPrice(order.total)}</dd></div>
            </dl>
          </aside>
        </div>
      </section>
    </>
  )
}
