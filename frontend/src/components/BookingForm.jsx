import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { CheckCircle2, MapPin, Plus, CalendarX2 } from 'lucide-react'
import SectionTitle from './SectionTitle'
import Field from './Field'
import PetForm from './PetForm'
import { api } from '../api'
import { useAuth } from '../context/useAuth'
import { formatPrice } from '../data/shop'
import PetIcon from './PetIcon'
import { MAX_DIAS, addDays, formatCita, formatDay, ymd } from '../pages/account/citas'

// Lo elegido antes de ir a ingresar: al volver, la reserva sigue donde estaba.
const DRAFT_KEY = 'huellitas-reserva'
const readDraft = () => {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY)) || {}
  } catch {
    return {}
  }
}
const saveDraft = (d) => {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // sin sessionStorage solo se pierde la comodidad
  }
}

// Próximos días que abre la clínica (lunes a sábado).
function nextOpenDays(n) {
  const days = []
  for (let d = new Date(); days.length < n; d = addDays(d, 1)) {
    if (d.getDay() !== 0) days.push(ymd(d))
  }
  return days
}

// Solo ayuda al usuario: el servidor vuelve a validar todo.
const TELEFONO = /^\+?[0-9 ()-]{7,20}$/

export default function BookingForm() {
  const { user, checking } = useAuth()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const [draft] = useState(readDraft)

  const [servicios, setServicios] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [servicio, setServicio] = useState(params.get('servicio') || draft.servicio || '')
  const [fecha, setFecha] = useState(draft.fecha >= ymd(new Date()) ? draft.fecha : nextOpenDays(1)[0])
  const [hora, setHora] = useState(draft.hora || '')
  const [refresh, setRefresh] = useState(0)
  const [cita, setCita] = useState(null)

  const days = useMemo(() => nextOpenDays(12), [])
  const today = ymd(new Date())
  const maxDay = ymd(addDays(new Date(), MAX_DIAS))

  useEffect(() => {
    api('/api/citas/servicios', { auth: false })
      .then((d) => {
        setServicios(d.servicios)
        setServicio((s) => (d.servicios.some((x) => x.slug === s) ? s : d.servicios[0]?.slug || ''))
      })
      .catch((e) => setLoadError(e.message))
  }, [])

  // Turnos libres del día. Cada respuesta lleva la consulta que la pidió: si llega tarde la de
  // otro día o servicio, no se muestra.
  const consulta = `${servicio}|${fecha}|${refresh}`
  const [respuesta, setRespuesta] = useState(null)
  useEffect(() => {
    if (!servicio || !fecha) return
    let vigente = true
    api(`/api/citas/disponibilidad?servicio=${encodeURIComponent(servicio)}&fecha=${encodeURIComponent(fecha)}`, { auth: false })
      .then((d) => vigente && setRespuesta({ consulta, lista: d.turnos }))
      .catch((e) => vigente && setRespuesta({ consulta, lista: [], error: e.message }))
    return () => {
      vigente = false
    }
  }, [servicio, fecha, consulta])
  const turnos = respuesta?.consulta === consulta ? respuesta : null

  // Solo cuenta la hora elegida si ese día sigue libre (la del borrador puede ya no estarlo).
  const horaLibre = turnos && !turnos.error && turnos.lista.some((t) => t.hora === hora) ? hora : ''

  const elegido = servicios?.find((s) => s.slug === servicio)
  const otraFecha = !days.includes(fecha)

  return (
    <section className="section booking" id="reservar">
      <div className="container booking__inner">
        <div className="booking__intro">
          <SectionTitle
            eyebrow="Reserva"
            title="¡Conozcámonos!"
            text="Elige el servicio, el día y un horario libre. La cita se paga en la sede y te la confirmamos por correo."
          />
          <div className="promo">
            <strong>¿Primera vez?</strong>
            <p>Tu primer día de guardería es <span>gratis</span> 🐶</p>
          </div>
        </div>

        <div className="booking__card">
          {cita ? (
            <Success cita={cita} onReset={() => { setCita(null); setHora(''); setRefresh((r) => r + 1) }} />
          ) : loadError ? (
            <p className="form-alert" role="alert">No se pudieron cargar los servicios: {loadError}</p>
          ) : !servicios ? (
            <p className="booking__muted">Cargando servicios…</p>
          ) : (
            <div className="booking__steps">
              <div className="form-grid form-grid--tight">
                <Field label="1. Servicio" full>
                  <select value={servicio} onChange={(e) => { setServicio(e.target.value); setHora('') }}>
                    {servicios.map((s) => (
                      <option key={s.slug} value={s.slug}>{s.nombre} · desde {formatPrice(s.precio_desde)}</option>
                    ))}
                  </select>
                </Field>
              </div>
              {elegido && (
                <p className="booking__sede"><MapPin size={18} /> <span>Se atiende en <strong>{elegido.sede.nombre}</strong></span></p>
              )}

              <fieldset className="booking__group">
                <legend>2. Día</legend>
                <div className="day-picker">
                  {days.map((d) => (
                    <button key={d} type="button" className={`day-chip ${fecha === d ? 'active' : ''}`} aria-pressed={fecha === d}
                      onClick={() => { setFecha(d); setHora('') }}>
                      {d === today ? 'Hoy' : formatDay(d, true)}
                    </button>
                  ))}
                  <label className={`day-chip day-chip--input ${otraFecha ? 'active' : ''}`}>
                    <span>Otra fecha</span>
                    <input type="date" min={today} max={maxDay} value={otraFecha ? fecha : ''}
                      onChange={(e) => { if (e.target.value) { setFecha(e.target.value); setHora('') } }} />
                  </label>
                </div>
              </fieldset>

              <fieldset className="booking__group">
                <legend>3. Hora · {formatDay(fecha)}</legend>
                {!turnos && <p className="booking__muted">Buscando horarios libres…</p>}
                {turnos?.error && <p className="form-alert" role="alert">{turnos.error}</p>}
                {turnos && !turnos.error && turnos.lista.length === 0 && (
                  <p className="booking__empty">
                    <CalendarX2 size={20} />
                    {new Date(`${fecha}T12:00:00`).getDay() === 0
                      ? 'Los domingos estamos cerrados. Elige otro día.'
                      : 'No quedan horarios libres este día. Prueba con otro.'}
                  </p>
                )}
                {turnos?.lista.length > 0 && (
                  <div className="slot-grid">
                    {turnos.lista.map((t) => (
                      <button key={t.hora} type="button" className={`slot ${horaLibre === t.hora ? 'active' : ''}`} aria-pressed={horaLibre === t.hora}
                        onClick={() => setHora(t.hora)}>
                        {t.hora}
                        {t.libres === 1 && <small>último cupo</small>}
                      </button>
                    ))}
                  </div>
                )}
              </fieldset>

              {checking ? null : !user ? (
                <LoginPrompt disabled={!horaLibre} onGo={() => saveDraft({ servicio, fecha, hora: horaLibre })} from={`${pathname}#reservar`} />
              ) : (
                <Confirm
                  key={user.id || user.email}
                  user={user}
                  hora={horaLibre}
                  reserva={{ servicio, fecha, hora: horaLibre }}
                  onDone={(c) => { saveDraft(null); setCita(c) }}
                  onTaken={() => { setHora(''); setRefresh((r) => r + 1) }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function LoginPrompt({ disabled, onGo, from }) {
  return (
    <div className="booking__login">
      <p>
        <strong>4. Tu mascota y tus datos.</strong> Para confirmar la cita entra a tu cuenta o crea una: así puedes ver y
        cancelar tus citas cuando quieras.
      </p>
      <Link to="/cuenta" state={{ from }} onClick={onGo} className={`btn btn--primary btn--block ${disabled ? 'btn--muted' : ''}`}>
        Ingresar o crear cuenta para confirmar
      </Link>
      {disabled && <p className="booking__muted">Primero elige un horario.</p>}
    </div>
  )
}

function Confirm({ user, hora, reserva, onDone, onTaken }) {
  const [mascotas, setMascotas] = useState(null)
  const [mascotaId, setMascotaId] = useState('')
  const [adding, setAdding] = useState(false)
  const [values, setValues] = useState({ nombre: user.nombre || '', telefono: '', notas: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }))

  useEffect(() => {
    api('/api/citas/mascotas')
      .then((d) => {
        setMascotas(d.mascotas)
        if (d.mascotas.length === 1) setMascotaId(d.mascotas[0].id)
        if (d.mascotas.length === 0) setAdding(true)
      })
      .catch((e) => setError(e.message))
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    const found = {}
    if (!hora) found.hora = 'Elige un horario'
    if (!mascotaId) found.mascota_id = 'Elige qué mascota viene'
    if (values.nombre.trim().length < 2) found.nombre = 'Ingresa tu nombre'
    if (!TELEFONO.test(values.telefono.trim()) || values.telefono.replace(/\D/g, '').length < 7) found.telefono = 'Teléfono no válido'
    setErrors(found)
    if (Object.keys(found).length) return
    setSending(true)
    setError('')
    try {
      const d = await api('/api/citas', {
        method: 'POST',
        body: { ...reserva, mascota_id: mascotaId, nombre: values.nombre.trim(), telefono: values.telefono.trim(), notas: values.notas.trim() },
      })
      onDone(d.cita)
    } catch (err) {
      if (err.data?.campo && err.data.campo !== 'hora') setErrors({ [err.data.campo]: err.message })
      else setError(err.message)
      // Otro cliente ganó el turno (o ya pasó la hora): se recargan los horarios.
      if (err.status === 409 && /llenar/.test(err.message)) onTaken()
      if (err.data?.campo === 'hora') onTaken()
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <fieldset className="booking__group">
        <legend>4. ¿Quién viene?</legend>
        {!mascotas && !error && <p className="booking__muted">Cargando tus mascotas…</p>}
        {mascotas?.length > 0 && (
          <div className="pet-picker pet-picker--list">
            {mascotas.map((m) => {
              return (
                <label key={m.id} className={mascotaId === m.id ? 'active' : ''}>
                  <input type="radio" name="mascota" value={m.id} checked={mascotaId === m.id} onChange={() => setMascotaId(m.id)} />
                  <PetIcon especie={m.especie} size={22} /> {m.nombre}
                </label>
              )
            })}
            {!adding && (
              <button type="button" className="pet-picker__add" onClick={() => setAdding(true)}>
                <Plus size={18} /> Otra mascota
              </button>
            )}
          </div>
        )}
        {errors.mascota_id && <small className="field-error">{errors.mascota_id}</small>}
        {adding && mascotas && (
          <div className="booking__newpet">
            <p className="booking__muted">
              {mascotas.length === 0 ? 'Registra a tu mascota para reservar.' : 'Nueva mascota.'} Los demás datos los completas luego
              en <Link to="/cuenta/mascotas">Mis mascotas</Link>.
            </p>
            <PetForm
              compact
              onSaved={(m) => {
                setMascotas((l) => [...l, m])
                setMascotaId(m.id)
                setAdding(false)
              }}
              onCancel={mascotas.length > 0 ? () => setAdding(false) : undefined}
            />
          </div>
        )}
      </fieldset>

      <div className="form-grid">
        <Field label="Nombre de quien la trae" error={errors.nombre}>
          <input value={values.nombre} onChange={set('nombre')} autoComplete="name" maxLength={100} />
        </Field>
        <Field label="Teléfono" error={errors.telefono}>
          <input type="tel" value={values.telefono} onChange={set('telefono')} autoComplete="tel" placeholder="5555 1234" maxLength={20} />
        </Field>
        <Field label="Mensaje (opcional)" error={errors.notas} full>
          <textarea rows="2" placeholder="Motivo de la consulta, indicaciones…" value={values.notas} onChange={set('notas')} maxLength={300} />
        </Field>
      </div>
      {(error || errors.hora) && <p className="form-alert" role="alert">{error || errors.hora}</p>}
      <button type="submit" className="btn btn--primary btn--block" disabled={sending || adding}>
        {sending ? 'Reservando…' : hora ? `Reservar a las ${hora}` : 'Reservar cita'}
      </button>
      <p className="account__hint">Se paga en la sede. Puedes cancelar hasta 2 horas antes desde «Mis citas».</p>
    </form>
  )
}

function Success({ cita, onReset }) {
  return (
    <div className="booking__success">
      <CheckCircle2 size={64} />
      <h3>¡Cita reservada!</h3>
      <p>
        <strong>{cita.servicio.nombre}</strong> para <PetIcon especie={cita.mascota.especie} size={16} className="inline-icon" /> {cita.mascota.nombre}
        <br />
        {formatCita(cita.inicio)}
        <br />
        {cita.sede.nombre}
      </p>
      <p className="booking__muted">Queda pendiente de confirmar. Te avisaremos por correo.</p>
      <div className="booking__success-actions">
        <Link to="/cuenta/citas" className="btn btn--dark">Ver mis citas</Link>
        <button type="button" className="link-btn" onClick={onReset}>Reservar otra</button>
      </div>
    </div>
  )
}
