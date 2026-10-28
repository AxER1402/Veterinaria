import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js'
import Loading from '../../components/Loading'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { STATUS } from '../account/orderStatus'
import { formatCita, formatDay, ymd } from '../account/citas'
import { fechaCorta } from '../account/vacunas'
import { useAuth } from '../../context/useAuth'

// Solo los módulos que usa la gráfica de barras: el resto de Chart.js no entra en el bundle.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)
Chart.defaults.font.family = '"Readex Pro", system-ui, sans-serif'

const CLINICA = ['admin', 'veterinario', 'recepcion']
const TIENDA = ['admin', 'tienda']

// «Hoy»: primero lo clínico, después la tienda y al final la auditoría. Cada rol ve solo lo suyo.
export default function AdminResumen() {
  const { user } = useAuth()
  return (
    <>
      {CLINICA.includes(user.rol) && <ResumenClinico veterinario={['admin', 'veterinario'].includes(user.rol)} />}
      {TIENDA.includes(user.rol) && <ResumenTienda />}
      {user.rol === 'admin' && <ResumenAuditoria />}
    </>
  )
}

function ResumenClinico({ veterinario }) {
  const [r, setR] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api('/api/citas/admin/resumen').then(setR).catch((e) => setError(e.message))
  }, [])
  if (error) return <p className="form-alert">{error}</p>
  if (!r) return <Loading />
  const manana = ymd(new Date(Date.now() + 86400000))
  const porConfirmar = r.pendientes.reduce((n, p) => n + p.citas, 0)
  const pe = r.hoy.por_estado

  return (
    <section className="resumen">
      <h2 className="resumen__title">Clínica</h2>
      <div className="stat-tiles">
        <Stat label="Citas de hoy" to="/admin/agenda" value={r.hoy.total}
          note={`${pe.pendiente || 0} por confirmar · ${pe.confirmada || 0} confirmadas · ${pe.atendida || 0} atendidas`} />
        <Stat label="Por confirmar (7 días)" to={`/admin/agenda?fecha=${r.pendientes[0]?.fecha || manana}`} value={porConfirmar}
          tone={porConfirmar ? 'warn' : undefined}
          note={r.pendientes.length ? r.pendientes.map((p) => `${formatDay(p.fecha, true)}: ${p.citas}`).join(' · ') : 'Todo confirmado'} />
        <Stat label="Vacunas que vencen esta semana" value={r.vacunas.length} note="El aviso al dueño sale solo 7 días antes" />
        <Stat label="Faltas (14 días)" value={r.faltas.length} tone={r.faltas.length ? 'bad' : undefined} note="Citas marcadas «no asistió»" />
      </div>
      <div className="admin-grid admin-grid--even">
        <div className="admin-card">
          <h2>Vacunas y desparasitaciones por vencer</h2>
          {r.vacunas.length === 0 ? <p className="summary__hint">Ninguna vence en los próximos 7 días.</p> : (
            <ul className="resumen__list">
              {r.vacunas.map((v) => (
                <li key={`${v.mascota_id}-${v.nombre}`}>
                  <span>{veterinario ? <Link to={`/admin/pacientes/${v.mascota_id}`}>{v.mascota}</Link> : v.mascota} · {v.nombre}</span>
                  <small>{fechaCorta(v.proxima_dosis)}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="admin-card">
          <h2>Faltas recientes</h2>
          {r.faltas.length === 0 ? <p className="summary__hint">Nadie faltó en las últimas dos semanas.</p> : (
            <ul className="resumen__list">
              {r.faltas.map((c) => (
                <li key={c.id}>
                  <span><Link to={`/admin/clientes/${c.cliente.id}`}>{c.cliente.nombre}</Link> · {c.mascota.nombre} · {c.servicio.nombre}</span>
                  <small>{formatCita(c.inicio)} · <a href={`tel:${c.cliente.telefono}`}>{c.cliente.telefono}</a></small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function ResumenTienda() {
  const [ventas, setVentas] = useState(null)
  const [error, setError] = useState('')
  const [clima, setClima] = useState(null)
  useEffect(() => {
    api('/api/pedidos/admin/resumen').then(setVentas).catch((e) => setError(e.message))
    // Aparte: si el proveedor del clima falla, el resto del panel se muestra igual.
    api('/api/pedidos/admin/clima').then(setClima).catch(() => setClima(false))
  }, [])
  if (error) return <p className="form-alert">{error}</p>
  if (!ventas) return <Loading />
  const pendientes = ventas.por_estado.find((e) => e.estado === 'pendiente_pago')?.pedidos ?? 0

  return (
    <section className="resumen">
      <h2 className="resumen__title">Tienda</h2>
      <div className="stat-tiles">
        <Stat label="Ventas cobradas" value={formatPrice(ventas.ventas)} />
        <Stat label="Pedidos pendientes de pago" value={pendientes} to="/admin/pedidos?estado=pendiente_pago" />
        <Stat label="Reembolsos pendientes" value={ventas.reembolsos_pendientes} to="/admin/pedidos?reembolso=pendiente"
          tone={ventas.reembolsos_pendientes ? 'bad' : undefined} note={ventas.reembolsos_pendientes ? 'Pedidos cobrados y cancelados' : 'Ninguno'} />
        <Stat label="Clientes con pedidos" value={ventas.clientes_con_pedidos} />
        <Stat label="Clima para las entregas"
          value={clima ? `${Math.round(clima.temperatura)} °C` : clima === false ? 'No disponible' : '…'}
          note={clima ? `${clima.descripcion} · humedad ${clima.humedad}\u00a0% · viento ${clima.viento_kmh}\u00a0km/h${clima.desactualizado ? ' · último dato disponible' : ''}` : 'Ciudad de Guatemala'} />
      </div>
      <div className="admin-grid">
        <SalesChart days={ventas.por_dia} />
        <div className="admin-card">
          <h2>Pedidos por estado</h2>
          <table className="admin-table">
            <thead><tr><th>Estado</th><th className="num">Pedidos</th><th className="num">Monto</th></tr></thead>
            <tbody>
              {ventas.por_estado.map((e) => (
                <tr key={e.estado}>
                  <td><Link to={`/admin/pedidos?estado=${e.estado}`}><span className={`status status--${STATUS[e.estado].tone}`}>{STATUS[e.estado].label}</span></Link></td>
                  <td className="num">{e.pedidos}</td>
                  <td className="num">{formatPrice(e.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function ResumenAuditoria() {
  const [data, setData] = useState(null)
  useEffect(() => {
    Promise.all([api('/api/auditoria/resumen'), api('/api/auditoria/integridad')])
      .then(([auditoria, integridad]) => setData({ auditoria, integridad }))
      .catch(() => setData(false))
  }, [])
  if (!data) return data === false ? <p className="form-alert">No se pudo leer la bitácora.</p> : <Loading />
  const { auditoria, integridad } = data
  const fraudes = auditoria.por_evento.filter((e) => e.resultado === 'FRAUDE').reduce((n, e) => n + Number(e.total), 0)
  return (
    <section className="resumen">
      <h2 className="resumen__title">Seguridad</h2>
      <div className="stat-tiles">
        <Stat label="Eventos de auditoría" to="/admin/bitacora" value={auditoria.total} note={`${auditoria.tipos_de_evento} tipos · ${fraudes} marcados como fraude`} />
        <Stat label="Integridad de la bitácora" value={integridad.integra ? 'Íntegra' : 'ALTERADA'} tone={integridad.integra ? 'ok' : 'bad'}
          note={integridad.integra ? `${integridad.revisados} registros verificados` : `Primer registro alterado: #${integridad.primer_registro_alterado}`} />
      </div>
    </section>
  )
}

function Stat({ label, value, note, tone, to }) {
  const Tag = to ? Link : 'div'
  return (
    <Tag {...(to ? { to } : {})} className={`stat-tile ${tone ? `stat-tile--${tone}` : ''} ${to ? 'stat-tile--link' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </Tag>
  )
}

// Ventas cobradas por día (últimos 14 días), con Chart.js. Una sola serie: sin leyenda, el título la nombra.
function SalesChart({ days }) {
  const [asTable, setAsTable] = useState(false)
  const canvas = useRef(null)
  const series = lastDays(14).map((dia) => days.find((d) => d.dia === dia) ?? { dia, pedidos: 0, monto: 0 })
  const clave = JSON.stringify(series)

  useEffect(() => {
    if (asTable || !canvas.current) return
    const datos = JSON.parse(clave)
    const chart = new Chart(canvas.current, {
      type: 'bar',
      data: {
        labels: datos.map((d) => `${d.dia.slice(8)}/${d.dia.slice(5, 7)}`),
        datasets: [{
          data: datos.map((d) => d.monto),
          backgroundColor: '#2a78d6', hoverBackgroundColor: '#1c5fae',
          borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 24,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#002842', padding: 10, cornerRadius: 10, displayColors: false,
            callbacks: {
              title: (items) => datos[items[0].dataIndex].dia,
              label: (item) => {
                const d = datos[item.dataIndex]
                return `${formatPrice(d.monto)} · ${d.pedidos} ${d.pedidos === 1 ? 'pedido' : 'pedidos'}`
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#59606d', font: { size: 11 }, maxRotation: 0, autoSkip: true } },
          y: {
            beginAtZero: true, border: { display: false }, grid: { color: '#e8e8e6' },
            ticks: { color: '#59606d', font: { size: 11 }, maxTicksLimit: 4, callback: (v) => `Q${v}` },
          },
        },
      },
    })
    return () => chart.destroy()
  }, [clave, asTable])

  return (
    <div className="admin-card">
      <div className="admin-card__head">
        <h2>Ventas cobradas por día</h2>
        <button className="link-btn" onClick={() => setAsTable((v) => !v)}>{asTable ? 'Ver gráfico' : 'Ver tabla'}</button>
      </div>
      {asTable ? (
        <table className="admin-table">
          <thead><tr><th>Día</th><th className="num">Pedidos</th><th className="num">Ventas</th></tr></thead>
          <tbody>{series.map((d) => <tr key={d.dia}><td>{d.dia}</td><td className="num">{d.pedidos}</td><td className="num">{formatPrice(d.monto)}</td></tr>)}</tbody>
        </table>
      ) : (
        <div className="chart">
          <canvas ref={canvas} role="img" aria-label="Ventas cobradas por día en los últimos 14 días" />
        </div>
      )}
    </div>
  )
}

function lastDays(n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}
