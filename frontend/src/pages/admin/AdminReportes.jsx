import { useState } from 'react'
import { CalendarDays, FileDown, Package, Receipt, Tags, Users } from 'lucide-react'
import DateInput from '../../components/DateInput'
import { api } from '../../api'
import { useAuth } from '../../context/useAuth'
import { formatPrice } from '../../data/shop'
import { METODOS_PAGO } from '../../data/recibos'
import { CITA_STATUS, addDays, ymd } from '../account/citas'
import { STATUS, formatDate, shortId } from '../account/orderStatus'
import { descargarPdf } from './reportePdf'

const CLINICA = ['admin', 'veterinario', 'recepcion']
const TIENDA = ['admin', 'tienda']
const ESTADO_CITA = { ...Object.fromEntries(Object.entries(CITA_STATUS).map(([k, v]) => [k, v.label])), por_revisar: 'Por revisar' }
const ESTADO_COBRO = { pagado: 'Pagado', anulado: 'Anulado' }
const hora = (f) => new Intl.DateTimeFormat('es-GT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(f))
const fechaLarga = (d) => new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium' }).format(new Date(`${d}T12:00:00`))
const periodoDe = (desde, hasta) => (desde === hasta ? fechaLarga(desde) : `Del ${fechaLarga(desde)} al ${fechaLarga(hasta)}`)
const LIMITE = 'El periodo tiene más de 5,000 registros: este reporte solo muestra los primeros. Elige un periodo más corto.'

// Cada reporte pide sus datos y los pasa a descargarPdf. Devuelve false si no hay nada que incluir.
const REPORTES = [
  {
    id: 'caja', titulo: 'Caja', icono: Receipt, roles: CLINICA, periodo: true,
    texto: 'Lo cobrado en la clínica, el total por método de pago y los cobros anulados.',
    async generar({ desde, hasta, usuario }) {
      const d = await api(`/api/citas/admin/reportes/caja?desde=${desde}&hasta=${hasta}`)
      if (!d.cobros.length) return false
      await descargarPdf({
        titulo: 'Reporte de caja', periodo: periodoDe(desde, hasta), usuario, archivo: `huellitas-caja-${desde}-a-${hasta}.pdf`, nota: d.truncado ? LIMITE : null, horizontal: true,
        resumen: [{ label: 'Total recibido', valor: formatPrice(d.total) }, ...Object.entries(METODOS_PAGO).filter(([k]) => k !== 'otro' || d.por_metodo.otro > 0).map(([k, v]) => ({ label: v, valor: formatPrice(d.por_metodo[k]) }))],
        columnas: [{ titulo: 'Recibo', campo: 'recibo', ancho: 62 }, { titulo: 'Fecha', campo: 'fecha', ancho: 108 }, { titulo: 'Cliente', campo: 'cliente' }, { titulo: 'Mascota', campo: 'mascota', ancho: 80 }, { titulo: 'Conceptos', campo: 'conceptos' }, { titulo: 'Método', campo: 'metodo', ancho: 72 }, { titulo: 'Estado', campo: 'estado', ancho: 56 }, { titulo: 'Total', campo: 'total', derecha: true, ancho: 70 }],
        filas: d.cobros.map((c) => ({ ...c, fecha: hora(c.fecha), metodo: METODOS_PAGO[c.metodo] || '', estado: ESTADO_COBRO[c.estado], total: formatPrice(c.total) })),
      })
    },
  },
  {
    id: 'citas', titulo: 'Citas', icono: CalendarDays, roles: CLINICA, periodo: true,
    texto: 'Las citas del periodo con su mascota, servicio, profesional y estado. No incluye datos clínicos.',
    async generar({ desde, hasta, usuario }) {
      const d = await api(`/api/citas/admin/reportes/citas?desde=${desde}&hasta=${hasta}`)
      if (!d.citas.length) return false
      const n = (e) => d.por_estado[e] || 0
      await descargarPdf({
        titulo: 'Reporte de citas', periodo: periodoDe(desde, hasta), usuario, archivo: `huellitas-citas-${desde}-a-${hasta}.pdf`, nota: d.truncado ? LIMITE : null, horizontal: true,
        resumen: [{ label: 'Total', valor: d.citas.length }, { label: 'Atendidas', valor: n('atendida') }, { label: 'Por atender', valor: n('pendiente') + n('confirmada') }, { label: 'No asistieron', valor: n('no_asistio') }, { label: 'Por revisar', valor: n('por_revisar') }, { label: 'Canceladas', valor: n('cancelada') }],
        columnas: [{ titulo: 'Fecha', campo: 'inicio', ancho: 108 }, { titulo: 'Mascota', campo: 'mascota', ancho: 80 }, { titulo: 'Cliente', campo: 'cliente' }, { titulo: 'Servicio', campo: 'servicio', ancho: 100 }, { titulo: 'Profesional', campo: 'profesional', ancho: 100 }, { titulo: 'Sede', campo: 'sede' }, { titulo: 'Estado', campo: 'estado', ancho: 80 }],
        filas: d.citas.map((c) => ({ ...c, inicio: hora(c.inicio), estado: ESTADO_CITA[c.estado], sede: c.sede.split(' · ')[0] })),
      })
    },
  },
  {
    id: 'ventas', titulo: 'Ventas de la tienda', icono: Package, roles: TIENDA, periodo: true,
    texto: 'Los pedidos del periodo, lo cobrado y los reembolsos pendientes.',
    async generar({ desde, hasta, usuario }) {
      const d = await api(`/api/pedidos/admin/reportes/ventas?desde=${desde}&hasta=${hasta}`)
      if (!d.pedidos.length) return false
      await descargarPdf({
        titulo: 'Reporte de ventas', periodo: periodoDe(desde, hasta), usuario, archivo: `huellitas-ventas-${desde}-a-${hasta}.pdf`, nota: d.truncado ? LIMITE : null,
        resumen: [{ label: 'Total cobrado', valor: formatPrice(d.cobrado) }, { label: 'Pedidos cobrados', valor: d.pedidos_cobrados }, { label: 'Pedidos en total', valor: d.pedidos.length }, { label: 'Reembolsos pendientes', valor: d.pedidos.filter((p) => p.reembolso === 'pendiente').length }],
        columnas: [{ titulo: 'Pedido', campo: 'id', ancho: 66 }, { titulo: 'Fecha', campo: 'fecha', ancho: 118 }, { titulo: 'Cliente', campo: 'cliente' }, { titulo: 'Entrega', campo: 'entrega', ancho: 60 }, { titulo: 'Estado', campo: 'estado', ancho: 90 }, { titulo: 'Total', campo: 'total', derecha: true, ancho: 70 }],
        filas: d.pedidos.map((p) => ({ ...p, id: `#${shortId(p.id)}`, fecha: formatDate(p.fecha), entrega: p.entrega === 'retiro' ? 'Retiro' : 'Domicilio', estado: STATUS[p.estado]?.label + (p.reembolso === 'pendiente' ? ' · reembolso pendiente' : ''), total: formatPrice(p.total) })),
      })
    },
  },
  {
    id: 'inventario', titulo: 'Inventario', icono: Tags, roles: TIENDA,
    texto: 'Cada presentación del catálogo con su SKU, precio y existencias.',
    async generar({ usuario, hoy }) {
      const d = await api('/api/catalogo/admin/productos')
      const filas = d.productos.flatMap((p) => p.variantes.map((v) => ({ producto: p.nombre, marca: p.marca, presentacion: v.etiqueta, sku: v.sku, precio: formatPrice(v.precio), stock: Number(v.stock), visible: p.activo ? 'Sí' : 'No' })))
      if (!filas.length) return false
      await descargarPdf({
        titulo: 'Reporte de inventario', periodo: `Existencias al ${fechaLarga(hoy)}`, usuario, archivo: `huellitas-inventario-${hoy}.pdf`, horizontal: true, datosPersonales: false,
        resumen: [{ label: 'Presentaciones', valor: filas.length }, { label: 'Unidades', valor: filas.reduce((n, f) => n + f.stock, 0).toLocaleString('es-GT') }, { label: 'Agotadas', valor: filas.filter((f) => f.stock === 0).length }, { label: 'Valor a precio de venta', valor: formatPrice(d.productos.flatMap((p) => p.variantes).reduce((n, v) => n + Number(v.precio) * Number(v.stock), 0)) }],
        columnas: [{ titulo: 'Producto', campo: 'producto' }, { titulo: 'Marca', campo: 'marca', ancho: 90 }, { titulo: 'Presentación', campo: 'presentacion', ancho: 90 }, { titulo: 'SKU', campo: 'sku', ancho: 80 }, { titulo: 'Precio', campo: 'precio', derecha: true, ancho: 70 }, { titulo: 'Existencias', campo: 'stock', derecha: true, ancho: 66 }, { titulo: 'En la tienda', campo: 'visible', ancho: 62 }],
        filas,
      })
    },
  },
  {
    id: 'clientes', titulo: 'Clientes', icono: Users, roles: ['admin'],
    texto: 'Nombre, correo, estado y fecha de alta de cada cliente. Queda registrado en la bitácora.',
    async generar({ usuario, hoy }) {
      const d = await api('/api/auth/admin/clientes/exportar')
      if (!d.clientes.length) return false
      await descargarPdf({
        titulo: 'Reporte de clientes', periodo: `Al ${fechaLarga(hoy)}`, usuario, archivo: `huellitas-clientes-${hoy}.pdf`,
        resumen: [{ label: 'Clientes', valor: d.clientes.length }, { label: 'Activos', valor: d.clientes.filter((c) => c.activo).length }],
        columnas: [{ titulo: 'Nombre', campo: 'nombre' }, { titulo: 'Correo', campo: 'email' }, { titulo: 'Estado', campo: 'estado', ancho: 60 }, { titulo: 'Alta', campo: 'creado', ancho: 70 }],
        filas: d.clientes.map((c) => ({ ...c, estado: c.activo ? 'Activo' : 'Inactivo', creado: fechaLarga(c.creado) })),
      })
    },
  },
]

// Reportes en PDF. Cada rol ve los suyos; el servidor vuelve a revisar el permiso de cada dato.
export default function AdminReportes() {
  const { user } = useAuth()
  const hoy = ymd(new Date())
  const primeroDelMes = `${hoy.slice(0, 8)}01`
  const [desde, setDesde] = useState(primeroDelMes)
  const [hasta, setHasta] = useState(hoy)
  const [generando, setGenerando] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  const rangoValido = desde && hasta && desde <= hasta
  const visibles = REPORTES.filter((r) => r.roles.includes(user.rol))
  const rapidos = [
    { label: 'Hoy', desde: hoy, hasta: hoy },
    { label: 'Últimos 7 días', desde: ymd(addDays(new Date(), -6)), hasta: hoy },
    { label: 'Este mes', desde: primeroDelMes, hasta: hoy },
    (() => {
      const fin = addDays(new Date(`${primeroDelMes}T12:00:00`), -1)
      return { label: 'Mes pasado', desde: `${ymd(fin).slice(0, 8)}01`, hasta: ymd(fin) }
    })(),
  ]

  const generar = async (r) => {
    setError('')
    setAviso('')
    setGenerando(r.id)
    try {
      const hubo = await r.generar({ desde, hasta, hoy, usuario: user.email })
      setAviso(hubo === false ? `${r.titulo}: no hay datos para incluir.` : `${r.titulo}: PDF descargado.`)
    } catch (e) {
      setError(e.message || 'No se pudo generar el PDF')
    } finally {
      setGenerando(null)
    }
  }

  return (
    <>
      <div className="reportes__periodo">
        <div className="segmentos" role="group" aria-label="Periodo rápido">
          {rapidos.map((p) => (
            <button key={p.label} type="button" className={desde === p.desde && hasta === p.hasta ? 'is-activo' : ''} aria-pressed={desde === p.desde && hasta === p.hasta}
              onClick={() => { setDesde(p.desde); setHasta(p.hasta) }}>{p.label}</button>
          ))}
        </div>
        <label className="barra__fecha">Desde <DateInput value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="barra__fecha">Hasta <DateInput value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>
      {!rangoValido && <p className="form-alert" role="alert">La fecha inicial debe ser anterior o igual a la final.</p>}
      {error && <p className="form-alert" role="alert">{error}</p>}
      {aviso && <p className="form-ok" role="status">{aviso}</p>}
      <ul className="reportes">
        {visibles.map((r) => {
          const Icono = r.icono
          return (
            <li key={r.id} className="reporte">
              <span className="reporte__icono"><Icono size={22} aria-hidden="true" /></span>
              <div className="reporte__texto">
                <h2>{r.titulo}</h2>
                <p>{r.texto}</p>
                <small>{r.periodo ? 'Usa el periodo elegido arriba' : 'Datos de hoy'}</small>
              </div>
              <button className="btn btn--dark btn--xs" disabled={generando !== null || (r.periodo && !rangoValido)} onClick={() => generar(r)}>
                <FileDown size={15} aria-hidden="true" /> {generando === r.id ? 'Generando…' : 'Descargar PDF'}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="summary__hint">Para un recibo o comprobante suelto, usa Imprimir y elige «Guardar como PDF».</p>
    </>
  )
}
