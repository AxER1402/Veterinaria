import { useEffect, useState } from 'react'
import { CalendarX2 } from 'lucide-react'
import { api } from '../api'
import { MAX_DIAS, addDays, formatDay, noches, ymd } from '../pages/account/citas'

const DIAS_VISIBLES = 12

// Día y hora de una reserva según el servicio:
//   turno   → día y turno de 30 min
//   dia     → solo el día (guardería, entrada a las 8:00)
//   estadia → entrada y salida (hospedaje)
// Abre en el primer día con lugar y marca los llenos con el calendario del servidor, que vuelve a
// validar todo al reservar. `value` = { fecha, hora, salida }.
export default function SlotPicker({ servicio, modalidad, value, onChange, numerado = true }) {
  // Cada respuesta guarda la consulta que la pidió: si llega tarde la de otro día o servicio, no se muestra.
  const [cal, setCal] = useState(null)
  const [disp, setDisp] = useState(null)
  const [estadia, setEstadia] = useState(null)
  const { fecha, hora, salida } = value
  const calendario = cal?.clave === servicio ? cal.datos : null
  const turnos = disp?.clave === `${servicio}|${fecha}` ? disp.datos : null
  const libresEstadia = estadia?.clave === `${servicio}|${fecha}|${salida}` ? estadia.datos : null
  const n = (paso) => (numerado ? `${paso}. ` : '')

  useEffect(() => {
    if (!servicio) return
    let vigente = true
    api(`/api/citas/calendario?servicio=${encodeURIComponent(servicio)}`, { auth: false })
      .then((d) => {
        if (!vigente) return
        setCal({ clave: servicio, datos: d })
        // Si no hay fecha elegida (o ya no tiene lugar), se abre en el primer día libre.
        const elegido = d.dias.find((x) => x.fecha === fecha)
        if (!elegido || elegido.estado !== 'libre') onChange({ fecha: d.primer_dia_libre || '', hora: '', salida: '' })
      })
      .catch(() => vigente && setCal({ clave: servicio, datos: { dias: [], error: true } }))
    return () => { vigente = false }
    // Solo al cambiar de servicio: la fecha elegida después no debe recargar el calendario.
  }, [servicio]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!servicio || !fecha) return
    let vigente = true
    const clave = `${servicio}|${fecha}`
    api(`/api/citas/disponibilidad?servicio=${encodeURIComponent(servicio)}&fecha=${fecha}`, { auth: false })
      .then((d) => vigente && setDisp({ clave, datos: d.turnos }))
      .catch((e) => vigente && setDisp({ clave, datos: { error: e.message } }))
    return () => { vigente = false }
  }, [servicio, fecha])

  useEffect(() => {
    if (modalidad !== 'estadia' || !fecha || !salida) return
    let vigente = true
    const clave = `${servicio}|${fecha}|${salida}`
    api(`/api/citas/disponibilidad?servicio=${encodeURIComponent(servicio)}&fecha=${fecha}&salida=${salida}`, { auth: false })
      .then((d) => vigente && setEstadia({ clave, datos: d.libres_estadia }))
      .catch((e) => vigente && setEstadia({ clave, datos: { error: e.message } }))
    return () => { vigente = false }
  }, [servicio, modalidad, fecha, salida])

  const hoy = ymd(new Date())
  const max = ymd(addDays(new Date(), MAX_DIAS))
  const inicio = calendario?.dias.findIndex((d) => d.estado === 'libre') ?? -1
  const visibles = calendario?.dias.slice(Math.max(0, inicio), Math.max(0, inicio) + DIAS_VISIBLES) || []
  const otraFecha = fecha && !visibles.some((d) => d.fecha === fecha)
  const elegir = (f) => onChange({ fecha: f, hora: '', salida: '' })

  return (
    <>
      <fieldset className="booking__group">
        <legend>{n(2)}{modalidad === 'estadia' ? 'Entrada' : 'Día'}</legend>
        {!calendario && <p className="booking__muted">Buscando días con lugar…</p>}
        {calendario?.error && <p className="form-alert" role="alert">No se pudo cargar el calendario.</p>}
        {calendario && !calendario.error && !calendario.primer_dia_libre && (
          <p className="booking__empty"><CalendarX2 size={20} /> No quedan lugares en los próximos {MAX_DIAS} días. Llámanos.</p>
        )}
        {visibles.length > 0 && (
          <div className="day-picker">
            {visibles.map((d) => (
              <button key={d.fecha} type="button" disabled={d.estado !== 'libre'}
                className={`day-chip ${fecha === d.fecha ? 'active' : ''} ${d.estado !== 'libre' ? 'day-chip--full' : ''}`}
                aria-pressed={fecha === d.fecha} onClick={() => elegir(d.fecha)}
                title={d.estado === 'lleno' ? 'Sin lugar' : d.estado === 'cerrado' ? 'Cerrado' : undefined}>
                {d.fecha === hoy ? 'Hoy' : formatDay(d.fecha, true)}
                {d.estado !== 'libre' && <small>{d.estado === 'lleno' ? 'lleno' : 'cerrado'}</small>}
              </button>
            ))}
            <label className={`day-chip day-chip--input ${otraFecha ? 'active' : ''}`}>
              <span>Otra fecha</span>
              <input type="date" min={hoy} max={max} value={otraFecha ? fecha : ''} onChange={(e) => e.target.value && elegir(e.target.value)} />
            </label>
          </div>
        )}
      </fieldset>

      {fecha && modalidad === 'turno' && (
        <fieldset className="booking__group">
          <legend>{n(3)}Hora · {formatDay(fecha)}</legend>
          {!turnos && <p className="booking__muted">Buscando horarios libres…</p>}
          {turnos?.error && <p className="form-alert" role="alert">{turnos.error}</p>}
          {Array.isArray(turnos) && turnos.length === 0 && (
            <p className="booking__empty">
              <CalendarX2 size={20} />
              {new Date(`${fecha}T12:00:00`).getDay() === 0 ? 'Los domingos estamos cerrados. Elige otro día.' : 'No quedan horarios libres este día. Prueba con otro.'}
            </p>
          )}
          {Array.isArray(turnos) && turnos.length > 0 && (
            <div className="slot-grid">
              {turnos.map((t) => (
                <button key={t.hora} type="button" className={`slot ${hora === t.hora ? 'active' : ''}`} aria-pressed={hora === t.hora}
                  onClick={() => onChange({ ...value, hora: t.hora })}>
                  {t.hora}
                  {t.libres === 1 && <small>último cupo</small>}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      )}

      {fecha && modalidad === 'dia' && (
        <p className="booking__sede">
          {Array.isArray(turnos) && turnos[0]
            ? <>Entrada el {formatDay(fecha)} a las 08:00 · quedan <strong>{turnos[0].libres}</strong> lugares.</>
            : turnos ? 'Ese día ya no hay lugar.' : 'Revisando lugares…'}
        </p>
      )}

      {fecha && modalidad === 'estadia' && (
        <fieldset className="booking__group">
          <legend>{n(3)}Salida</legend>
          <label className="booking__salida">
            <input type="date" min={ymd(addDays(new Date(`${fecha}T12:00:00`), 1))} max={ymd(addDays(new Date(`${fecha}T12:00:00`), 30))}
              value={salida || ''} onChange={(e) => onChange({ ...value, hora: '08:00', salida: e.target.value })} />
            {salida && <span>{noches(fecha, salida)} {noches(fecha, salida) === 1 ? 'noche' : 'noches'} · entrada y salida a las 08:00</span>}
          </label>
          {salida && libresEstadia !== null && (
            typeof libresEstadia === 'object'
              ? <p className="form-alert" role="alert">{libresEstadia.error}</p>
              : libresEstadia === 0
                ? <p className="booking__empty"><CalendarX2 size={20} /> No quedan lugares para esas noches. Prueba otras fechas.</p>
                : <p className="booking__muted">Quedan {libresEstadia} lugares para esas noches.</p>
          )}
        </fieldset>
      )}
    </>
  )
}
