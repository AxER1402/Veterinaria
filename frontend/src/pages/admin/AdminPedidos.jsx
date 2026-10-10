import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Loading from '../../components/Loading'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { STATUS, shortId, formatDate } from '../account/orderStatus'

// Solo para mostrar las opciones; la regla que vale es la del servidor (pedidos-service).
const NEXT = {
  pendiente_pago: ['cancelado'],
  pagado: ['preparando', 'cancelado'],
  preparando: ['enviado', 'entregado', 'cancelado'],
  enviado: ['entregado'],
  entregado: [],
  cancelado: [],
}

export default function AdminPedidos() {
  const [estado, setEstado] = useState('')
  const [pedidos, setPedidos] = useState(null)
  const [error, setError] = useState('')

  const cargar = useCallback(() => {
    api(`/api/pedidos/admin/todos?limite=100${estado ? `&estado=${estado}` : ''}`)
      .then((d) => setPedidos(d.pedidos))
      .catch((e) => setError(e.message))
  }, [estado])

  useEffect(cargar, [cargar])

  const cambiar = async (p, nuevo) => {
    const comentario = nuevo === 'cancelado' ? window.prompt('Motivo de la cancelación (opcional):') ?? '' : ''
    try {
      await api(`/api/pedidos/admin/${p.id}/estado`, { method: 'PATCH', body: { estado: nuevo, comentario } })
      setError('')
      cargar()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="admin-card">
      <div className="admin-card__head">
        <h2>Pedidos</h2>
        <select value={estado} onChange={(e) => { setPedidos(null); setEstado(e.target.value) }} aria-label="Filtrar por estado">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      {error && <p className="form-alert">{error}</p>}
      {!pedidos ? <Loading /> : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Entrega</th><th className="num">Total</th><th>Estado</th><th>Cambiar a</th></tr></thead>
            <tbody>
              {pedidos.map((p) => (
                <tr key={p.id}>
                  <td><Link className="mono" to={`/cuenta/pedidos/${p.id}`}>#{shortId(p.id)}</Link></td>
                  <td>{formatDate(p.fecha)}</td>
                  <td>{p.cliente}</td>
                  <td>{p.metodo_entrega === 'retiro' ? 'Retiro' : 'Domicilio'}</td>
                  <td className="num">{formatPrice(p.total)}</td>
                  <td><span className={`status status--${STATUS[p.estado].tone}`}>{STATUS[p.estado].label}</span></td>
                  <td>
                    {NEXT[p.estado].length ? (
                      <select value="" onChange={(e) => e.target.value && cambiar(p, e.target.value)} aria-label={`Cambiar estado de ${shortId(p.id)}`}>
                        <option value="">—</option>
                        {NEXT[p.estado]
                          .filter((n) => !(n === 'enviado' && p.metodo_entrega === 'retiro') && !(n === 'entregado' && p.estado === 'preparando' && p.metodo_entrega === 'domicilio'))
                          .map((n) => <option key={n} value={n}>{STATUS[n].label}</option>)}
                      </select>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pedidos.length === 0 && <p className="summary__hint">No hay pedidos con ese estado.</p>}
        </div>
      )}
    </div>
  )
}
