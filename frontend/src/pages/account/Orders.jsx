import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Package } from 'lucide-react'
import Loading from '../../components/Loading'
import CuentaMarco from '../../components/CuentaMarco'
import { useAuth } from '../../context/useAuth'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { STATUS, shortId, formatDate } from './orderStatus'

export default function Orders() {
  const { user, checking } = useAuth()
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    api('/api/pedidos').then((d) => setOrders(d.pedidos)).catch((e) => setError(e.message))
  }, [user])

  if (checking) return <Loading />
  if (!user) return <Navigate to="/cuenta" state={{ from: '/cuenta/pedidos' }} replace />

  return (
    <>
      <CuentaMarco titulo="Mis pedidos" texto="Aquí ves el estado de tus compras en la tienda.">
          {error && <p className="form-alert">{error}</p>}
          {!orders && !error && <Loading />}
          {orders && orders.length === 0 && (
            <div className="empty-state">
              <Package size={56} />
              <h3>Todavía no tienes pedidos</h3>
              <Link to="/tienda/productos" className="btn btn--primary">Ir a la tienda</Link>
            </div>
          )}
          {orders && orders.length > 0 && (
            <ul className="orders">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link to={`/cuenta/pedidos/${o.id}`} className="orders__row">
                    {o.imagen && <img src={o.imagen} alt="" />}
                    <span>
                      <strong className="mono">#{shortId(o.id)}</strong>
                      <small>{formatDate(o.fecha)} · {o.unidades} {o.unidades === 1 ? 'producto' : 'productos'}</small>
                    </span>
                    <span className={`status status--${STATUS[o.estado].tone}`}>{STATUS[o.estado].label}</span>
                    <strong>{formatPrice(o.total)}</strong>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </CuentaMarco>
    </>
  )
}
