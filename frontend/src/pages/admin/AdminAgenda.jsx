import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Ban, Stethoscope, FileText, StickyNote } from 'lucide-react'
import Loading from '../../components/Loading'
import PetIcon from '../../components/PetIcon'
import { api } from '../../api'
import { AlertasClinicas, ConsultaForm, NotaForm } from './ClinicalRecord'
import { CITA_STATUS, addDays, formatDay, ymd } from '../account/citas'

const SEDES = [
  { value: '', label: 'Todas' },
  { value: 'centro', label: 'Centro' },
  { value: 'norte', label: 'Norte' },
  { value: 'sur', label: 'Sur' },
]

// Solo para mostrar las opciones; la regla que vale es la del servidor (citas-service).
const NEXT = {
  pendiente: ['confirmada', 'atendida', 'no_asistio', 'cancelada'],
  confirmada: ['atendida', 'no_asistio', 'cancelada'],
  atendida: [],
  no_asistio: [],
  cancelada: [],
}

// Turnos de 8:00 a 20:00 cada 30 min (20:00 solo como hora final de un bloqueo).
const HORAS = Array.from({ length: 25 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)

const sedeCorta = (codigo) => SEDES.find((s) => s.value === codigo)?.label || codigo
const rango = (b) => (b.hora_inicio ? `${b.hora_inicio}–${b.hora_fin}` : 'Todo el día')

export default function AdminAgenda() {
  const [fecha, setFecha] = useState(() => ymd(new Date()))
  const [sede, setSede] = useState('')
  const [agenda, setAgenda] = useState(null)
  const [error, setError] = useState('')
  const [proximos, setProximos] = useState(null)
  const [consulta, setConsulta] = useState(null) // cita cuya ficha se está llenando
  const [nota, setNota] = useState(null) // cita no clínica a la que se agrega una nota

  const cargar = useCallback(() => {
    api(`/api/citas/admin/agenda?fecha=${fecha}${sede ? `&sede=${sede}` : ''}`)
      .then((d) => { setAgenda({ ...d, consulta: `${fecha}|${sede}` }); setError('') })
      .catch((e) => setError(e.message))
  }, [fecha, sede])
  const cargarBloqueos = useCallback(() => {
    api('/api/citas/admin/bloqueos').then((d) => setProximos(d.bloqueos)).catch((e) => setError(e.message))
  }, [])

  useEffect(cargar, [cargar])
  useEffect(cargarBloqueos, [cargarBloqueos])

  const vigente = agenda?.consulta === `${fecha}|${sede}` ? agenda : null
  const hoy = ymd(new Date())
  const mover = (dias) => setFecha((f) => ymd(addDays(new Date(`${f}T12:00:00`), dias)))

  const cambiar = async (cita, nuevo) => {
    let comentario = ''
    if (nuevo === 'cancelada') {
      const motivo = window.prompt(`Motivo de la cancelación (le llega a ${cita.cliente.nombre} por correo):`)
      if (motivo === null) return
      comentario = motivo
    }
    try {
      await api(`/api/citas/admin/${cita.id}/estado`, { method: 'PATCH', body: { estado: nuevo, comentario } })
      cargar()
    } catch (e) {
      setError(e.message)
    }
  }

  const quitar = async (b) => {
    if (!window.confirm(`¿Quitar el bloqueo de ${sedeCorta(b.sede.codigo)} el ${formatDay(b.fecha)} (${rango(b)})?`)) return
    try {
      await api(`/api/citas/admin/bloqueos/${b.id}`, { method: 'DELETE' })
      cargar()
      cargarBloqueos()
    } catch (e) {
      setError(e.message)
    }
  }

  const activas = vigente?.citas.filter((c) => c.estado !== 'cancelada') || []

  return (
    <>
      <div className="admin-card">
        <div className="admin-card__head">
          <h2>
            Agenda · <span className="agenda__day">{formatDay(fecha)}</span>
            {vigente && <small> · {activas.length} {activas.length === 1 ? 'cita' : 'citas'}</small>}
          </h2>
          <div className="agenda__nav">
            <button className="icon-btn" onClick={() => mover(-1)} aria-label="Día anterior"><ChevronLeft size={18} /></button>
            <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Fecha" />
            <button className="icon-btn" onClick={() => mover(1)} aria-label="Día siguiente"><ChevronRight size={18} /></button>
            {fecha !== hoy && <button className="link-btn" onClick={() => setFecha(hoy)}>Hoy</button>}
          </div>
        </div>
        <div className="admin-filters" role="group" aria-label="Sede">
          {SEDES.map((s) => (
            <button key={s.value} className={`chip ${sede === s.value ? 'chip--active' : ''}`} aria-pressed={sede === s.value} onClick={() => setSede(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
        {error && <p className="form-alert" role="alert">{error}</p>}
        {vigente?.bloqueos.length > 0 && (
          <ul className="agenda__blocks">
            {vigente.bloqueos.map((b) => (
              <li key={b.id}>
                <Ban size={16} /> <strong>{sedeCorta(b.sede.codigo)} · {rango(b)}</strong> {b.motivo}
                <button className="link-btn" onClick={() => quitar(b)}>Quitar</button>
              </li>
            ))}
          </ul>
        )}
        {!vigente ? <Loading /> : vigente.citas.length === 0 ? (
          <p className="summary__hint">No hay citas este día{sede ? ' en esta sede' : ''}.</p>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr><th>Hora</th><th>Sede</th><th>Servicio</th><th>Mascota</th><th>Cliente</th><th>Código</th><th>Estado</th><th>Ficha</th><th>Cambiar a</th></tr>
              </thead>
              <tbody>
                {vigente.citas.map((c) => {
                  // En una consulta, «atendida» se marca al guardar la ficha clínica.
                  const opciones = NEXT[c.estado].filter((n) => (!['atendida', 'no_asistio'].includes(n) || fecha <= hoy) && !(n === 'atendida' && c.clinica))
                  const puedeFicha = c.clinica && !c.tiene_historial && ['pendiente', 'confirmada', 'atendida', 'no_asistio'].includes(c.estado) && fecha <= hoy
                  return (
                    <tr key={c.id} className={c.estado === 'cancelada' ? 'is-muted' : ''}>
                      <td className="mono">{c.inicio.slice(11, 16)}</td>
                      <td>{sedeCorta(c.sede.codigo)}</td>
                      <td>{c.servicio.nombre}{c.notas && <small>{c.notas}</small>}</td>
                      <td>
                        <span className="agenda__pet"><PetIcon especie={c.mascota.especie} size={16} /> {c.mascota.nombre}</span>
                        {(c.mascota.raza || c.mascota.notas) && <small>{[c.mascota.raza, c.mascota.notas].filter(Boolean).join(' · ')}</small>}
                        <AlertasClinicas mascota={c.mascota} compact />
                      </td>
                      <td>
                        {c.cliente.nombre}
                        <small><a href={`tel:${c.cliente.telefono}`}>{c.cliente.telefono}</a> · {c.cliente.email}</small>
                      </td>
                      <td className="mono">{c.codigo_verificacion || '—'}</td>
                      <td><span className={`status status--${CITA_STATUS[c.estado].tone}`}>{CITA_STATUS[c.estado].label}</span></td>
                      <td className="agenda__actions">
                        {puedeFicha && (
                          <button className="btn btn--dark btn--xs" onClick={() => setConsulta(c)}><Stethoscope size={14} /> Registrar consulta</button>
                        )}
                        {!c.clinica && c.estado !== 'cancelada' && (
                          <button className="link-btn" onClick={() => setNota(c)}><StickyNote size={14} /> Nota</button>
                        )}
                        <Link className="link-btn" to={`/admin/pacientes/${c.mascota.id}`}><FileText size={14} /> Ficha</Link>
                      </td>
                      <td>
                        {opciones.length ? (
                          <select value="" onChange={(e) => e.target.value && cambiar(c, e.target.value)} aria-label={`Cambiar estado de la cita de ${c.mascota.nombre}`}>
                            <option value="">—</option>
                            {opciones.map((n) => <option key={n} value={n}>{CITA_STATUS[n].label}</option>)}
                          </select>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {consulta && <ConsultaForm cita={consulta} onClose={() => setConsulta(null)} onSaved={() => { setConsulta(null); cargar() }} />}
      {nota && <NotaForm cita={nota} onClose={() => setNota(null)} onSaved={() => setNota(null)} />}

      <div className="admin-grid admin-grid--even">
        <BlockForm fecha={fecha >= hoy ? fecha : hoy} sede={sede} onSaved={() => { cargar(); cargarBloqueos() }} />
        <div className="admin-card">
          <h2>Próximos bloqueos</h2>
          {!proximos ? <Loading /> : proximos.length === 0 ? (
            <p className="summary__hint">No hay turnos bloqueados.</p>
          ) : (
            <ul className="agenda__blocks agenda__blocks--list">
              {proximos.map((b) => (
                <li key={b.id}>
                  <span>
                    <strong>{formatDay(b.fecha, true)} · {sedeCorta(b.sede.codigo)} · {rango(b)}</strong>
                    <small>{b.motivo}</small>
                  </span>
                  <button className="link-btn" onClick={() => quitar(b)}>Quitar</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}

// Feriados o mantenimiento: el día entero o un rango de turnos de una sede.
function BlockForm({ fecha, sede, onSaved }) {
  const [values, setValues] = useState({ sede: sede || 'centro', fecha, todo: true, hora_inicio: '08:00', hora_fin: '12:00', motivo: '' })
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setOk('')
    setSending(true)
    try {
      const { todo, ...rest } = values
      const body = todo ? { ...rest, hora_inicio: '', hora_fin: '' } : rest
      await api('/api/citas/admin/bloqueos', { method: 'POST', body })
      setOk('Bloqueo guardado: esos turnos ya no se pueden reservar.')
      setValues((v) => ({ ...v, motivo: '' }))
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="admin-card agenda__form" onSubmit={submit}>
      <h2>Bloquear turnos <small>· feriados o mantenimiento</small></h2>
      <div className="agenda__form-row">
        <label>Sede
          <select value={values.sede} onChange={set('sede')}>
            {SEDES.filter((s) => s.value).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label>Fecha
          <input type="date" value={values.fecha} min={ymd(new Date())} onChange={set('fecha')} required />
        </label>
      </div>
      <label className="agenda__check">
        <input type="checkbox" checked={values.todo} onChange={set('todo')} /> Todo el día
      </label>
      {!values.todo && (
        <div className="agenda__form-row">
          <label>Desde
            <select value={values.hora_inicio} onChange={set('hora_inicio')}>
              {HORAS.slice(0, -1).map((h) => <option key={h}>{h}</option>)}
            </select>
          </label>
          <label>Hasta
            <select value={values.hora_fin} onChange={set('hora_fin')}>
              {HORAS.slice(1).map((h) => <option key={h}>{h}</option>)}
            </select>
          </label>
        </div>
      )}
      <label>Motivo
        <input value={values.motivo} onChange={set('motivo')} placeholder="Feriado, fumigación, capacitación…" minLength={3} maxLength={120} required />
      </label>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {ok && <p className="form-ok" role="status">{ok}</p>}
      <button className="btn btn--dark btn--sm" disabled={sending}>{sending ? 'Guardando…' : 'Bloquear'}</button>
    </form>
  )
}
