import { useEffect, useState } from 'react'
import { Carne } from '../../components/VaccineTable'
import { Link, Navigate } from 'react-router-dom'
import { CalendarPlus, PawPrint, Plus, Syringe, CalendarClock } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import AccountBar from '../../components/AccountBar'
import Loading from '../../components/Loading'
import PetForm from '../../components/PetForm'
import { useAuth } from '../../context/useAuth'
import { api } from '../../api'
import PetIcon from '../../components/PetIcon'
import { ESPECIES, edad, formatCita } from './citas'
import { fechaCorta } from './vacunas'

export default function Pets() {
  const { user, checking } = useAuth()
  const [mascotas, setMascotas] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // id, 'nueva' o null

  useEffect(() => {
    if (!user) return
    api('/api/citas/mascotas').then((d) => setMascotas(d.mascotas)).catch((e) => setError(e.message))
  }, [user])

  if (checking) return <Loading />
  if (!user) return <Navigate to="/cuenta" state={{ from: '/cuenta/mascotas' }} replace />

  const saved = (m) => {
    setMascotas((l) => (l.some((x) => x.id === m.id) ? l.map((x) => (x.id === m.id ? m : x)) : [...l, m]))
    setEditing(null)
  }

  return (
    <>
      <PageHeader compact title="Mis mascotas" text="Sus datos nos ayudan a atenderlas mejor. Solo tú y el equipo de Huellitas los ven." />
      <section className="section">
        <div className="container">
          <AccountBar />
          {error && <p className="form-alert">{error}</p>}
          {!mascotas && !error && <Loading />}
          {mascotas && (
            <>
              {mascotas.length === 0 && editing !== 'nueva' && (
                <div className="empty-state">
                  <PawPrint size={56} />
                  <h3>Aún no registras mascotas</h3>
                  <button className="btn btn--primary" onClick={() => setEditing('nueva')}>Agregar mascota</button>
                </div>
              )}
              <ul className="pets">
                {mascotas.map((m) =>
                  editing === m.id ? (
                    <li key={m.id} className="pet pet--editing">
                      <PetForm mascota={m} onSaved={saved} onCancel={() => setEditing(null)} />
                    </li>
                  ) : (
                    <PetCard key={m.id} mascota={m} onEdit={() => setEditing(m.id)}
                      onRemoved={() => setMascotas((l) => l.filter((x) => x.id !== m.id))} />
                  ),
                )}
                {editing === 'nueva' && (
                  <li className="pet pet--editing">
                    <h3>Nueva mascota</h3>
                    <PetForm onSaved={saved} onCancel={() => setEditing(null)} />
                  </li>
                )}
              </ul>
              {mascotas.length > 0 && editing !== 'nueva' && (
                <button className="btn btn--primary btn--sm pets__add" onClick={() => setEditing('nueva')}>
                  <Plus size={18} /> Agregar mascota
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </>
  )
}

function PetCard({ mascota: m, onEdit, onRemoved }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [carne, setCarne] = useState(null) // null cerrado, 'cargando' o la lista de vacunas
  const detalle = [
    ESPECIES.find((e) => e.value === m.especie)?.label,
    m.raza,
    m.sexo === 'macho' ? 'Macho' : m.sexo === 'hembra' ? 'Hembra' : null,
    edad(m.fecha_nacimiento),
    m.peso_kg ? `${m.peso_kg} kg` : null,
    m.esterilizado === true ? 'Esterilizado' : m.esterilizado === false ? 'Sin esterilizar' : null,
    m.color,
  ].filter(Boolean)

  const quitar = async () => {
    setError('')
    try {
      await api(`/api/citas/mascotas/${m.id}`, { method: 'DELETE' })
      onRemoved()
    } catch (e) {
      setError(e.message)
      setConfirming(false)
    }
  }

  const verCarne = () => {
    if (carne) return setCarne(null)
    setCarne('cargando')
    api(`/api/citas/mascotas/${m.id}/carne`).then((d) => setCarne(d.vacunas)).catch((e) => { setError(e.message); setCarne(null) })
  }

  return (
    <li className="pet">
      <span className="cita__icon"><PetIcon especie={m.especie} size={28} /></span>
      <span className="cita__main">
        <strong>{m.nombre}</strong>
        <small>{detalle.join(' · ')}</small>
        {m.alergias && <small className="alert-badge">Alergias: {m.alergias}</small>}
        {m.enfermedades_cronicas && <small className="alert-badge alert-badge--soft">Crónico: {m.enfermedades_cronicas}</small>}
        {m.notas && <small className="pet__notes">{m.notas}</small>}
        {m.microchip && <small>Microchip: <span className="mono">{m.microchip}</span></small>}
        {m.proxima_cita && <small className="pet__next"><CalendarClock size={14} /> {m.proxima_cita.servicio}: {formatCita(m.proxima_cita.inicio)}</small>}
        {m.proxima_vacuna && <small className="pet__next"><Syringe size={14} /> {m.proxima_vacuna.nombre}: {fechaCorta(m.proxima_vacuna.fecha)}</small>}
        {error && <small className="field-error">{error}</small>}
      </span>
      <span className="cita__side">
        {confirming ? (
          <span className="cita__confirm">
            ¿Quitar a {m.nombre}?
            <button className="btn btn--dark btn--sm" onClick={quitar}>Sí, quitar</button>
            <button className="link-btn" onClick={() => setConfirming(false)}>No</button>
          </span>
        ) : (
          <span className="pet__actions">
            <Link to={`/reservar?mascota=${m.id}`} className="btn btn--primary btn--xs"><CalendarPlus size={14} /> Reservar para {m.nombre}</Link>
            <button className="btn btn--ghost btn--xs" onClick={verCarne} aria-expanded={Boolean(carne)}>{carne ? 'Ocultar carné' : 'Carné'}</button>
            <button className="btn btn--ghost btn--xs" onClick={onEdit}>Editar</button>
            <button className="link-btn link-btn--danger" onClick={() => setConfirming(true)}>Quitar</button>
          </span>
        )}
      </span>
      {carne && (
        <div className="pet__carne">
          {carne === 'cargando' ? <Loading /> : <Carne vacunas={carne} />}
          <p className="summary__hint">Las vacunas y desparasitaciones las registra el veterinario. Te avisaremos antes de cada refuerzo.</p>
        </div>
      )}
    </li>
  )
}
