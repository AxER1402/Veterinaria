import { useEffect, useState } from 'react'
import Loading from '../../components/Loading'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { STATUS } from '../account/orderStatus'

export default function AdminResumen() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api('/api/pedidos/admin/resumen'), api('/api/auditoria/resumen'), api('/api/auditoria/integridad')])
      .then(([ventas, auditoria, integridad]) => setData({ ventas, auditoria, integridad }))
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="form-alert">{error}</p>
  if (!data) return <Loading />
  const { ventas, auditoria, integridad } = data
  const pendientes = ventas.por_estado.find((e) => e.estado === 'pendiente_pago')?.pedidos ?? 0
  const fraudes = auditoria.por_evento.filter((e) => e.resultado === 'FRAUDE').reduce((n, e) => n + Number(e.total), 0)

  return (
    <>
      <div className="stat-tiles">
        <Stat label="Ventas cobradas" value={formatPrice(ventas.ventas)} />
        <Stat label="Pedidos pendientes de pago" value={pendientes} />
        <Stat label="Clientes con pedidos" value={ventas.clientes_con_pedidos} />
        <Stat label="Eventos de auditoría" value={auditoria.total} note={`${auditoria.tipos_de_evento} tipos · ${fraudes} marcados como fraude`} />
        <Stat label="Integridad de la bitácora" value={integridad.integra ? 'Íntegra' : 'ALTERADA'} tone={integridad.integra ? 'ok' : 'bad'}
          note={integridad.integra ? `${integridad.revisados} registros verificados` : `Primer registro alterado: #${integridad.primer_registro_alterado}`} />
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
                  <td><span className={`status status--${STATUS[e.estado].tone}`}>{STATUS[e.estado].label}</span></td>
                  <td className="num">{e.pedidos}</td>
                  <td className="num">{formatPrice(e.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, note, tone }) {
  return (
    <div className={`stat-tile ${tone ? `stat-tile--${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  )
}

// Ventas cobradas por día (últimos 14 días). Una sola serie: sin leyenda, el título la nombra.
function SalesChart({ days }) {
  const [hover, setHover] = useState(null)
  const [asTable, setAsTable] = useState(false)
  const series = lastDays(14).map((dia) => days.find((d) => d.dia === dia) ?? { dia, pedidos: 0, monto: 0 })
  const max = Math.max(1, ...series.map((d) => d.monto))
  const W = 560, H = 200, pad = { l: 44, r: 8, t: 12, b: 26 }
  const band = (W - pad.l - pad.r) / series.length
  const bar = Math.min(24, band - 2)
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const ticks = [0, max / 2, max]

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
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ventas cobradas por día en los últimos 14 días">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="chart__grid" />
                <text x={pad.l - 6} y={y(t) + 4} className="chart__tick" textAnchor="end">${Math.round(t)}</text>
              </g>
            ))}
            {series.map((d, i) => {
              const x = pad.l + i * band + (band - bar) / 2
              const h = H - pad.b - y(d.monto)
              return (
                <g key={d.dia} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  {/* zona de hover más grande que la barra */}
                  <rect x={pad.l + i * band} y={pad.t} width={band} height={H - pad.t - pad.b} fill="transparent" />
                  {d.monto > 0 && <path d={roundedTop(x, H - pad.b - h, bar, h)} className={`chart__bar ${hover === i ? 'is-hover' : ''}`} />}
                  {i % 2 === 0 && <text x={x + bar / 2} y={H - 8} className="chart__tick" textAnchor="middle">{d.dia.slice(8)}/{d.dia.slice(5, 7)}</text>}
                </g>
              )
            })}
            <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="chart__axis" />
          </svg>
          {hover !== null && (
            <div className="chart__tooltip" style={tooltipPos((pad.l + hover * band + band / 2) / W)}>
              <strong>{series[hover].dia}</strong>
              <span>{formatPrice(series[hover].monto)} · {series[hover].pedidos} {series[hover].pedidos === 1 ? 'pedido' : 'pedidos'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Cerca de los bordes el tooltip se ancla a un lado para no salirse de la tarjeta.
function tooltipPos(f) {
  const left = `${f * 100}%`
  if (f > 0.75) return { left, transform: 'translateX(-100%)' }
  if (f < 0.25) return { left, transform: 'none' }
  return { left }
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

// Barra con 4px de radio en el extremo de datos y esquinas rectas en la base.
function roundedTop(x, y, w, h) {
  const r = Math.min(4, h, w / 2)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}
