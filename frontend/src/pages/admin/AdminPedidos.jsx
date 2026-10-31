import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight, Package, Printer, Search, Store, Truck } from 'lucide-react'
import Loading from '../../components/Loading'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { STATUS, shortId, formatDate } from '../account/orderStatus'
import DateInput from '../../components/DateInput'
import Subvistas from './Subvistas'

const Ventas = lazy(() => import('./Ventas'))

const POR_PAGINA = 50

// Lista de pedidos con búsqueda, filtros y páginas. Los cambios de estado se hacen en la ficha de cada
// pedido (/admin/pedidos/:id), con confirmación y motivo.
export default function AdminPedidos() {
  const [vista, setVista] = useState('pedidos')
  return (
    <>
      <Subvistas vistas={[{ id: 'pedidos', label: 'Pedidos' }, { id: 'ventas', label: 'Ventas' }]} activa={vista} onChange={setVista} />
      {vista === 'pedidos' ? <ListaPedidos /> : <Suspense fallback={<Loading />}><Ventas /></Suspense>}
    </>
  )
}

function ListaPedidos() {
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
    <>
      {reembolsos > 0 && filtros.reembolso !== 'pendiente' && (
        <p className="panel__aviso panel__aviso--mal">
          <span>{reembolsos === 1 ? 'Hay 1 pedido cobrado y cancelado' : `Hay ${reembolsos} pedidos cobrados y cancelados`} esperando reembolso.</span>
          <button className="link-btn" onClick={() => setFiltro({ reembolso: 'pendiente', estado: '' })}>Verlos</button>
        </p>
      )}
      <div className="filtros-estado" role="group" aria-label="Filtrar por estado">
        <button className={!filtros.estado ? 'is-activo' : ''} aria-pressed={!filtros.estado} onClick={() => setFiltro({ estado: '' })}>Todos</button>
        {Object.entries(STATUS).map(([k, v]) => (
          <button key={k} className={filtros.estado === k ? 'is-activo' : ''} aria-pressed={filtros.estado === k} onClick={() => setFiltro({ estado: k })}>{v.label}</button>
        ))}
      </div>
      <div className="barra">
        <form className="search admin-search" role="search" onSubmit={(e) => { e.preventDefault(); setFiltro({ q: buscar.trim() }) }}>
          <Search size={18} />
          <input type="search" value={buscar} onChange={(e) => { setBuscar(e.target.value); if (!e.target.value) setFiltro({ q: '' }) }}
            placeholder="Código, cliente, correo o teléfono" aria-label="Buscar pedido" />
        </form>
        <label className="barra__fecha">Desde <DateInput value={filtros.desde} onChange={(e) => setFiltro({ desde: e.target.value })} /></label>
        <label className="barra__fecha">Hasta <DateInput value={filtros.hasta} onChange={(e) => setFiltro({ hasta: e.target.value })} /></label>
        {filtros.reembolso && <button className="chip chip--active" onClick={() => setFiltro({ reembolso: '' })}>Reembolso pendiente ✕</button>}
        <button className="btn btn--ghost btn--xs barra__fin" onClick={imprimir}><Printer size={14} /> Lista de preparación</button>
      </div>
      {error && <p className="form-alert">{error}</p>}
      {!datos ? !error && <Loading /> : datos.pedidos.length === 0 ? (
        <div className="vacio"><Package size={32} aria-hidden="true" /><p>No hay pedidos con esos filtros.</p></div>
      ) : (
        <>
          <p className="barra__total barra__total--lista">{datos.total} {datos.total === 1 ? 'pedido' : 'pedidos'}</p>
          <ul className="lista">
            {datos.pedidos.map((p) => (
              <li key={p.id}>
                <Link to={`/admin/pedidos/${p.id}`} className="fila fila--pedido">
                  <span className="fila__principal"><strong>{p.cliente}</strong><small><span className="mono">#{shortId(p.id)}</span> · {formatDate(p.fecha)}</small></span>
                  <span className="fila__dato fila__dato--suave">{p.metodo_entrega === 'retiro' ? <><Store size={15} aria-hidden="true" /> Retiro</> : <><Truck size={15} aria-hidden="true" /> Domicilio</>}</span>
                  <strong className="fila__monto">{formatPrice(p.total)}</strong>
                  <span className="fila__estado">
                    <span className={`status status--${STATUS[p.estado].tone}`}>{STATUS[p.estado].label}</span>
                    {p.reembolso === 'pendiente' && <span className="status status--bad">Reembolso pendiente</span>}
                  </span>
                  <ChevronRight size={18} className="fila__flecha" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
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
    </>
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
