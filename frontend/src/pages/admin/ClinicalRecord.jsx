import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Modal from '../../components/Modal'
import Loading from '../../components/Loading'
import PetIcon from '../../components/PetIcon'
import VaccineTable from '../../components/VaccineTable'
import { api } from '../../api'
import { formatCita } from '../account/citas'

const VACUNAS_COMUNES = ['Rabia', 'Séxtuple', 'Parvovirus', 'Moquillo', 'Triple felina', 'Leucemia felina', 'Bordetella', 'Desparasitación']
const VACIA = { nombre: '', lote: '', proxima_dosis: '' }

// Ficha de la consulta: al guardarla, la cita queda atendida. El servidor vuelve a validar todo.
export function ConsultaForm({ cita, onClose, onSaved }) {
  const [values, setValues] = useState({ peso_kg: '', diagnostico: '', tratamiento: '' })
  const [vacunas, setVacunas] = useState([])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }))
  const setVacuna = (i, f) => (e) => setVacunas((l) => l.map((v, j) => (j === i ? { ...v, [f]: e.target.value } : v)))
  const dia = cita.inicio.slice(0, 10)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      await api(`/api/citas/admin/${cita.id}/historial`, {
        method: 'POST',
        body: { ...values, peso_kg: values.peso_kg === '' ? '' : Number(values.peso_kg), vacunas: vacunas.filter((v) => v.nombre.trim()) },
      })
      onSaved()
    } catch (err) {
      setError(err.message)
      setSending(false)
    }
  }

  return (
    <Modal title={`Consulta de ${cita.mascota.nombre}`} onClose={onClose} wide>
      <p className="modal__sub">
        <PetIcon especie={cita.mascota.especie} size={16} /> {[cita.mascota.raza, cita.mascota.notas].filter(Boolean).join(' · ') || 'Sin datos extra'}
        {' · '}{formatCita(cita.inicio)} · {cita.cliente.nombre}
      </p>
      <form className="clinical-form" onSubmit={submit}>
        <div className="agenda__form-row agenda__form-row--3">
          <label>Peso (kg)
            <input type="number" min="0.1" max="150" step="0.1" inputMode="decimal" value={values.peso_kg} onChange={set('peso_kg')} />
          </label>
        </div>
        <label>Diagnóstico
          <textarea rows="3" value={values.diagnostico} onChange={set('diagnostico')} minLength={3} maxLength={500} required />
        </label>
        <label>Tratamiento (opcional)
          <textarea rows="2" value={values.tratamiento} onChange={set('tratamiento')} maxLength={500} />
        </label>

        <fieldset className="clinical-form__vaccines">
          <legend>Vacunas aplicadas hoy</legend>
          {vacunas.map((v, i) => (
            <div key={i} className="vaccine-row">
              <label>Vacuna
                <input list="vacunas-comunes" value={v.nombre} onChange={setVacuna(i, 'nombre')} maxLength={80} required />
              </label>
              <label>Lote
                <input value={v.lote} onChange={setVacuna(i, 'lote')} maxLength={40} />
              </label>
              <label>Próxima dosis
                <input type="date" min={dia} value={v.proxima_dosis} onChange={setVacuna(i, 'proxima_dosis')} />
              </label>
              <button type="button" className="icon-btn icon-btn--ghost" aria-label={`Quitar vacuna ${i + 1}`}
                onClick={() => setVacunas((l) => l.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
          <datalist id="vacunas-comunes">{VACUNAS_COMUNES.map((n) => <option key={n} value={n} />)}</datalist>
          {vacunas.length < 5 && (
            <button type="button" className="pet-picker__add" onClick={() => setVacunas((l) => [...l, VACIA])}>
              <Plus size={16} /> Agregar vacuna
            </button>
          )}
        </fieldset>

        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="pet-form__actions">
          <button className="btn btn--dark btn--sm" disabled={sending}>{sending ? 'Guardando…' : 'Guardar y marcar atendida'}</button>
          <button type="button" className="link-btn" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </Modal>
  )
}

// Historial completo de una mascota. El servidor registra cada apertura en la bitácora.
export function HistorialPanel({ mascota, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api(`/api/citas/admin/mascotas/${mascota.id}/historial`).then(setData).catch((e) => setError(e.message))
  }, [mascota.id])

  return (
    <Modal title={`Historial de ${mascota.nombre}`} onClose={onClose} wide>
      <p className="modal__sub">Datos de salud: solo para atender a la mascota. Esta consulta queda registrada en la bitácora.</p>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {!data && !error && <Loading />}
      {data && (
        <>
          <p className="clinical__pet">
            <PetIcon especie={data.mascota.especie} size={18} />
            {[data.mascota.raza, data.mascota.sexo, data.mascota.peso_kg && `${data.mascota.peso_kg} kg`, data.mascota.notas].filter(Boolean).join(' · ')}
          </p>
          <h3 className="clinical__title">Carné de vacunas</h3>
          <VaccineTable vacunas={data.vacunas} lote />
          <h3 className="clinical__title">Consultas</h3>
          {data.consultas.length === 0 ? <p className="summary__hint">Sin consultas registradas.</p> : (
            <ol className="clinical__list">
              {data.consultas.map((c) => (
                <li key={c.id}>
                  <strong>{formatCita(c.fecha)}</strong>{c.peso_kg && <span> · {c.peso_kg} kg</span>}
                  <p><b>Diagnóstico:</b> {c.diagnostico}</p>
                  {c.tratamiento && <p><b>Tratamiento:</b> {c.tratamiento}</p>}
                  {c.vacunas.length > 0 && <p><b>Vacunas:</b> {c.vacunas.map((v) => v.nombre).join(', ')}</p>}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Modal>
  )
}
