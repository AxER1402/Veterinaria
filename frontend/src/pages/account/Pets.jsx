import { useEffect, useState } from 'react'
import { Carne } from '../../components/VaccineTable'
import { Link, Navigate } from 'react-router-dom'
import { CalendarPlus, PawPrint, Plus, Syringe, CalendarClock } from 'lucide-react'
import CuentaMarco from '../../components/CuentaMarco'
import MenuAcciones from '../../components/MenuAcciones'
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
    if (!user || user.rol === 'tienda') return
    api('/api/citas/mascotas').then((d) => setMascotas(d.mascotas)).catch((e) => setError(e.message))
  }, [user])

  if (checking) return <Loading />
  if (!user) return <Navigate to="/cuenta" state={{ from: '/cuenta/mascotas' }} replace />
  if (user.rol === 'tienda') return <Navigate to="/cuenta/pedidos" replace />

  const saved = (m) => {
    setMascotas((l) => (l.some((x) => x.id === m.id) ? l.map((x) => (x.id === m.id ? m : x)) : [...l, m]))
    setEditing(null)
  }

  return (
    <>
      <CuentaMarco titulo="Mis mascotas" texto="Sus datos nos ayudan a atenderlas mejor. Solo tú y el equipo de Huellitas los ven.">
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
              <ul className="mascotas">
                {mascotas.map((m) =>
                  editing === m.id ? (
                    <li key={m.id} className="mascota mascota--ancha">
                      <PetForm mascota={m} onSaved={saved} onCancel={() => setEditing(null)} />
                    </li>
                  ) : (
                    <PetCard key={m.id} mascota={m} onEdit={() => setEditing(m.id)}
                      onRemoved={() => setMascotas((l) => l.filter((x) => x.id !== m.id))} />
                  ),
                )}
                {editing === 'nueva' && (
                  <li className="mascota mascota--ancha">
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
      </CuentaMarco>
    </>
  )
}

function PetCard({ mascota: m, onEdit, onRemoved }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [carne, setCarne] = useState(null) // null cerrado, 'cargando' o la lista de vacunas
  const detalle = [
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
    <li className="mascota">
      <div className="mascota__cabeza">
        <span className="mascota__foto"><PetIcon especie={m.especie} size={32} /></span>
        <div className="mascota__nombre">
          <h2>{m.nombre}</h2>
          <p>{[ESPECIES.find((e) => e.value === m.especie)?.label, m.raza].filter(Boolean).join(' · ')}</p>
        </div>
        <MenuAcciones etiqueta={`Más opciones de ${m.nombre}`} items={[
          { label: 'Editar datos', onClick: onEdit },
          { label: `Quitar a ${m.nombre}`, onClick: () => setConfirming(true), peligro: true },
        ]} />
      </div>
      {detalle.length > 0 && <ul className="mascota__datos">{detalle.map((d) => <li key={d}>{d}</li>)}</ul>}
      {(m.alergias || m.enfermedades_cronicas) && (
        <p className="mascota__alertas">
          {m.alergias && <span className="alert-badge">Alergias: {m.alergias}</span>}
          {m.enfermedades_cronicas && <span className="alert-badge alert-badge--soft">Crónico: {m.enfermedades_cronicas}</span>}
        </p>
      )}
      {m.notas && <p className="pet__notes">{m.notas}</p>}
      {(m.proxima_cita || m.proxima_vacuna) && (
        <ul className="mascota__proximo">
          {m.proxima_cita && <li><CalendarClock size={16} aria-hidden="true" /> <span><strong>{m.proxima_cita.servicio}</strong> {formatCita(m.proxima_cita.inicio)}</span></li>}
          {m.proxima_vacuna && <li><Syringe size={16} aria-hidden="true" /> <span><strong>{m.proxima_vacuna.nombre}</strong> {fechaCorta(m.proxima_vacuna.fecha)}</span></li>}
        </ul>
      )}
      {m.microchip && <p className="mascota__chip">Microchip: <span className="mono">{m.microchip}</span></p>}
      {error && <p className="field-error">{error}</p>}
      {confirming ? (
        <p className="cita__confirm mascota__confirmar">
          ¿Quitar a {m.nombre}?
          <button className="btn btn--dark btn--sm" onClick={quitar}>Sí, quitar</button>
          <button className="link-btn" onClick={() => setConfirming(false)}>No</button>
        </p>
      ) : (
        <div className="mascota__acciones">
          <Link to={`/reservar?mascota=${m.id}`} className="btn btn--primary btn--xs"><CalendarPlus size={14} aria-hidden="true" /> Reservar</Link>
          <button className="btn btn--ghost btn--xs" onClick={verCarne} aria-expanded={Boolean(carne)}>{carne ? 'Ocultar carné' : 'Ver carné'}</button>
        </div>
      )}
      {carne && (
        <div className="pet__carne">
          {carne === 'cargando' ? <Loading /> : <Carne vacunas={carne} />}
          <p className="summary__hint">Las vacunas y desparasitaciones las registra el veterinario. Te avisaremos antes de cada refuerzo.</p>
        </div>
      )}
    </li>
  )
}
