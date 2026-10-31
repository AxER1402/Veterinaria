import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, Plus, Search, Trash2 } from 'lucide-react'
import Modal from '../../components/Modal'
import PetIcon from '../../components/PetIcon'
import { METODOS_PAGO } from '../../data/recibos'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { ymd } from '../account/citas'

const normalizar = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const RAPIDOS = ['Vacuna', 'Medicamento', 'Examen', 'Desparasitación']

const lineaDeCita = (c) => ({ concepto: c.servicio.nombre, cantidad: 1, precio_unitario: String(c.servicio.precio_desde ?? '') })

// Arma la cuenta de una cita o de una mascota y la deja pagada o pendiente. Todo cobro queda ligado a una
// mascota de verdad: se elige de la lista, no se escribe. El total lo calcula el servidor.
export default function CobroForm({ cita: citaInicial, mascota, onClose, onDone }) {
  const [cita, setCita] = useState(citaInicial || null)
  const [elegida, setElegida] = useState(mascota || null)
  const [pacientes, setPacientes] = useState(null)
  const [deHoy, setDeHoy] = useState([])
  const [buscar, setBuscar] = useState('')
  const [lineas, setLineas] = useState(citaInicial ? [lineaDeCita(citaInicial)] : [{ concepto: '', cantidad: 1, precio_unitario: '' }])
  const [cobrar, setCobrar] = useState(true)
  const [metodo, setMetodo] = useState('efectivo')
  const [referencia, setReferencia] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (citaInicial || mascota) return
    api('/api/citas/admin/pacientes').then((d) => setPacientes(d.pacientes.filter((p) => p.activa))).catch((e) => setError(e.message))
    api(`/api/citas/admin/agenda?fecha=${ymd(new Date())}`)
      .then((d) => setDeHoy(d.citas.filter((c) => !c.cobro && !['cancelada', 'no_asistio'].includes(c.estado))))
      .catch(() => {})
  }, [citaInicial, mascota])

  const elegirCita = (c) => {
    setCita(c)
    setElegida(null)
    setLineas([lineaDeCita(c)])
  }
  const cambiar = () => {
    setCita(null)
    setElegida(null)
    setBuscar('')
    setLineas([{ concepto: '', cantidad: 1, precio_unitario: '' }])
  }

  const setLinea = (i, f) => (e) => setLineas((l) => l.map((x, j) => (j === i ? { ...x, [f]: f === 'cantidad' ? Number(e.target.value) : e.target.value } : x)))
  const total = lineas.reduce((n, l) => n + (Number(l.precio_unitario) || 0) * (l.cantidad || 0), 0)
  const hallados = buscar.trim().length >= 2
    ? (pacientes || []).filter((p) => [p.nombre, p.raza, p.dueno.nombre, p.dueno.email, p.dueno.telefono].some((x) => normalizar(x).includes(normalizar(buscar.trim())))).slice(0, 8)
    : []

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      const d = await api('/api/citas/admin/cobros', {
        method: 'POST',
        body: {
          ...(cita ? { cita_id: cita.id } : { mascota_id: elegida.id, cliente_nombre: elegida.dueno?.nombre || undefined }),
          lineas: lineas.filter((l) => l.concepto.trim()).map((l) => ({ concepto: l.concepto.trim(), cantidad: l.cantidad, precio_unitario: Number(l.precio_unitario) })),
          ...(cobrar ? { pago: { metodo, referencia: referencia.trim() } } : {}),
        },
      })
      onDone(d.cobro)
    } catch (err) {
      setError(err.message)
      setSending(false)
    }
  }

  const mascotaCobro = cita ? { ...cita.mascota, dueno: cita.cliente } : elegida
  const fijo = Boolean(citaInicial || mascota)

  return (
    <Modal title="Cobrar" onClose={onClose} wide dirty={lineas.some((l) => l.precio_unitario && !cita)}>
      <form className="clinical-form cobro" onSubmit={submit}>
        {mascotaCobro ? (
          <div className="cobro__mascota">
            <span className="cita-fila__icono"><PetIcon especie={mascotaCobro.especie} size={24} /></span>
            <span className="fila__principal">
              <strong>{mascotaCobro.nombre}</strong>
              <small>{mascotaCobro.dueno?.nombre}{cita && ` · ${cita.servicio.nombre}`}</small>
            </span>
            {!fijo && <button type="button" className="link-btn" onClick={cambiar}>Cambiar</button>}
          </div>
        ) : (
          <div className="cobro__elegir">
            {deHoy.length > 0 && (
              <>
                <p className="cobro__rotulo">Citas de hoy sin cobrar</p>
                <ul className="cobro__hallados">
                  {deHoy.map((c) => (
                    <li key={c.id}><button type="button" onClick={() => elegirCita(c)}>
                      <CalendarCheck size={16} aria-hidden="true" /> <span><b>{c.mascota.nombre}</b> · {c.servicio.nombre}</span> <small>{c.inicio.slice(11, 16)} · {c.cliente.nombre}</small>
                    </button></li>
                  ))}
                </ul>
              </>
            )}
            <label className="cobro__rotulo" htmlFor="cobro-buscar">Buscar la mascota</label>
            <span className="search admin-search"><Search size={18} aria-hidden="true" />
              <input id="cobro-buscar" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Mascota, dueño, correo o teléfono" autoComplete="off" />
            </span>
            {hallados.length > 0 && (
              <ul className="cobro__hallados">
                {hallados.map((p) => (
                  <li key={p.id}><button type="button" onClick={() => setElegida(p)}>
                    <PetIcon especie={p.especie} size={18} /> <span><b>{p.nombre}</b>{p.raza && ` · ${p.raza}`}</span> <small>{p.dueno.nombre}</small>
                  </button></li>
                ))}
              </ul>
            )}
            {buscar.trim().length >= 2 && pacientes && hallados.length === 0 && (
              <p className="summary__hint">No aparece esa mascota. Regístrala primero en la <Link to="/admin/clientes" onClick={onClose}>ficha de su dueño</Link>.</p>
            )}
          </div>
        )}

        <fieldset className="cobro__lineas">
          <legend>Conceptos</legend>
          {lineas.map((l, i) => (
            <div key={i} className="cobro__linea">
              <label>Concepto
                <input value={l.concepto} onChange={setLinea(i, 'concepto')} maxLength={120} required />
              </label>
              <label>Cant.
                <input type="number" min="1" max="999" value={l.cantidad} onChange={setLinea(i, 'cantidad')} required />
              </label>
              <label>Precio (Q)
                <input type="number" min="0" step="0.01" value={l.precio_unitario} onChange={setLinea(i, 'precio_unitario')} required />
              </label>
              <button type="button" className="icon-btn icon-btn--ghost" aria-label={`Quitar concepto ${i + 1}`} disabled={lineas.length === 1}
                onClick={() => setLineas((x) => x.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
          <div className="chips-row">
            {RAPIDOS.map((r) => (
              <button key={r} type="button" className="chip" onClick={() => setLineas((x) => [...x, { concepto: r, cantidad: 1, precio_unitario: '' }])}><Plus size={14} aria-hidden="true" /> {r}</button>
            ))}
            <button type="button" className="chip" onClick={() => setLineas((x) => [...x, { concepto: '', cantidad: 1, precio_unitario: '' }])}><Plus size={14} aria-hidden="true" /> Otro</button>
          </div>
        </fieldset>

        <p className="cobro__total"><span>Total</span><strong>{formatPrice(total)}</strong></p>

        <div className="segmentos" role="group" aria-label="Cuándo se paga">
          <button type="button" className={cobrar ? 'is-activo' : ''} aria-pressed={cobrar} onClick={() => setCobrar(true)}>Cobrar ahora</button>
          <button type="button" className={!cobrar ? 'is-activo' : ''} aria-pressed={!cobrar} onClick={() => setCobrar(false)}>Dejar pendiente</button>
        </div>
        {cobrar && (
          <div className="agenda__form-row">
            <div className="cobro__metodos" role="group" aria-label="Cómo pagó">
              {Object.entries(METODOS_PAGO).map(([k, v]) => (
                <button key={k} type="button" className={`chip ${metodo === k ? 'chip--active' : ''}`} aria-pressed={metodo === k} onClick={() => setMetodo(k)}>{v}</button>
              ))}
            </div>
            {metodo !== 'efectivo' && (
              <label>Referencia (opcional)
                <input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={60} placeholder="Autorización o número de boleta" />
              </label>
            )}
          </div>
        )}
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="pet-form__actions">
          <button className="btn btn--dark btn--sm" disabled={sending || !mascotaCobro || total <= 0}>{sending ? 'Guardando…' : cobrar ? `Cobrar ${formatPrice(total)}` : 'Guardar pendiente'}</button>
          <button type="button" className="link-btn" onClick={onClose}>Volver</button>
        </div>
      </form>
    </Modal>
  )
}
