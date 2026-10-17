import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { CalendarHeart, MapPin } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import AccountBar from '../../components/AccountBar'
import Loading from '../../components/Loading'
import { useAuth } from '../../context/useAuth'
import { api } from '../../api'
import PetIcon from '../../components/PetIcon'
import { CITA_STATUS, formatCita } from './citas'

export default function Appointments() {
  const { user, checking } = useAuth()
  const [citas, setCitas] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    api('/api/citas').then((d) => setCitas(d.citas)).catch((e) => setError(e.message))
  }, [user])

  if (checking) return <Loading />
  if (!user) return <Navigate to="/cuenta" state={{ from: '/cuenta/citas' }} replace />

  // El servidor manda de la más lejana a la más antigua: las próximas se muestran en orden de llegada.
  const ahora = new Date()
  const activa = (c) => ['pendiente', 'confirmada'].includes(c.estado) && new Date(c.inicio) > ahora
  const proximas = citas?.filter(activa).reverse() || []
  const pasadas = citas?.filter((c) => !activa(c)) || []
  const replace = (c) => setCitas((l) => l.map((x) => (x.id === c.id ? c : x)))

  return (
    <>
      <PageHeader title="Mis citas" text="Tus reservas en la clínica, la guardería y con los paseadores." />
      <section className="section">
        <div className="container">
          <AccountBar />
          {error && <p className="form-alert">{error}</p>}
          {!citas && !error && <Loading />}
          {citas && citas.length === 0 && (
            <div className="empty-state">
              <CalendarHeart size={56} />
              <h3>Todavía no tienes citas</h3>
              <Link to="/contacto#reservar" className="btn btn--primary">Reservar una cita</Link>
            </div>
          )}
          {citas && citas.length > 0 && (
            <>
              <div className="citas__head">
                <h2>Próximas</h2>
                <Link to="/contacto#reservar" className="btn btn--primary btn--sm">Nueva cita</Link>
              </div>
              {proximas.length === 0 ? (
                <p className="booking__muted">No tienes citas próximas.</p>
              ) : (
                <ul className="citas">{proximas.map((c) => <CitaRow key={c.id} cita={c} onChange={replace} />)}</ul>
              )}
              {pasadas.length > 0 && (
                <>
                  <h2 className="citas__title">Historial</h2>
                  <ul className="citas citas--past">{pasadas.map((c) => <CitaRow key={c.id} cita={c} />)}</ul>
                </>
              )}
            </>
          )}
        </div>
      </section>
    </>
  )
}

function CitaRow({ cita, onChange }) {
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const status = CITA_STATUS[cita.estado]

  const cancelar = async () => {
    setSending(true)
    setError('')
    try {
      const d = await api(`/api/citas/${cita.id}/cancelar`, { method: 'POST' })
      onChange(d.cita)
    } catch (e) {
      setError(e.message)
      setConfirming(false)
    } finally {
      setSending(false)
    }
  }

  return (
    <li className="cita">
      <span className="cita__icon"><PetIcon especie={cita.mascota.especie} size={26} /></span>
      <span className="cita__main">
        <strong>{cita.servicio.nombre} · {cita.mascota.nombre}</strong>
        <small>{formatCita(cita.inicio)}</small>
        <small><MapPin size={14} /> {cita.sede.nombre}</small>
        {error && <small className="field-error">{error}</small>}
      </span>
      <span className="cita__side">
        <span className={`status status--${status.tone}`}>{status.label}</span>
        {onChange && cita.puede_cancelar && !confirming && (
          <button className="link-btn" onClick={() => setConfirming(true)}>Cancelar cita</button>
        )}
        {onChange && !cita.puede_cancelar && ['pendiente', 'confirmada'].includes(cita.estado) && (
          <small className="booking__muted">Para cambiarla, llámanos.</small>
        )}
        {confirming && (
          <span className="cita__confirm">
            ¿Seguro?
            <button className="btn btn--dark btn--sm" onClick={cancelar} disabled={sending}>{sending ? 'Cancelando…' : 'Sí, cancelar'}</button>
            <button className="link-btn" onClick={() => setConfirming(false)} disabled={sending}>No</button>
          </span>
        )}
      </span>
    </li>
  )
}
