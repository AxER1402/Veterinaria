import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import Avatar from '../../components/Avatar'
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

  const grupos = datos ? [...new Set(datos.profesionales.map((p) => p.servicio.nombre))].sort() : []

  return (
    <>
      <div className="barra">
        <p className="barra__nota">Cada profesional atiende un turno a la vez.</p>
        {editable && editando !== 'nuevo' && <button className="btn btn--primary btn--xs barra__fin" onClick={() => setEditando('nuevo')}><Plus size={16} /> Agregar</button>}
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {editando === 'nuevo' && datos && <div className="admin-card"><ProfesionalForm inicial={VACIO} servicios={datos.servicios} onCancel={() => setEditando(null)} onSave={(b) => guardar(null, b)} /></div>}
      {!datos ? !error && <Loading /> : datos.profesionales.length === 0 ? (
        <div className="vacio"><p>Sin equipo cargado: cada servicio usa su cantidad fija de lugares.</p></div>
      ) : grupos.map((g) => (
        <section key={g} className="equipo-grupo">
          <h3>{g}</h3>
          <ul className="equipo-lista">
            {datos.profesionales.filter((p) => p.servicio.nombre === g).map((p) => (editando === p.id ? (
              <li key={p.id} className="equipo-persona equipo-persona--form"><ProfesionalForm inicial={p} servicios={datos.servicios} onCancel={() => setEditando(null)} onSave={(b) => guardar(p.id, b)} /></li>
            ) : (
              <li key={p.id} className={`equipo-persona ${p.activo ? '' : 'is-apagada'}`}>
                <Avatar nombre={p.nombre} />
                <span className="fila__principal">
                  <strong>{p.nombre}{!p.activo && ' · inactivo'}</strong>
                  <small>{p.hora_inicio}–{p.hora_fin} · {p.proximas} {p.proximas === 1 ? 'cita próxima' : 'citas próximas'}</small>
                  <span className="equipo-dias" aria-label={`Días: ${p.dias.map((d) => DIAS[d - 1]).join(', ')}`}>
                    {DIAS.map((d, i) => <i key={d} className={p.dias.includes(i + 1) ? 'on' : ''} aria-hidden="true">{d[0]}</i>)}
                  </span>
                </span>
                {editable && <button className="btn btn--ghost btn--xs" onClick={() => setEditando(p.id)}>Editar</button>}
              </li>
            )))}
          </ul>
        </section>
      ))}
    </>
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
