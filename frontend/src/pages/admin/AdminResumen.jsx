import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import Loading from '../../components/Loading'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { addDays, formatCita, ymd } from '../account/citas'
import { fechaCorta } from '../account/vacunas'
import { useAuth } from '../../context/useAuth'
import Stat from './Stat'

const CLINICA = ['admin', 'veterinario', 'recepcion']
const TIENDA = ['admin', 'tienda']

// «Hoy»: solo lo que pide atención. Las ventas están en Pedidos y la auditoría en Bitácora.
export default function AdminResumen() {
  const { user } = useAuth()
  return (
    <>
      {CLINICA.includes(user.rol) && <ResumenClinico veterinario={['admin', 'veterinario'].includes(user.rol)} />}
      {TIENDA.includes(user.rol) && <ResumenTienda />}
    </>
  )
}

function Bloque({ titulo, to, enlace, children }) {
  return (
    <section className="resumen">
      <header className="resumen__head">
        <h2 className="resumen__title">{titulo}</h2>
        <Link to={to} className="resumen__enlace">{enlace} <ArrowRight size={16} aria-hidden="true" /></Link>
      </header>
      {children}
    </section>
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
  const manana = ymd(addDays(new Date(), 1))
  const porConfirmar = r.pendientes.reduce((n, p) => n + p.citas, 0)
  const pe = r.hoy.por_estado

  return (
    <Bloque titulo="Clínica" to="/admin/agenda" enlace="Abrir agenda">
      <div className="stat-tiles">
        <Stat label="Citas de hoy" to="/admin/agenda" value={r.hoy.total} note={`${pe.atendida || 0} atendidas`} />
        <Stat label="Por confirmar" to={`/admin/agenda?fecha=${r.pendientes[0]?.fecha || manana}`} value={porConfirmar}
          tone={porConfirmar ? 'warn' : undefined} note="Próximos 7 días" />
        <Stat label="Vacunas por vencer" value={r.vacunas.length} note="Esta semana" />
        <Stat label="No asistieron" value={r.faltas.length} tone={r.faltas.length ? 'bad' : undefined} note="Últimos 14 días" />
      </div>
      {r.por_revisar.length > 0 && (
        <div className="admin-card resumen__revisar">
          <h2>Por revisar ({r.por_revisar.length})</h2>
          <p className="summary__hint">Citas que nadie cerró y consultas sin ficha. Una cita cerrada sola no cuenta como falta hasta que la confirmes en la agenda.</p>
          <ul className="resumen__list">
            {r.por_revisar.map((c) => (
              <li key={c.id}>
                <span><Link to={`/admin/agenda?fecha=${c.inicio.slice(0, 10)}`}>{c.mascota.nombre} · {c.servicio.nombre}</Link> · {c.cliente.nombre}</span>
                <small>{formatCita(c.inicio)} · {c.por_revisar ? 'Se cerró sola' : 'Atendida sin ficha'}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(r.vacunas.length > 0 || r.faltas.length > 0) && (
        <div className="admin-grid admin-grid--even">
          {r.vacunas.length > 0 && (
            <div className="admin-card">
              <h2>Vacunas por vencer</h2>
              <ul className="resumen__list">
                {r.vacunas.map((v) => (
                  <li key={`${v.mascota_id}-${v.nombre}`}>
                    <span>{veterinario ? <Link to={`/admin/pacientes/${v.mascota_id}`}>{v.mascota}</Link> : v.mascota} · {v.nombre}</span>
                    <small>{fechaCorta(v.proxima_dosis)}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.faltas.length > 0 && (
            <div className="admin-card">
              <h2>No asistieron</h2>
              <ul className="resumen__list">
                {r.faltas.map((c) => (
                  <li key={c.id}>
                    <span><Link to={`/admin/clientes/${c.cliente.id}`}>{c.cliente.nombre}</Link> · {c.mascota.nombre} · {c.servicio.nombre}</span>
                    <small>{formatCita(c.inicio)} · <a href={`tel:${c.cliente.telefono}`}>{c.cliente.telefono}</a></small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Bloque>
  )
}

function ResumenTienda() {
  const [ventas, setVentas] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api('/api/pedidos/admin/resumen').then(setVentas).catch((e) => setError(e.message))
  }, [])
  if (error) return <p className="form-alert">{error}</p>
  if (!ventas) return <Loading />
  const pendientes = ventas.por_estado.find((e) => e.estado === 'pendiente_pago')?.pedidos ?? 0

  return (
    <Bloque titulo="Tienda" to="/admin/pedidos" enlace="Abrir pedidos">
      <div className="stat-tiles">
        <Stat label="Ventas cobradas" value={formatPrice(ventas.ventas)} />
        <Stat label="Pendientes de pago" value={pendientes} to="/admin/pedidos?estado=pendiente_pago" />
        <Stat label="Reembolsos pendientes" value={ventas.reembolsos_pendientes} to="/admin/pedidos?reembolso=pendiente"
          tone={ventas.reembolsos_pendientes ? 'bad' : undefined} />
      </div>
    </Bloque>
  )
}
