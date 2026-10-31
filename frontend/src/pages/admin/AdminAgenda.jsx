import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Ban, Stethoscope, FileText, StickyNote, Plus, CalendarCheck, Search, X, RefreshCw } from 'lucide-react'
import Loading from '../../components/Loading'
import PetIcon from '../../components/PetIcon'
import ConfirmDialog from '../../components/ConfirmDialog'
import { api } from '../../api'
import { useAuth } from '../../context/useAuth'
import { AlertasClinicas, ConsultaForm, NotaForm } from './ClinicalRecord'
import AgendarCita from './AgendarCita'
import Equipo from './Equipo'
import { Reprogramar } from '../account/Appointments'
import { CITA_STATUS, addDays, formatCita, formatDay, formatReserva, ymd } from '../account/citas'
import DateInput from '../../components/DateInput'
import Select from '../../components/Select'

const SEDES = [
  { value: '', label: 'Todas' },
  { value: 'centro', label: 'Centro' },
  { value: 'norte', label: 'Norte' },
  { value: 'sur', label: 'Sur' },
]

// Solo para mostrar las opciones; la regla que vale es la del servidor (citas-service).
const NEXT = {
  pendiente: ['confirmada', 'atendida', 'no_asistio', 'cancelada'],
  confirmada: ['atendida', 'no_asistio', 'cancelada', 'pendiente'],
  atendida: ['no_asistio'],
  no_asistio: ['atendida', 'confirmada'],
  cancelada: ['pendiente'],
}
// Volver atrás corrige un error: pide motivo y lo deja en la bitácora.
const REVERSIONES = ['confirmada>pendiente', 'atendida>no_asistio', 'no_asistio>atendida', 'no_asistio>confirmada', 'cancelada>pendiente']
const ACCION = { confirmada: 'Confirmar', atendida: 'Marcar atendida', no_asistio: 'Marcar «no asistió»', cancelada: 'Cancelar', pendiente: 'Volver a pendiente' }
const MOTIVOS_CANCELAR = ['El cliente pidió cancelar', 'Veterinario no disponible', 'Cierre de la sede', 'Cita duplicada']
const MOTIVOS_REVERTIR = ['Se marcó por error', 'El cliente sí llegó', 'El cliente volvió a llamar']

// Turnos de 8:00 a 20:00 cada 30 min (20:00 solo como hora final de un bloqueo).
const HORAS = Array.from({ length: 25 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
const REFRESCO_MS = 60_000

const sedeCorta = (codigo) => SEDES.find((s) => s.value === codigo)?.label || codigo
const rango = (b) => (b.hora_inicio ? `${b.hora_inicio}–${b.hora_fin}` : 'Todo el día')
const lugar = (c) => c.profesional || (c.servicio.slug === 'veterinaria' ? `Consultorio ${c.cupo}` : c.servicio.slug === 'peluqueria' ? `Mesa ${c.cupo}` : `Lugar ${c.cupo}`)

export default function AdminAgenda() {
  const { user } = useAuth()
  const veterinario = ['admin', 'veterinario'].includes(user.rol)
  const [params, setParams] = useSearchParams()
  const hoy = ymd(new Date())
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(params.get('fecha') || '') ? params.get('fecha') : hoy
  const sede = params.get('sede') || ''
  const setFiltro = (cambios) => setParams((p) => {
    const n = new URLSearchParams(p)
    Object.entries(cambios).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)))
    return n
  }, { replace: true })

  const [agenda, setAgenda] = useState(null)
  const [semana, setSemana] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [proximos, setProximos] = useState(null)
  const [canceladas, setCanceladas] = useState(false)
  const [vista, setVista] = useState('hora') // 'hora' o 'columnas' (por consultorio o profesional)
  const [buscar, setBuscar] = useState('')
  const [resultados, setResultados] = useState(null)
  const [dialogo, setDialogo] = useState(null) // { tipo, cita?, … }

  const cargar = useCallback(() => {
    api(`/api/citas/admin/agenda?fecha=${fecha}${sede ? `&sede=${sede}` : ''}`)
      .then((d) => { setAgenda({ ...d, consulta: `${fecha}|${sede}` }); setError('') })
      .catch((e) => setError(e.message))
    api(`/api/citas/admin/semana?fecha=${fecha}${sede ? `&sede=${sede}` : ''}`).then((d) => setSemana(d.dias)).catch(() => {})
  }, [fecha, sede])
  const cargarBloqueos = useCallback(() => {
    api('/api/citas/admin/bloqueos').then((d) => setProximos(d.bloqueos)).catch((e) => setError(e.message))
  }, [])

  useEffect(cargar, [cargar])
  useEffect(cargarBloqueos, [cargarBloqueos])
  // Se actualiza sola cada minuto (otra persona pudo reservar o cambiar algo), salvo con un diálogo abierto.
  useEffect(() => {
    if (dialogo) return
    const t = setInterval(() => document.visibilityState === 'visible' && cargar(), REFRESCO_MS)
    return () => clearInterval(t)
  }, [cargar, dialogo])

  const vigente = agenda?.consulta === `${fecha}|${sede}` ? agenda : null
  const mover = (dias) => setFiltro({ fecha: ymd(addDays(new Date(`${fecha}T12:00:00`), dias)) })
  const manana = ymd(addDays(new Date(), 1))
  const cerrar = () => setDialogo(null)
  const listo = (mensaje) => { setDialogo(null); setAviso(mensaje); cargar(); cargarBloqueos() }

  const buscarCitas = async (e) => {
    e.preventDefault()
    if (buscar.trim().length < 2) return
    try {
      setResultados((await api(`/api/citas/admin/buscar?q=${encodeURIComponent(buscar.trim())}`)).citas)
    } catch (err) {
      setError(err.message)
    }
  }

  const cambiarEstado = async (cita, nuevo, comentario) => {
    await api(`/api/citas/admin/${cita.id}/estado`, { method: 'PATCH', body: { estado: nuevo, comentario } })
    listo(`${cita.mascota.nombre}: ${CITA_STATUS[nuevo].label.toLowerCase()}.`)
  }

  const todas = vigente?.citas || []
  const nCanceladas = todas.filter((c) => c.estado === 'cancelada').length
  const visibles = todas.filter((c) => canceladas || c.estado !== 'cancelada')
  const activas = todas.length - nCanceladas
  const porHora = visibles.reduce((g, c) => {
    // Un hospedaje que empezó otro día se agrupa como «En la sede».
    const h = c.inicio.slice(0, 10) === fecha ? c.inicio.slice(11, 16) : 'Estadías'
    ;(g[h] ||= []).push(c)
    return g
  }, {})

  return (
    <>
      <div className="admin-card">
        <div className="admin-card__head">
          <h2>
            Agenda · <span className="agenda__day">{formatDay(fecha)}</span>
            {vigente && <small> · {activas} {activas === 1 ? 'cita' : 'citas'}</small>}
          </h2>
          <div className="agenda__nav">
            <button className="icon-btn" onClick={() => mover(-1)} aria-label="Día anterior"><ChevronLeft size={18} /></button>
            <DateInput value={fecha} onChange={(e) => e.target.value && setFiltro({ fecha: e.target.value })} aria-label="Fecha" />
            <button className="icon-btn" onClick={() => mover(1)} aria-label="Día siguiente"><ChevronRight size={18} /></button>
            {fecha !== hoy && <button className="link-btn" onClick={() => setFiltro({ fecha: '' })}>Hoy</button>}
            <button className="icon-btn" onClick={cargar} aria-label="Actualizar" title="Se actualiza sola cada minuto"><RefreshCw size={16} /></button>
          </div>
        </div>

        {semana && (
          <div className="week-strip" role="group" aria-label="Semana">
            {semana.map((d) => (
              <button key={d.fecha} className={`week-strip__day ${d.fecha === fecha ? 'active' : ''} ${d.fecha === hoy ? 'week-strip__day--hoy' : ''}`}
                onClick={() => setFiltro({ fecha: d.fecha })} aria-pressed={d.fecha === fecha}>
                <span>{formatDay(d.fecha, true)}</span>
                <strong>{d.activas}</strong>
                {d.pendientes > 0 && <small>{d.pendientes} por confirmar</small>}
              </button>
            ))}
          </div>
        )}

        <div className="agenda__toolbar">
          <div className="admin-filters" role="group" aria-label="Sede">
            {SEDES.map((s) => (
              <button key={s.value} className={`chip ${sede === s.value ? 'chip--active' : ''}`} aria-pressed={sede === s.value} onClick={() => setFiltro({ sede: s.value })}>
                {s.label}
              </button>
            ))}
          </div>
          <form className="search admin-search agenda__search" onSubmit={buscarCitas} role="search">
            <Search size={18} />
            <input type="search" value={buscar} onChange={(e) => { setBuscar(e.target.value); if (!e.target.value) setResultados(null) }}
              placeholder="Buscar mascota, cliente o teléfono" aria-label="Buscar citas" />
          </form>
          <div className="agenda__buttons">
            <button className="btn btn--ghost btn--xs" onClick={() => setDialogo({ tipo: 'confirmar-dia' })}><CalendarCheck size={14} /> Confirmar las de mañana</button>
            <button className="btn btn--primary btn--xs" onClick={() => setDialogo({ tipo: 'agendar' })}><Plus size={14} /> Agendar cita</button>
          </div>
        </div>

        {error && <p className="form-alert" role="alert">{error}</p>}
        {aviso && <p className="form-ok" role="status">{aviso} <button className="link-btn" onClick={() => setAviso('')} aria-label="Cerrar aviso"><X size={14} /></button></p>}

        {resultados ? (
          <>
            <p className="agenda__resultados">
              {resultados.length} {resultados.length === 1 ? 'resultado' : 'resultados'} para «{buscar}»
              <button className="link-btn" onClick={() => { setResultados(null); setBuscar('') }}>Volver al día</button>
            </p>
            <ul className="agenda-cards">
              {resultados.map((c) => <CitaCard key={c.id} cita={c} conFecha veterinario={veterinario} hoy={hoy} onAccion={setDialogo}
                onIr={() => { setResultados(null); setFiltro({ fecha: c.inicio.slice(0, 10) }) }} />)}
            </ul>
          </>
        ) : (
          <>
            {vigente?.bloqueos.length > 0 && (
              <ul className="agenda__blocks">
                {vigente.bloqueos.map((b) => (
                  <li key={b.id}>
                    <Ban size={16} /> <strong>{sedeCorta(b.sede.codigo)} · {rango(b)}</strong> {b.motivo}
                    <button className="link-btn" onClick={() => setDialogo({ tipo: 'quitar-bloqueo', bloqueo: b })}>Quitar</button>
                  </li>
                ))}
              </ul>
            )}
            {!vigente ? <Loading /> : todas.length === 0 ? (
              <p className="summary__hint">No hay citas este día{sede ? ' en esta sede' : ''}.</p>
            ) : (
              <>
                <div className="agenda__view">
                  <div className="tabs" role="tablist" aria-label="Vista">
                    <button role="tab" aria-selected={vista === 'hora'} className={`tab ${vista === 'hora' ? 'tab--active' : ''}`} onClick={() => setVista('hora')}>Por hora</button>
                    <button role="tab" aria-selected={vista === 'columnas'} className={`tab ${vista === 'columnas' ? 'tab--active' : ''}`} onClick={() => setVista('columnas')}>Por consultorio</button>
                  </div>
                  {nCanceladas > 0 && (
                    <button className="link-btn agenda__toggle" onClick={() => setCanceladas((v) => !v)}>
                      {canceladas ? 'Ocultar canceladas' : `Mostrar canceladas (${nCanceladas})`}
                    </button>
                  )}
                </div>
                {vista === 'columnas' && <AgendaColumnas citas={visibles} fecha={fecha} onAccion={setDialogo} />}
                {vista === 'hora' && Object.entries(porHora).map(([hora, citas]) => (
                  <section key={hora} className="agenda-hour">
                    <h3 className="agenda-hour__label">{hora}</h3>
                    <ul className="agenda-cards">
                      {citas.map((c) => <CitaCard key={c.id} cita={c} veterinario={veterinario} hoy={hoy} fecha={fecha} onAccion={setDialogo} />)}
                    </ul>
                  </section>
                ))}
              </>
            )}
          </>
        )}
      </div>

      <div className="admin-grid admin-grid--even">
        <BlockForm fecha={fecha >= hoy ? fecha : hoy} sede={sede} onSaved={(n) => listo(n ? `Bloqueo guardado. Se cancelaron ${n} citas y se avisó a cada cliente.` : 'Bloqueo guardado: esos turnos ya no se pueden reservar.')}
          onConflicto={(datos, citas) => setDialogo({ tipo: 'bloquear-con-citas', datos, citas })} />
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
                  <button className="link-btn" onClick={() => setDialogo({ tipo: 'quitar-bloqueo', bloqueo: b })}>Quitar</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Equipo editable={user.rol === 'admin'} />

      {dialogo?.tipo === 'estado' && (() => {
        const { cita, nuevo } = dialogo
        const reversion = REVERSIONES.includes(`${cita.estado}>${nuevo}`)
        const cancelar = nuevo === 'cancelada'
        return (
          <ConfirmDialog title={`${ACCION[nuevo]} · ${cita.mascota.nombre}`} onClose={cerrar}
            text={`${cita.servicio.nombre} · ${formatReserva(cita)} · ${cita.cliente.nombre}.${cancelar ? ' El cliente recibe el motivo por correo.' : ''}${reversion ? ' Es una corrección: queda en la bitácora con el motivo.' : ''}`}
            motivos={cancelar ? MOTIVOS_CANCELAR : reversion ? MOTIVOS_REVERTIR : null} requiereMotivo={reversion}
            peligro={cancelar} confirmLabel={ACCION[nuevo]} onConfirm={(comentario) => cambiarEstado(cita, nuevo, comentario)} />
        )
      })()}
      {dialogo?.tipo === 'confirmar-dia' && (
        <ConfirmDialog title="Confirmar las citas de mañana" onClose={cerrar} confirmLabel="Confirmar todas"
          text={`Pasa a «confirmada» cada cita pendiente del ${formatDay(manana)}${sede ? ` en la sede ${sedeCorta(sede)}` : ''} y le avisa al cliente por correo.`}
          onConfirm={async () => {
            const d = await api('/api/citas/admin/confirmar-dia', { method: 'POST', body: { fecha: manana, sede } })
            listo(d.confirmadas ? `Se confirmaron ${d.confirmadas} citas de mañana.` : 'No había citas pendientes mañana.')
          }} />
      )}
      {dialogo?.tipo === 'quitar-bloqueo' && (
        <ConfirmDialog title="Quitar bloqueo" onClose={cerrar} confirmLabel="Quitar bloqueo"
          text={`${sedeCorta(dialogo.bloqueo.sede.codigo)} · ${formatDay(dialogo.bloqueo.fecha)} · ${rango(dialogo.bloqueo)}. Esos turnos se podrán volver a reservar.`}
          onConfirm={async () => {
            await api(`/api/citas/admin/bloqueos/${dialogo.bloqueo.id}`, { method: 'DELETE' })
            listo('Bloqueo quitado.')
          }} />
      )}
      {dialogo?.tipo === 'bloquear-con-citas' && (
        <ConfirmDialog title="Hay citas en ese horario" onClose={cerrar} peligro confirmLabel={`Cancelar ${dialogo.citas} y bloquear`}
          text={`Hay ${dialogo.citas} ${dialogo.citas === 1 ? 'cita activa' : 'citas activas'} en ese horario. Se cancelarán con el motivo «${dialogo.datos.motivo}» y cada cliente recibirá un correo.`}
          onConfirm={async () => {
            const d = await api('/api/citas/admin/bloqueos', { method: 'POST', body: { ...dialogo.datos, cancelar_citas: true } })
            listo(`Bloqueo guardado. Se cancelaron ${d.citas_canceladas} citas y se avisó a cada cliente.`)
          }} />
      )}
      {dialogo?.tipo === 'agendar' && (
        <AgendarCita inicial={dialogo.inicial} onClose={cerrar} onDone={(c, a) => { listo(`Cita agendada: ${c.mascota.nombre}, ${formatReserva(c)}.${a ? ` ${a}` : ''}`); setFiltro({ fecha: c.inicio.slice(0, 10) }) }} />
      )}
      {dialogo?.tipo === 'reprogramar' && (
        <Reprogramar cita={dialogo.cita} onClose={cerrar} onDone={(c) => listo(`Cita de ${c.mascota.nombre} movida a ${formatReserva(c)}.`)} />
      )}
      {dialogo?.tipo === 'ficha' && <ConsultaForm cita={dialogo.cita} onClose={cerrar} onSaved={() => listo('Consulta registrada en el historial.')} />}
      {dialogo?.tipo === 'nota' && <NotaForm cita={dialogo.cita} onClose={cerrar} onSaved={() => listo('Nota guardada en la ficha del paciente.')} />}
    </>
  )
}

function CitaCard({ cita: c, veterinario, hoy, fecha, conFecha = false, onAccion, onIr }) {
  const dia = c.inicio.slice(0, 10)
  // En una consulta, «atendida» se marca al guardar la ficha clínica.
  const opciones = NEXT[c.estado].filter((n) => (!['atendida', 'no_asistio'].includes(n) || dia <= hoy) && !(n === 'atendida' && c.clinica && c.estado !== 'no_asistio'))
  const puedeFicha = veterinario && c.clinica && !c.tiene_historial && ['pendiente', 'confirmada', 'atendida', 'no_asistio'].includes(c.estado) && dia <= hoy
  const activa = ['pendiente', 'confirmada'].includes(c.estado)
  return (
    <li className={`agenda-card agenda-card--${c.estado}`}>
      <div className="agenda-card__main">
        <span className="agenda-card__when">
          {conFecha ? formatCita(c.inicio) : c.fin ? formatReserva(c) : c.servicio.modalidad === 'dia' ? 'Todo el día' : c.inicio.slice(11, 16)}
          <small>{sedeCorta(c.sede.codigo)} · {lugar(c)}</small>
        </span>
        <span className="agenda-card__who">
          <strong className="agenda__pet"><PetIcon especie={c.mascota.especie} size={16} /> {c.mascota.nombre} · {c.servicio.nombre}</strong>
          {(c.mascota.raza || c.notas) && <small>{[c.mascota.raza, c.notas].filter(Boolean).join(' · ')}</small>}
          <AlertasClinicas mascota={c.mascota} compact />
          <small>{c.cliente.nombre} · <a href={`tel:${c.cliente.telefono}`}>{c.cliente.telefono}</a>{c.codigo_verificacion && <> · <span className="mono">{c.codigo_verificacion}</span></>}</small>
        </span>
        <span className={`status status--${CITA_STATUS[c.estado].tone}`}>{CITA_STATUS[c.estado].label}</span>
      </div>
      <div className="agenda-card__actions">
        {puedeFicha && <button className="btn btn--dark btn--xs" onClick={() => onAccion({ tipo: 'ficha', cita: c })}><Stethoscope size={14} /> Registrar consulta</button>}
        {!c.clinica && c.estado !== 'cancelada' && <button className="link-btn" onClick={() => onAccion({ tipo: 'nota', cita: c })}><StickyNote size={14} /> Nota</button>}
        {veterinario && <Link className="link-btn" to={`/admin/pacientes/${c.mascota.id}`}><FileText size={14} /> Ficha</Link>}
        <Link className="link-btn" to={`/admin/clientes/${c.cliente.id}`}>Cliente</Link>
        {activa && <button className="link-btn" onClick={() => onAccion({ tipo: 'reprogramar', cita: c })}>Reprogramar</button>}
        {onIr && fecha !== dia && <button className="link-btn" onClick={onIr}>Ver el día</button>}
        {opciones.length > 0 && (
          <Select value="" onChange={(e) => e.target.value && onAccion({ tipo: 'estado', cita: c, nuevo: e.target.value })} aria-label={`Cambiar estado de la cita de ${c.mascota.nombre}`}>
            <option value="">Cambiar a…</option>
            {opciones.map((n) => <option key={n} value={n}>{CITA_STATUS[n].label}{REVERSIONES.includes(`${c.estado}>${n}`) ? ' (corregir)' : ''}</option>)}
          </Select>
        )}
      </div>
    </li>
  )
}

// Feriados o mantenimiento: el día entero o un rango de turnos de una sede. Si hay citas en ese
// horario, el servidor responde 409 con cuántas y se ofrece cancelarlas en el mismo paso.
function BlockForm({ fecha, sede, onSaved, onConflicto }) {
  const [values, setValues] = useState({ sede: sede || 'centro', fecha, todo: true, hora_inicio: '08:00', hora_fin: '12:00', motivo: '' })
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSending(true)
    const { todo, ...rest } = values
    const body = todo ? { ...rest, hora_inicio: '', hora_fin: '' } : rest
    try {
      await api('/api/citas/admin/bloqueos', { method: 'POST', body })
      setValues((v) => ({ ...v, motivo: '' }))
      onSaved(0)
    } catch (err) {
      if (err.status === 409 && err.data?.citas) onConflicto(body, err.data.citas)
      else setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="admin-card agenda__form" onSubmit={submit}>
      <h2>Bloquear turnos <small>· feriados o mantenimiento</small></h2>
      <div className="agenda__form-row">
        <label>Sede
          <Select value={values.sede} onChange={set('sede')}>
            {SEDES.filter((s) => s.value).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </label>
        <label>Fecha
          <DateInput value={values.fecha} min={ymd(new Date())} onChange={set('fecha')} required />
        </label>
      </div>
      <label className="agenda__check">
        <input type="checkbox" checked={values.todo} onChange={set('todo')} /> Todo el día
      </label>
      {!values.todo && (
        <div className="agenda__form-row">
          <label>Desde
            <Select value={values.hora_inicio} onChange={set('hora_inicio')}>
              {HORAS.slice(0, -1).map((h) => <option key={h}>{h}</option>)}
            </Select>
          </label>
          <label>Hasta
            <Select value={values.hora_fin} onChange={set('hora_fin')}>
              {HORAS.slice(1).map((h) => <option key={h}>{h}</option>)}
            </Select>
          </label>
        </div>
      )}
      <label>Motivo
        <input value={values.motivo} onChange={set('motivo')} placeholder="Feriado, fumigación, capacitación…" minLength={3} maxLength={120} required />
      </label>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <button className="btn btn--dark btn--sm" disabled={sending}>{sending ? 'Guardando…' : 'Bloquear'}</button>
    </form>
  )
}

// Una columna por consultorio, mesa o profesional (de cada servicio) y una fila por turno: se ve de un
// vistazo quién está libre. Para cambiar una cita se usa la vista por hora o su tarjeta.
function AgendaColumnas({ citas, fecha, onAccion }) {
  const columnas = [...new Set(citas.map((c) => `${c.servicio.nombre} · ${lugar(c)}`))].sort()
  const filas = [...new Set(citas.map((c) => (c.inicio.slice(0, 10) === fecha ? c.inicio.slice(11, 16) : 'Estadías')))].sort()
  const celda = (fila, col) => citas.filter((c) => `${c.servicio.nombre} · ${lugar(c)}` === col
    && (c.inicio.slice(0, 10) === fecha ? c.inicio.slice(11, 16) : 'Estadías') === fila)
  return (
    <div className="table-scroll">
      <table className="admin-table agenda-grid">
        <thead><tr><th>Hora</th>{columnas.map((col) => <th key={col}>{col}</th>)}</tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f}>
              <td className="mono">{f}</td>
              {columnas.map((col) => (
                <td key={col}>
                  {celda(f, col).map((c) => (
                    <button key={c.id} className={`agenda-grid__cita agenda-card--${c.estado}`} onClick={() => onAccion({ tipo: 'reprogramar', cita: c })}
                      title={`${c.cliente.nombre} · ${CITA_STATUS[c.estado].label}. Clic para reprogramar`}>
                      <PetIcon especie={c.mascota.especie} size={14} /> {c.mascota.nombre}
                      <small>{CITA_STATUS[c.estado].label}</small>
                    </button>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
