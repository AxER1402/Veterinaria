import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import Loading from '../../components/Loading'
import { api } from '../../api'
import Select from '../../components/Select'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const HORAS = Array.from({ length: 25 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
const VACIO = { servicio: 'veterinaria', nombre: '', dias: [1, 2, 3, 4, 5, 6], hora_inicio: '08:00', hora_fin: '20:00', activo: true }

// Equipo de los servicios por turnos: cada profesional con sus días y horario. Un turno tiene tantos
// lugares como profesionales trabajan a esa hora sin cita. Solo el admin edita; el servidor rechaza
// un cambio que dejaría citas próximas fuera del horario.
export default function Equipo({ editable }) {
  const [datos, setDatos] = useState(null)
  const [editando, setEditando] = useState(null) // id, 'nuevo' o null
  const [error, setError] = useState('')

  useEffect(() => {
    api('/api/citas/admin/equipo').then(setDatos).catch((e) => setError(e.message))
  }, [])

  const guardar = async (id, body) => {
    setError('')
    try {
      setDatos(await api(id ? `/api/citas/admin/equipo/${id}` : '/api/citas/admin/equipo', { method: id ? 'PATCH' : 'POST', body }))
      setEditando(null)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="admin-card">
      <div className="admin-card__head">
        <h2>Equipo y horarios <small>· cada profesional atiende un turno a la vez</small></h2>
        {editable && editando !== 'nuevo' && <button className="btn btn--primary btn--xs" onClick={() => setEditando('nuevo')}><Plus size={14} /> Agregar</button>}
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {editando === 'nuevo' && datos && <ProfesionalForm inicial={VACIO} servicios={datos.servicios} onCancel={() => setEditando(null)} onSave={(b) => guardar(null, b)} />}
      {!datos ? !error && <Loading /> : datos.profesionales.length === 0 ? (
        <p className="summary__hint">Sin equipo cargado: cada servicio usa su cantidad fija de lugares.</p>
      ) : (
        <ul className="equipo">
          {datos.profesionales.map((p) => (editando === p.id ? (
            <li key={p.id}><ProfesionalForm inicial={p} servicios={datos.servicios} onCancel={() => setEditando(null)} onSave={(b) => guardar(p.id, b)} /></li>
          ) : (
            <li key={p.id} className={p.activo ? '' : 'is-muted'}>
              <span>
                <strong>{p.nombre}</strong> · {p.servicio.nombre}{!p.activo && ' · inactivo'}
                <small>{p.dias.map((d) => DIAS[d - 1]).join(', ')} · {p.hora_inicio}–{p.hora_fin} · {p.proximas} {p.proximas === 1 ? 'cita próxima' : 'citas próximas'}</small>
              </span>
              {editable && <button className="link-btn" onClick={() => setEditando(p.id)}>Editar</button>}
            </li>
          )))}
        </ul>
      )}
    </div>
  )
}

function ProfesionalForm({ inicial, servicios, onCancel, onSave }) {
  const [v, setV] = useState({ ...inicial, servicio: inicial.servicio?.slug || inicial.servicio })
  const set = (f) => (e) => setV((x) => ({ ...x, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const dia = (d) => setV((x) => ({ ...x, dias: x.dias.includes(d) ? x.dias.filter((y) => y !== d) : [...x.dias, d].sort() }))
  const nuevo = !inicial.id

  return (
    <form className="clinical-form equipo__form" onSubmit={(e) => {
      e.preventDefault()
      onSave({ nombre: v.nombre, dias: v.dias, hora_inicio: v.hora_inicio, hora_fin: v.hora_fin, activo: v.activo, ...(nuevo ? { servicio: v.servicio } : {}) })
    }}>
      <div className="agenda__form-row">
        <label>Nombre
          <input value={v.nombre} onChange={set('nombre')} minLength={3} maxLength={80} required />
        </label>
        <label>Servicio
          <Select value={v.servicio} onChange={set('servicio')} disabled={!nuevo}>
            {servicios.map((s) => <option key={s.slug} value={s.slug}>{s.nombre}</option>)}
          </Select>
        </label>
      </div>
      <div className="chips-row" role="group" aria-label="Días que atiende">
        {DIAS.map((d, i) => (
          <button key={d} type="button" className={`chip ${v.dias.includes(i + 1) ? 'chip--active' : ''}`} aria-pressed={v.dias.includes(i + 1)} onClick={() => dia(i + 1)}>{d}</button>
        ))}
      </div>
      <div className="agenda__form-row agenda__form-row--3">
        <label>Entra
          <Select value={v.hora_inicio} onChange={set('hora_inicio')}>{HORAS.slice(0, -1).map((h) => <option key={h}>{h}</option>)}</Select>
        </label>
        <label>Sale
          <Select value={v.hora_fin} onChange={set('hora_fin')}>{HORAS.slice(1).map((h) => <option key={h}>{h}</option>)}</Select>
        </label>
        <label className="check-row"><input type="checkbox" checked={v.activo} onChange={set('activo')} /> Activo</label>
      </div>
      <div className="pet-form__actions">
        <button className="btn btn--dark btn--xs" disabled={!v.dias.length}>{nuevo ? 'Agregar' : 'Guardar'}</button>
        <button type="button" className="link-btn" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  )
}
