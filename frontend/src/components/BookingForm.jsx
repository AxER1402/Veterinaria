import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Plus, Phone } from 'lucide-react'
import { PawIcon } from './Brand'
import Field from './Field'
import PetForm from './PetForm'
import SlotPicker from './SlotPicker'
import { cuerpoReserva, eleccionLista } from './reserva'
import { api } from '../api'
import { useAuth } from '../context/useAuth'
import { services } from '../data/content'
import { formatPrice } from '../data/shop'
import PetIcon from './PetIcon'
import { TELEFONO_CLINICA, formatDay, formatReserva, noches } from '../pages/account/citas'
import Select from './Select'

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

// Solo ayuda al usuario: el servidor vuelve a validar todo.
const TELEFONO = /^\+?[0-9 ()-]{7,20}$/
const MOTIVOS = ['Control o chequeo', 'Vacunación', 'Vómitos o diarrea', 'Problema de piel', 'Cojera', 'No quiere comer', 'Otro']

export default function BookingForm() {
  const { user, checking } = useAuth()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const [draft] = useState(readDraft)

  const [servicios, setServicios] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [servicio, setServicio] = useState(params.get('servicio') || draft.servicio || '')
  const [eleccion, setEleccion] = useState({ fecha: draft.fecha || '', hora: draft.hora || '', salida: draft.salida || '' })
  const [profesional, setProfesional] = useState(draft.profesional || '')
  const [cita, setCita] = useState(null)

  useEffect(() => {
    api('/api/citas/servicios', { auth: false })
      .then((d) => {
        setServicios(d.servicios)
        setServicio((s) => (d.servicios.some((x) => x.slug === s) ? s : d.servicios[0]?.slug || ''))
      })
      .catch((e) => setLoadError(e.message))
  }, [])

  const elegido = servicios?.find((s) => s.slug === servicio)
  const lista = elegido && eleccionLista(elegido.modalidad, eleccion)

  const elegirServicio = (slug) => {
    if (slug === servicio) return
    setServicio(slug)
    setProfesional('')
    setEleccion({ fecha: '', hora: '', salida: '' })
  }

  return (
    <section className="reserva-seccion" id="reservar">
      <div className="container">
        {cita ? (
          <div className="reserva__tarjeta reserva__exito">
            <Success {...cita} onReset={() => { setCita(null); setEleccion({ fecha: '', hora: '', salida: '' }) }} />
          </div>
        ) : loadError ? (
          <p className="form-alert" role="alert">No se pudieron cargar los servicios: {loadError}</p>
        ) : !servicios ? (
          <p className="booking__muted">Cargando servicios…</p>
        ) : (
          <div className="reserva">
            <div className="reserva__pasos">
              <fieldset className="reserva__tarjeta booking__group">
                <legend>1. Servicio</legend>
                <div className="reserva__servicios" role="radiogroup" aria-label="Servicio">
                  {servicios.map((s) => {
                    const Icon = services.find((x) => x.slug === s.slug)?.icon ?? PawIcon
                    return (
                      <button key={s.slug} type="button" role="radio" aria-checked={s.slug === servicio}
                        className={`reserva__servicio ${s.slug === servicio ? 'is-activo' : ''}`} onClick={() => elegirServicio(s.slug)}>
                        <Icon size={24} strokeWidth={1.8} aria-hidden="true" />
                        <strong>{s.nombre}</strong>
                        <small>Desde {formatPrice(s.precio_desde)}</small>
                      </button>
                    )
                  })}
                </div>
                {elegido?.profesionales?.length > 0 && (
                  <Field label="¿Con quién? (opcional)">
                    <Select value={profesional} onChange={(e) => { setProfesional(e.target.value); setEleccion({ fecha: '', hora: '', salida: '' }) }}>
                      <option value="">Con quien tenga lugar</option>
                      {elegido.profesionales.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </Select>
                  </Field>
                )}
              </fieldset>

              {elegido && (
                <div className="reserva__tarjeta">
                  <SlotPicker servicio={servicio} modalidad={elegido.modalidad} value={eleccion} onChange={setEleccion} profesional={profesional} />
                </div>
              )}
            </div>

            <aside className="reserva__lado">
              {elegido && <Resumen servicio={elegido} eleccion={eleccion} profesional={profesional} />}
              <div className="reserva__tarjeta">
                {checking ? null : !user ? (
                  <LoginPrompt disabled={!lista} onGo={() => saveDraft({ servicio, profesional, ...eleccion })} from={pathname} />
                ) : (
                  <Confirm
                    key={user.id || user.email}
                    user={user}
                    lista={lista}
                    consulta={servicio === 'veterinaria'}
                    mascotaInicial={params.get('mascota')}
                    reserva={{ servicio, ...cuerpoReserva(elegido?.modalidad, eleccion), ...(profesional ? { profesional_id: Number(profesional) } : {}) }}
                    onDone={(r) => { saveDraft(null); setCita(r) }}
                    onTaken={() => setEleccion((e) => ({ ...e, hora: '' }))}
                  />
                )}
              </div>
              <p className="booking__urgent">
                <Phone size={18} /> <span>¿Es una urgencia? No esperes una cita: llámanos al <a href={`tel:${TELEFONO_CLINICA.replace(/[^+\d]/g, '')}`}>{TELEFONO_CLINICA}</a>.</span>
              </p>
            </aside>
          </div>
        )}
      </div>
    </section>
  )
}

// Lo elegido hasta ahora: en escritorio queda a la vista mientras se recorren los pasos.
function Resumen({ servicio, eleccion, profesional }) {
  const { modalidad } = servicio
  const { fecha, hora, salida } = eleccion
  const persona = servicio.profesionales?.find((p) => String(p.id) === String(profesional))
  const falta = <span className="reserva__falta">Por elegir</span>
  return (
    <div className="reserva__tarjeta reserva__resumen">
      <h2>Tu reserva</h2>
      <dl>
        <dt>Servicio</dt>
        <dd>{servicio.nombre}</dd>
        {persona && (
          <>
            <dt>Con</dt>
            <dd>{persona.nombre}</dd>
          </>
        )}
        <dt>{modalidad === 'estadia' ? 'Entrada' : 'Día'}</dt>
        <dd className="reserva__fecha">{fecha ? formatDay(fecha) : falta}</dd>
        {modalidad === 'turno' && (
          <>
            <dt>Hora</dt>
            <dd>{hora || falta}</dd>
          </>
        )}
        {modalidad === 'estadia' && (
          <>
            <dt>Salida</dt>
            <dd className="reserva__fecha">{salida ? `${formatDay(salida)} · ${noches(fecha, salida)} ${noches(fecha, salida) === 1 ? 'noche' : 'noches'}` : falta}</dd>
          </>
        )}
        <dt>Sede</dt>
        <dd>{servicio.sede.nombre}</dd>
      </dl>
      <p className="reserva__precio"><span>Desde</span> <strong>{formatPrice(servicio.precio_desde)}</strong></p>
      {servicio.slug === 'guarderia' && <p className="reserva__promo">¿Primera vez? Tu primer día de guardería es <strong>gratis</strong>.</p>}
    </div>
  )
}

function LoginPrompt({ disabled, onGo, from }) {
  return (
    <div className="booking__login">
      <h2 className="reserva__titulo">4. Confirma tu cita</h2>
      <p>Entra a tu cuenta o crea una. Así podrás ver, cambiar y cancelar tus citas cuando quieras.</p>
      <Link to="/cuenta" state={{ from }} onClick={onGo} className={`btn btn--primary btn--block ${disabled ? 'btn--muted' : ''}`}>
        Ingresar o crear cuenta
      </Link>
      {disabled && <p className="booking__muted">Primero elige el día{' '}y el horario.</p>}
    </div>
  )
}

function Confirm({ user, lista, consulta, mascotaInicial, reserva, onDone, onTaken }) {
  const { setPerfil } = useAuth()
  const [mascotas, setMascotas] = useState(null)
  const [mascotaId, setMascotaId] = useState('')
  const [adding, setAdding] = useState(false)
  const [values, setValues] = useState({ nombre: user.nombre || '', telefono: user.telefono || '', motivo: '', notas: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }))

  useEffect(() => {
    api('/api/citas/mascotas')
      .then((d) => {
        setMascotas(d.mascotas)
        const inicial = d.mascotas.find((m) => m.id === mascotaInicial)
        if (inicial || d.mascotas.length === 1) setMascotaId((inicial || d.mascotas[0]).id)
        if (d.mascotas.length === 0) setAdding(true)
      })
      .catch((e) => setError(e.message))
  }, [mascotaInicial])

  const submit = async (e) => {
    e.preventDefault()
    const found = {}
    if (!lista) found.hora = 'Elige el día y el horario'
    if (!mascotaId) found.mascota_id = 'Elige qué mascota viene'
    if (values.nombre.trim().length < 2) found.nombre = 'Ingresa tu nombre'
    if (!TELEFONO.test(values.telefono.trim()) || values.telefono.replace(/\D/g, '').length < 7) found.telefono = 'Teléfono no válido'
    if (consulta && !values.motivo) found.motivo = 'Elige el motivo de la consulta'
    setErrors(found)
    if (Object.keys(found).length) return
    setSending(true)
    setError('')
    const notas = [consulta ? values.motivo : '', values.notas.trim()].filter(Boolean).join(': ')
    try {
      const d = await api('/api/citas', {
        method: 'POST',
        body: { ...reserva, mascota_id: mascotaId, nombre: values.nombre.trim(), telefono: values.telefono.trim(), notas },
      })
      // El teléfono queda en el perfil para la próxima reserva o compra.
      if (values.telefono.trim() !== (user.telefono || '')) {
        api('/api/auth/perfil', { method: 'PATCH', body: { telefono: values.telefono.trim() } })
          .then((p) => setPerfil({ telefono: p.usuario.telefono }))
          .catch(() => {})
      }
      onDone({ cita: d.cita, aviso: d.aviso })
    } catch (err) {
      if (err.data?.campo && !['hora', 'fecha', 'salida'].includes(err.data.campo)) setErrors({ [err.data.campo === 'notas' ? 'motivo' : err.data.campo]: err.message })
      else setError(err.message)
      // Otro cliente ganó el turno (o ya pasó la hora): se recargan los horarios.
      if ((err.status === 409 && /llenar/.test(err.message)) || err.data?.campo === 'hora') onTaken()
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
            {mascotas.map((m) => (
              <label key={m.id} className={mascotaId === m.id ? 'active' : ''}>
                <input type="radio" name="mascota" value={m.id} checked={mascotaId === m.id} onChange={() => setMascotaId(m.id)} />
                <PetIcon especie={m.especie} size={22} /> {m.nombre}
              </label>
            ))}
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

      {consulta && (
        <fieldset className="booking__group">
          <legend>Motivo de la consulta</legend>
          <div className="chips-row" role="radiogroup" aria-label="Motivo de la consulta">
            {MOTIVOS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={values.motivo === m}
                className={`chip ${values.motivo === m ? 'chip--active' : ''}`} onClick={() => setValues((v) => ({ ...v, motivo: m }))}>{m}</button>
            ))}
          </div>
          {errors.motivo && <small className="field-error">{errors.motivo}</small>}
        </fieldset>
      )}

      <div className="form-grid">
        <Field label="Nombre de quien la trae" error={errors.nombre}>
          <input value={values.nombre} onChange={set('nombre')} autoComplete="name" maxLength={100} />
        </Field>
        <Field label="Teléfono" error={errors.telefono}>
          <input type="tel" value={values.telefono} onChange={set('telefono')} autoComplete="tel" placeholder="5555 1234" maxLength={20} />
        </Field>
        <Field label={consulta ? 'Cuéntanos más (opcional)' : 'Mensaje (opcional)'} error={errors.notas} full>
          <textarea rows="2" placeholder={consulta ? 'Desde cuándo, qué notaste…' : 'Indicaciones, cuidados especiales…'} value={values.notas}
            onChange={set('notas')} maxLength={250} />
        </Field>
      </div>
      {(error || errors.hora) && <p className="form-alert" role="alert">{error || errors.hora}</p>}
      <button type="submit" className="btn btn--primary btn--block" disabled={sending || adding}>
        {sending ? 'Reservando…' : reserva.hora ? `Reservar a las ${reserva.hora}` : 'Reservar'}
      </button>
      <p className="account__hint">Se paga en la sede. Puedes cambiarla o cancelarla hasta 2 horas antes desde «Mis citas».</p>
    </form>
  )
}

function Success({ cita, aviso, onReset }) {
  return (
    <div className="booking__success">
      <CheckCircle2 size={64} />
      <h3>¡Cita reservada!</h3>
      <p>
        <strong>{cita.servicio.nombre}</strong> para <PetIcon especie={cita.mascota.especie} size={16} className="inline-icon" /> {cita.mascota.nombre}
        <br />
        {formatReserva(cita)}{cita.profesional && ` · con ${cita.profesional}`}
        <br />
        {cita.sede.nombre}
      </p>
      {aviso && <p className="form-alert form-alert--soft">{aviso}</p>}
      <p className="booking__muted">Queda pendiente de confirmar. Te avisaremos por correo.</p>
      <div className="booking__success-actions">
        <Link to="/cuenta/citas" className="btn btn--dark">Ver mis citas</Link>
        <button type="button" className="link-btn" onClick={onReset}>Reservar otra</button>
      </div>
    </div>
  )
}
