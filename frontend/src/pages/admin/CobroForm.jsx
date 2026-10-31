import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Modal from '../../components/Modal'
import { METODOS_PAGO } from '../../data/recibos'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'

const normalizar = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const RAPIDOS = ['Vacuna', 'Medicamento', 'Examen', 'Desparasitación']

// Arma la cuenta de una cita o de una mascota y la deja pagada o pendiente. El total lo calcula el servidor.
export default function CobroForm({ cita, mascota, onClose, onDone }) {
  const [elegida, setElegida] = useState(mascota || null)
  const [pacientes, setPacientes] = useState(null)
  const [buscar, setBuscar] = useState('')
  const [lineas, setLineas] = useState(cita ? [{ concepto: cita.servicio.nombre, cantidad: 1, precio_unitario: String(cita.servicio.precio_desde ?? '') }] : [{ concepto: '', cantidad: 1, precio_unitario: '' }])
  const [cobrar, setCobrar] = useState(true)
  const [metodo, setMetodo] = useState('efectivo')
  const [referencia, setReferencia] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (cita || mascota) return
    api('/api/citas/admin/pacientes').then((d) => setPacientes(d.pacientes.filter((p) => p.activa))).catch((e) => setError(e.message))
  }, [cita, mascota])

  const setLinea = (i, f) => (e) => setLineas((l) => l.map((x, j) => (j === i ? { ...x, [f]: f === 'cantidad' ? Number(e.target.value) : e.target.value } : x)))
  const total = lineas.reduce((n, l) => n + (Number(l.precio_unitario) || 0) * (l.cantidad || 0), 0)
  const hallados = buscar.trim().length >= 2
    ? (pacientes || []).filter((p) => [p.nombre, p.dueno.nombre, p.dueno.telefono].some((x) => normalizar(x).includes(normalizar(buscar.trim())))).slice(0, 8)
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

  const para = cita ? `${cita.mascota.nombre} · ${cita.cliente.nombre}` : elegida && `${elegida.nombre}${elegida.dueno?.nombre ? ` · ${elegida.dueno.nombre}` : ''}`

  return (
    <Modal title="Cobrar" onClose={onClose} wide dirty={lineas.some((l) => l.precio_unitario && !cita)}>
      <form className="clinical-form cobro" onSubmit={submit}>
        {para ? <p className="modal__sub">{para}</p> : (
          <label>Mascota o dueño
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Escribe al menos 2 letras" autoFocus />
            {hallados.length > 0 && (
              <ul className="cobro__hallados">
                {hallados.map((p) => <li key={p.id}><button type="button" onClick={() => setElegida(p)}>{p.nombre} <small>{p.dueno.nombre}</small></button></li>)}
              </ul>
            )}
          </label>
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
          <button className="btn btn--dark btn--sm" disabled={sending || !para || total <= 0}>{sending ? 'Guardando…' : cobrar ? `Cobrar ${formatPrice(total)}` : 'Guardar pendiente'}</button>
          <button type="button" className="link-btn" onClick={onClose}>Volver</button>
        </div>
      </form>
    </Modal>
  )
}
