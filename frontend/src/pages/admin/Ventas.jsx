import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js'
import Loading from '../../components/Loading'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { STATUS } from '../account/orderStatus'
import Stat from './Stat'

// Solo los módulos que usa la gráfica de barras: el resto de Chart.js no entra en el bundle.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)
Chart.defaults.font.family = '"Readex Pro", system-ui, sans-serif'

// Ventas de la tienda: vista de «Pedidos». Chart.js solo se descarga al abrirla.
export default function Ventas() {
  const [ventas, setVentas] = useState(null)
  const [error, setError] = useState('')
  const [clima, setClima] = useState(null)
  useEffect(() => {
    api('/api/pedidos/admin/resumen').then(setVentas).catch((e) => setError(e.message))
    // Aparte: si el proveedor del clima falla, el resto se muestra igual.
    api('/api/pedidos/admin/clima').then(setClima).catch(() => setClima(false))
  }, [])
  if (error) return <p className="form-alert">{error}</p>
  if (!ventas) return <Loading />

  return (
    <>
      <div className="stat-tiles">
        <Stat label="Ventas cobradas" value={formatPrice(ventas.ventas)} />
        <Stat label="Clientes con pedidos" value={ventas.clientes_con_pedidos} />
        <Stat label="Clima para las entregas"
          value={clima ? `${Math.round(clima.temperatura)} °C` : clima === false ? 'No disponible' : '…'}
          note={clima ? `${clima.descripcion} · humedad ${clima.humedad}\u00a0% · viento ${clima.viento_kmh}\u00a0km/h${clima.desactualizado ? ' · último dato disponible' : ''}` : 'Ciudad de Guatemala'} />
      </div>
      <div className="admin-grid">
        <SalesChart days={ventas.por_dia} />
        <div className="admin-card">
          <h2>Pedidos por estado</h2>
          <div className="table-scroll">
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
      </div>
    </>
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
