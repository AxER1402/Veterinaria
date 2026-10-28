import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { CalendarHeart, Info, MapPin, Phone } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import AccountBar from '../../components/AccountBar'
import Loading from '../../components/Loading'
import Modal from '../../components/Modal'
import SlotPicker from '../../components/SlotPicker'
import { cuerpoReserva, eleccionLista } from '../../components/reserva'
import { useAuth } from '../../context/useAuth'
import { api } from '../../api'
import PetIcon from '../../components/PetIcon'
import { CITA_STATUS, TELEFONO_CLINICA, formatReserva } from './citas'

const TABS = [
  { id: 'proximas', label: 'Próximas' },
  { id: 'pasadas', label: 'Pasadas' },
  { id: 'canceladas', label: 'Canceladas' },
]
const tel = TELEFONO_CLINICA.replace(/[^+\d]/g, '')

export default function Appointments() {
  const { user, checking } = useAuth()
  const [citas, setCitas] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('proximas')
  const [reprogramar, setReprogramar] = useState(null)

  useEffect(() => {
    if (!user) return
    api('/api/citas').then((d) => setCitas(d.citas)).catch((e) => setError(e.message))
  }, [user])

  if (checking) return <Loading />
  if (!user) return <Navigate to="/cuenta" state={{ from: '/cuenta/citas' }} replace />

  // El servidor manda de la más lejana a la más antigua: las próximas se muestran en orden de llegada.
  const ahora = new Date()
  const activa = (c) => ['pendiente', 'confirmada'].includes(c.estado) && new Date(c.fin || c.inicio) > ahora
  const grupos = {
    proximas: citas?.filter(activa).reverse() || [],
    pasadas: citas?.filter((c) => !activa(c) && c.estado !== 'cancelada') || [],
    canceladas: citas?.filter((c) => c.estado === 'cancelada') || [],
  }
  const replace = (c) => setCitas((l) => l.map((x) => (x.id === c.id ? c : x)))

  return (
    <>
      <PageHeader compact title="Mis citas" text="Tus reservas en la clínica, la guardería y con los paseadores." />
      <section className="section">
        <div className="container">
          <AccountBar />
          {error && <p className="form-alert">{error}</p>}
          {!citas && !error && <Loading />}
          {citas && citas.length === 0 && (
            <div className="empty-state">
              <CalendarHeart size={56} />
              <h3>Todavía no tienes citas</h3>
              <Link to="/reservar" className="btn btn--primary">Reservar una cita</Link>
            </div>
          )}
          {citas && citas.length > 0 && (
            <>
              <div className="citas__head">
                <div className="tabs" role="tablist" aria-label="Mis citas">
                  {TABS.map((t) => (
                    <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'tab--active' : ''}`} onClick={() => setTab(t.id)}>
                      {t.label} <span>{grupos[t.id].length}</span>
                    </button>
                  ))}
                </div>
                <Link to="/reservar" className="btn btn--primary btn--sm">Nueva cita</Link>
              </div>
              {grupos[tab].length === 0 ? (
                <p className="booking__muted">{tab === 'proximas' ? 'No tienes citas próximas.' : tab === 'pasadas' ? 'Todavía no hay citas pasadas.' : 'No has cancelado citas.'}</p>
              ) : (
                <ul className={`citas ${tab !== 'proximas' ? 'citas--past' : ''}`}>
                  {grupos[tab].map((c) => <CitaRow key={c.id} cita={c} onChange={tab === 'proximas' ? replace : null} onReprogramar={setReprogramar} />)}
                </ul>
              )}
              <p className="citas__help">
                <Info size={16} /> El <strong>código de verificación</strong> va en el correo de cada cita: muéstralo en la sede si te lo piden
                y sirve para comprobar que la cita es tuya. Para cambiar una cita con menos de 2 horas, llámanos al{' '}
                <a href={`tel:${tel}`}>{TELEFONO_CLINICA}</a>. Si faltas a 3 citas en 3 meses, las próximas se agendan por teléfono.
              </p>
            </>
          )}
        </div>
      </section>
      {reprogramar && (
        <Reprogramar cita={reprogramar} onClose={() => setReprogramar(null)} onDone={(c) => { replace(c); setReprogramar(null) }} />
      )}
    </>
  )
}

function CitaRow({ cita, onChange, onReprogramar }) {
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
        <small>{formatReserva(cita, true)}</small>
        <small><MapPin size={14} /> {cita.sede.nombre}</small>
        {cita.codigo_verificacion && <small>Código de verificación: <span className="mono">{cita.codigo_verificacion}</span></small>}
        {error && <small className="field-error">{error}</small>}
      </span>
      <span className="cita__side">
        <span className={`status status--${status.tone}`}>{status.label}</span>
        {onChange && cita.puede_cancelar && !confirming && (
          <span className="cita__actions">
            <button className="btn btn--ghost btn--xs" onClick={() => onReprogramar(cita)}>Reprogramar</button>
            <button className="link-btn link-btn--danger" onClick={() => setConfirming(true)}>Cancelar</button>
          </span>
        )}
        {onChange && !cita.puede_cancelar && ['pendiente', 'confirmada'].includes(cita.estado) && (
          <small className="booking__muted"><Phone size={13} /> Para cambiarla, llámanos al <a href={`tel:${tel}`}>{TELEFONO_CLINICA}</a></small>
        )}
        {confirming && (
          <span className="cita__confirm">
            ¿Cancelar la cita?
            <button className="btn btn--dark btn--sm" onClick={cancelar} disabled={sending}>{sending ? 'Cancelando…' : 'Sí, cancelar'}</button>
            <button className="link-btn" onClick={() => setConfirming(false)} disabled={sending}>No</button>
          </span>
        )}
      </span>
    </li>
  )
}

// Nuevo día y hora para una cita. La usa también el panel (el servidor decide qué puede cada quien).
export function Reprogramar({ cita, onClose, onDone }) {
  const [eleccion, setEleccion] = useState({ fecha: '', hora: '', salida: '' })
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [sending, setSending] = useState(false)
  const modalidad = cita.servicio.modalidad || 'turno'

  const submit = async () => {
    setError('')
    setSending(true)
    try {
      const d = await api(`/api/citas/${cita.id}/reprogramar`, { method: 'POST', body: cuerpoReserva(modalidad, eleccion) })
      if (d.aviso) setAviso(d.aviso)
      onDone(d.cita)
    } catch (e) {
      setError(e.message)
      if (e.status === 409) setEleccion((x) => ({ ...x, hora: '' }))
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal title={`Reprogramar ${cita.servicio.nombre}`} onClose={onClose} wide dirty={Boolean(eleccion.hora || eleccion.salida) && !sending}>
      <p className="modal__sub">{cita.mascota.nombre} · ahora: {formatReserva(cita, true)}</p>
      <SlotPicker servicio={cita.servicio.slug} modalidad={modalidad} value={eleccion} onChange={setEleccion} numerado={false} />
      {aviso && <p className="form-alert form-alert--soft">{aviso}</p>}
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="pet-form__actions">
        <button className="btn btn--dark btn--sm" disabled={sending || !eleccionLista(modalidad, eleccion)} onClick={submit}>
          {sending ? 'Guardando…' : 'Cambiar la cita'}
        </button>
        <button type="button" className="link-btn" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  )
}
