import { useEffect, useState } from 'react'
import VaccineTable from '../../components/VaccineTable'
import { Navigate } from 'react-router-dom'
import { PawPrint, Plus } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import AccountBar from '../../components/AccountBar'
import Loading from '../../components/Loading'
import PetForm from '../../components/PetForm'
import { useAuth } from '../../context/useAuth'
import { api } from '../../api'
import PetIcon from '../../components/PetIcon'
import { ESPECIES } from './citas'

function edad(fecha) {
  if (!fecha) return null
  const n = new Date(`${fecha}T12:00:00`)
  const hoy = new Date()
  let meses = (hoy.getFullYear() - n.getFullYear()) * 12 + hoy.getMonth() - n.getMonth()
  if (hoy.getDate() < n.getDate()) meses--
  if (meses < 12) return meses <= 1 ? 'menos de 2 meses' : `${meses} meses`
  const anios = Math.floor(meses / 12)
  return anios === 1 ? '1 año' : `${anios} años`
}

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
      <PageHeader title="Mis mascotas" text="Sus datos nos ayudan a atenderlas mejor. Solo tú y el equipo de Huellitas los ven." />
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
        {m.notas && <small className="pet__notes">{m.notas}</small>}
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
          <>
            <button className="link-btn" onClick={verCarne} aria-expanded={Boolean(carne)}>{carne ? 'Ocultar carné' : 'Carné de vacunas'}</button>
            <button className="link-btn" onClick={onEdit}>Editar</button>
            <button className="link-btn" onClick={() => setConfirming(true)}>Quitar</button>
          </>
        )}
      </span>
      {carne && (
        <div className="pet__carne">
          {carne === 'cargando' ? <Loading /> : <VaccineTable vacunas={carne} />}
          <p className="summary__hint">Las vacunas las registra el veterinario en la consulta. Te avisaremos antes de cada refuerzo.</p>
        </div>
      )}
    </li>
  )
}
