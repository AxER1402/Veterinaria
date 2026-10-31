import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { Printer, Search } from 'lucide-react'
import Loading from '../../components/Loading'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { STATUS, shortId, formatDate } from '../account/orderStatus'
import DateInput from '../../components/DateInput'
import Select from '../../components/Select'

const POR_PAGINA = 50

// Lista de pedidos con búsqueda, filtros y páginas. Los cambios de estado se hacen en la ficha de cada
// pedido (/admin/pedidos/:id), con confirmación y motivo.
export default function AdminPedidos() {
  const [params, setParams] = useSearchParams()
  const filtros = { q: params.get('q') || '', estado: params.get('estado') || '', desde: params.get('desde') || '', hasta: params.get('hasta') || '',
                    reembolso: params.get('reembolso') || '', pagina: Number(params.get('pagina')) || 1 }
  const [buscar, setBuscar] = useState(filtros.q)
  const [respuesta, setRespuesta] = useState(null)
  const [error, setError] = useState('')
  const [preparar, setPreparar] = useState(null)
  const [reembolsos, setReembolsos] = useState(0)
  const clave = params.toString()

  const setFiltro = (cambios) => setParams((p) => {
    const n = new URLSearchParams(p)
    Object.entries({ pagina: '', ...cambios }).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)))
    return n
  }, { replace: true })

  const cargar = useCallback(() => {
    const q = new URLSearchParams(clave)
    q.set('limite', POR_PAGINA)
    api(`/api/pedidos/admin/todos?${q}`).then((d) => setRespuesta({ clave, ...d })).catch((e) => setError(e.message))
  }, [clave])
  const datos = respuesta?.clave === clave ? respuesta : null
  useEffect(cargar, [cargar])
  useEffect(() => {
    api('/api/pedidos/admin/resumen').then((d) => setReembolsos(d.reembolsos_pendientes)).catch(() => {})
  }, [])

  const imprimir = async () => {
    try {
      setPreparar((await api('/api/pedidos/admin/preparacion')).pedidos)
    } catch (e) {
      setError(e.message)
    }
  }

  const paginas = datos ? Math.max(1, Math.ceil(datos.total / POR_PAGINA)) : 1

  return (
    <div className="admin-card">
      <div className="admin-card__head">
        <h2>Pedidos {datos && <small>· {datos.total}</small>}</h2>
        <button className="btn btn--ghost btn--xs" onClick={imprimir}><Printer size={14} /> Lista de preparación</button>
      </div>
      {reembolsos > 0 && filtros.reembolso !== 'pendiente' && (
        <p className="form-alert">
          Hay {reembolsos} {reembolsos === 1 ? 'pedido cobrado y cancelado' : 'pedidos cobrados y cancelados'} esperando reembolso.{' '}
          <button className="link-btn" onClick={() => setFiltro({ reembolso: 'pendiente', estado: '' })}>Ver reembolsos pendientes</button>
        </p>
      )}
      <div className="admin-filters">
        <form className="search admin-search" role="search" onSubmit={(e) => { e.preventDefault(); setFiltro({ q: buscar.trim() }) }}>
          <Search size={18} />
          <input type="search" value={buscar} onChange={(e) => { setBuscar(e.target.value); if (!e.target.value) setFiltro({ q: '' }) }}
            placeholder="Código, cliente, correo o teléfono" aria-label="Buscar pedido" />
        </form>
        <Select value={filtros.estado} onChange={(e) => setFiltro({ estado: e.target.value })} aria-label="Filtrar por estado">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <label className="admin-filters__date">Desde <DateInput value={filtros.desde} onChange={(e) => setFiltro({ desde: e.target.value })} /></label>
        <label className="admin-filters__date">Hasta <DateInput value={filtros.hasta} onChange={(e) => setFiltro({ hasta: e.target.value })} /></label>
        {filtros.reembolso && <button className="chip chip--active" onClick={() => setFiltro({ reembolso: '' })}>Reembolso pendiente ✕</button>}
      </div>
      {error && <p className="form-alert">{error}</p>}
      {!datos ? !error && <Loading /> : (
        <>
          <div className="table-scroll">
            <table className="admin-table">
              <thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Entrega</th><th className="num">Total</th><th>Estado</th></tr></thead>
              <tbody>
                {datos.pedidos.map((p) => (
                  <tr key={p.id}>
                    <td><Link className="mono" to={`/admin/pedidos/${p.id}`}>#{shortId(p.id)}</Link></td>
                    <td>{formatDate(p.fecha)}</td>
                    <td><Link to={`/admin/clientes/${p.id_cliente}`}>{p.cliente}</Link></td>
                    <td>{p.metodo_entrega === 'retiro' ? 'Retiro' : 'Domicilio'}</td>
                    <td className="num">{formatPrice(p.total)}</td>
                    <td>
                      <span className={`status status--${STATUS[p.estado].tone}`}>{STATUS[p.estado].label}</span>
                      {p.reembolso === 'pendiente' && <small className="field-error">Reembolso pendiente</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {datos.pedidos.length === 0 && <p className="summary__hint">No hay pedidos con esos filtros.</p>}
          </div>
          {paginas > 1 && (
            <div className="pager">
              <button className="link-btn" disabled={filtros.pagina <= 1} onClick={() => setFiltro({ pagina: String(filtros.pagina - 1) })}>← Anterior</button>
              <span>Página {filtros.pagina} de {paginas}</span>
              <button className="link-btn" disabled={filtros.pagina >= paginas} onClick={() => setFiltro({ pagina: String(filtros.pagina + 1) })}>Siguiente →</button>
            </div>
          )}
        </>
      )}
      {preparar && <ListaPreparacion pedidos={preparar} onDone={() => setPreparar(null)} />}
    </div>
  )
}

// Hoja para juntar los productos de los pedidos pagados o en preparación.
function ListaPreparacion({ pedidos, onDone }) {
  useEffect(() => {
    document.body.classList.add('printing')
    window.addEventListener('afterprint', onDone)
    const t = setTimeout(() => window.print(), 50)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', onDone)
      document.body.classList.remove('printing')
    }
  }, [onDone])
  const total = {}
  pedidos.forEach((p) => p.items.forEach((i) => {
    const k = `${i.nombre} · ${i.etiqueta}`
    total[k] = (total[k] || 0) + i.cantidad
  }))
  return createPortal(
    <div className="print-sheet">
      <header><strong>Huellitas · Lista de preparación</strong><span>{formatDate(new Date().toISOString())}</span></header>
      <h2>Total por producto</h2>
      <ul>{Object.entries(total).map(([k, n]) => <li key={k}>☐ <b>{n} ×</b> {k}</li>)}</ul>
      {pedidos.map((p) => (
        <section key={p.id} className="print-sheet__pedido">
          <h2>#{shortId(p.id)} · {p.contacto.nombre} · {p.contacto.telefono}</h2>
          <p>{p.metodo_entrega === 'retiro' ? `Retiro en ${p.sede}` : `${p.direccion.direccion}, ${p.direccion.ciudad}${p.direccion.notas ? ` (${p.direccion.notas})` : ''}`}</p>
          <ul>{p.items.map((i) => <li key={i.variante_id}>☐ {i.cantidad} × {i.nombre} ({i.etiqueta})</li>)}</ul>
        </section>
      ))}
      {pedidos.length === 0 && <p>No hay pedidos por preparar.</p>}
    </div>,
    document.body,
  )
}
