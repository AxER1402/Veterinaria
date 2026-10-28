import { useRef, useState } from 'react'
import { AlertTriangle, Paperclip, Plus, Printer, Trash2 } from 'lucide-react'
import Modal from '../../components/Modal'
import PetIcon from '../../components/PetIcon'
import { api } from '../../api'
import { formatCita, ymd } from '../account/citas'
import { fechaCorta } from '../account/vacunas'

const VACUNAS_COMUNES = ['Rabia', 'Séxtuple', 'Parvovirus', 'Moquillo', 'Triple felina', 'Leucemia felina', 'Bordetella']
const DESPARASITANTES = ['Drontal Plus', 'Milbemax', 'Bravecto', 'NexGard Spectra', 'Simparica Trio', 'Revolution']
const MOTIVOS = ['Control', 'Vacunación', 'Vómitos o diarrea', 'Problema de piel', 'Cojera', 'No come', 'Herida', 'Urgencia']

const MUCOSAS = { rosadas: 'Rosadas', palidas: 'Pálidas', ictericas: 'Ictéricas', cianoticas: 'Cianóticas', congestivas: 'Congestivas' }
const HIDRATACION = { normal: 'Normal', leve: 'Deshidratación leve', moderada: 'Deshidratación moderada', severa: 'Deshidratación severa' }

const FICHA_VACIA = {
  motivo: '', anamnesis: '', peso_kg: '', temperatura_c: '', frecuencia_cardiaca: '', frecuencia_respiratoria: '', mucosas: '',
  hidratacion: '', condicion_corporal: '', diagnostico: '', tratamiento: '', indicaciones: '', proximo_control: '',
}
const MED_VACIO = { nombre: '', dosis: '', frecuencia: '', duracion: '' }
const VAC_VACIA = { tipo: 'vacuna', nombre: '', lote: '', proxima_dosis: '' }
const NUMEROS = ['peso_kg', 'temperatura_c', 'frecuencia_cardiaca', 'frecuencia_respiratoria', 'condicion_corporal']

// Alergias y enfermedades crónicas: se muestran como alerta en la agenda, la ficha y el formulario.
export function AlertasClinicas({ mascota, compact = false }) {
  if (!mascota.alergias && !mascota.enfermedades_cronicas) return null
  return (
    <span className={`clinical-alerts ${compact ? 'clinical-alerts--compact' : ''}`}>
      {mascota.alergias && <span className="alert-badge"><AlertTriangle size={14} /> Alergias: {mascota.alergias}</span>}
      {mascota.enfermedades_cronicas && <span className="alert-badge alert-badge--soft">Crónico: {mascota.enfermedades_cronicas}</span>}
    </span>
  )
}

// Ficha de la consulta. Con `cita`, al guardarla la cita queda atendida; sin cita (urgencias o
// gente que llega sin cita) se registra con la fecha de hoy. El servidor vuelve a validar todo.
export function ConsultaForm({ cita, mascota, onClose, onSaved }) {
  const pet = cita ? cita.mascota : mascota
  const [values, setValues] = useState(FICHA_VACIA)
  const [medicamentos, setMedicamentos] = useState([])
  const [vacunas, setVacunas] = useState([])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }))
  const setItem = (setter, i, f) => (e) => setter((l) => l.map((x, j) => (j === i ? { ...x, [f]: e.target.value } : x)))
  const dia = cita ? cita.inicio.slice(0, 10) : ymd(new Date())
  const dirty = Object.values(values).some(Boolean) || medicamentos.length > 0 || vacunas.length > 0

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSending(true)
    const body = { ...values, medicamentos: medicamentos.filter((m) => m.nombre.trim()), vacunas: vacunas.filter((v) => v.nombre.trim()) }
    for (const n of NUMEROS) body[n] = values[n] === '' ? '' : Number(values[n])
    try {
      const d = await api(cita ? `/api/citas/admin/${cita.id}/historial` : `/api/citas/admin/mascotas/${pet.id}/consultas`, { method: 'POST', body })
      onSaved(d.historial)
    } catch (err) {
      setError(err.message)
      setSending(false)
    }
  }

  return (
    <Modal title={`Consulta de ${pet.nombre}`} onClose={onClose} wide dirty={dirty && !sending}>
      <p className="modal__sub">
        <PetIcon especie={pet.especie} size={16} /> {[pet.raza, pet.notas].filter(Boolean).join(' · ') || 'Sin datos extra'}
        {' · '}{cita ? `${formatCita(cita.inicio)} · ${cita.cliente.nombre}` : 'Consulta sin cita previa, con fecha de hoy'}
      </p>
      <AlertasClinicas mascota={pet} />
      <form className="clinical-form" onSubmit={submit}>
        <fieldset className="clinical-form__group">
          <legend>Motivo y anamnesis</legend>
          <div className="chips-row" role="group" aria-label="Motivos frecuentes">
            {MOTIVOS.map((m) => (
              <button key={m} type="button" className={`chip ${values.motivo === m ? 'chip--active' : ''}`} onClick={() => setValues((v) => ({ ...v, motivo: m }))}>{m}</button>
            ))}
          </div>
          <label>Motivo de la consulta
            <input value={values.motivo} onChange={set('motivo')} maxLength={200} />
          </label>
          <label>Anamnesis <small>lo que cuenta el dueño: desde cuándo, qué come, cambios recientes…</small>
            <textarea rows="2" value={values.anamnesis} onChange={set('anamnesis')} maxLength={1000} />
          </label>
        </fieldset>

        <fieldset className="clinical-form__group">
          <legend>Examen físico</legend>
          <div className="agenda__form-row agenda__form-row--4">
            <label>Peso (kg)
              <input type="number" min="0.01" max="150" step="0.01" inputMode="decimal" value={values.peso_kg} onChange={set('peso_kg')} />
            </label>
            <label>Temperatura (°C)
              <input type="number" min="30" max="45" step="0.1" inputMode="decimal" value={values.temperatura_c} onChange={set('temperatura_c')} />
            </label>
            <label>Frec. cardíaca <small>lpm</small>
              <input type="number" min="10" max="400" step="1" inputMode="numeric" value={values.frecuencia_cardiaca} onChange={set('frecuencia_cardiaca')} />
            </label>
            <label>Frec. respiratoria <small>rpm</small>
              <input type="number" min="4" max="200" step="1" inputMode="numeric" value={values.frecuencia_respiratoria} onChange={set('frecuencia_respiratoria')} />
            </label>
          </div>
          <div className="agenda__form-row agenda__form-row--3">
            <label>Mucosas
              <select value={values.mucosas} onChange={set('mucosas')}>
                <option value="">Sin evaluar</option>
                {Object.entries(MUCOSAS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label>Hidratación
              <select value={values.hidratacion} onChange={set('hidratacion')}>
                <option value="">Sin evaluar</option>
                {Object.entries(HIDRATACION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label>Condición corporal <small>1 a 9</small>
              <select value={values.condicion_corporal} onChange={set('condicion_corporal')}>
                <option value="">Sin evaluar</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}{n === 5 ? ' · ideal' : n < 4 ? ' · delgado' : n > 6 ? ' · sobrepeso' : ''}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <label>Diagnóstico
          <textarea rows="3" value={values.diagnostico} onChange={set('diagnostico')} minLength={3} maxLength={1000} required />
        </label>
        <label>Tratamiento aplicado en consulta (opcional)
          <textarea rows="2" value={values.tratamiento} onChange={set('tratamiento')} maxLength={500} />
        </label>

        <fieldset className="clinical-form__vaccines">
          <legend>Medicamentos recetados</legend>
          {medicamentos.map((m, i) => (
            <div key={i} className="med-row">
              <label>Medicamento
                <input value={m.nombre} onChange={setItem(setMedicamentos, i, 'nombre')} maxLength={80} required />
              </label>
              <label>Dosis
                <input value={m.dosis} onChange={setItem(setMedicamentos, i, 'dosis')} maxLength={60} placeholder="250 mg" />
              </label>
              <label>Frecuencia
                <input value={m.frecuencia} onChange={setItem(setMedicamentos, i, 'frecuencia')} maxLength={60} placeholder="cada 12 h" />
              </label>
              <label>Duración
                <input value={m.duracion} onChange={setItem(setMedicamentos, i, 'duracion')} maxLength={60} placeholder="7 días" />
              </label>
              <button type="button" className="icon-btn icon-btn--ghost" aria-label={`Quitar medicamento ${i + 1}`}
                onClick={() => setMedicamentos((l) => l.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
          <button type="button" className="pet-picker__add" onClick={() => setMedicamentos((l) => [...l, MED_VACIO])}>
            <Plus size={16} /> Agregar medicamento
          </button>
        </fieldset>

        <label>Indicaciones para el dueño (opcional) <small>van en la receta impresa</small>
          <textarea rows="2" value={values.indicaciones} onChange={set('indicaciones')} maxLength={1000} />
        </label>
        <label className="clinical-form__short">Próximo control (opcional)
          <input type="date" min={dia} value={values.proximo_control} onChange={set('proximo_control')} />
        </label>

        <fieldset className="clinical-form__vaccines">
          <legend>Vacunas y desparasitaciones aplicadas</legend>
          <VacunaRows vacunas={vacunas} setVacunas={setVacunas} min={dia} />
        </fieldset>

        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="pet-form__actions">
          <button className="btn btn--dark btn--sm" disabled={sending}>
            {sending ? 'Guardando…' : cita && cita.estado !== 'atendida' ? 'Guardar y marcar atendida' : 'Guardar consulta'}
          </button>
          <button type="button" className="link-btn" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </Modal>
  )
}

function VacunaRows({ vacunas, setVacunas, min }) {
  const set = (i, f) => (e) => setVacunas((l) => l.map((v, j) => (j === i ? { ...v, [f]: e.target.value } : v)))
  return (
    <>
      {vacunas.map((v, i) => (
        <div key={i} className="vaccine-row vaccine-row--tipo">
          <label>Tipo
            <select value={v.tipo} onChange={set(i, 'tipo')}>
              <option value="vacuna">Vacuna</option>
              <option value="desparasitacion">Desparasitación</option>
            </select>
          </label>
          <label>Nombre
            <input list={v.tipo === 'vacuna' ? 'vacunas-comunes' : 'desparasitantes'} value={v.nombre} onChange={set(i, 'nombre')} maxLength={80} required />
          </label>
          <label>Lote
            <input value={v.lote} onChange={set(i, 'lote')} maxLength={40} />
          </label>
          <label>Próxima dosis
            <input type="date" min={min} value={v.proxima_dosis} onChange={set(i, 'proxima_dosis')} />
          </label>
          <button type="button" className="icon-btn icon-btn--ghost" aria-label={`Quitar ${i + 1}`}
            onClick={() => setVacunas((l) => l.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
        </div>
      ))}
      <datalist id="vacunas-comunes">{VACUNAS_COMUNES.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="desparasitantes">{DESPARASITANTES.map((n) => <option key={n} value={n} />)}</datalist>
      <span className="chips-row">
        <button type="button" className="pet-picker__add" onClick={() => setVacunas((l) => [...l, VAC_VACIA])}>
          <Plus size={16} /> Vacuna
        </button>
        <button type="button" className="pet-picker__add" onClick={() => setVacunas((l) => [...l, { ...VAC_VACIA, tipo: 'desparasitacion' }])}>
          <Plus size={16} /> Desparasitación
        </button>
      </span>
    </>
  )
}

// Vacuna o desparasitación aplicada en otra clínica (o antes de usar el sistema).
export function VacunaExternaForm({ mascota, onClose, onSaved }) {
  const [values, setValues] = useState({ tipo: 'vacuna', nombre: '', lote: '', fecha_aplicacion: '', proxima_dosis: '', clinica_externa: '' })
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }))
  const dirty = Boolean(values.nombre || values.lote || values.fecha_aplicacion || values.clinica_externa)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      onSaved(await api(`/api/citas/admin/mascotas/${mascota.id}/vacunas`, { method: 'POST', body: values }))
    } catch (err) {
      setError(err.message)
      setSending(false)
    }
  }

  return (
    <Modal title={`Vacuna o desparasitación de ${mascota.nombre}`} onClose={onClose} dirty={dirty && !sending}>
      <p className="modal__sub">Para lo aplicado en otra clínica. Lo de una consulta aquí se registra en la ficha de la consulta.</p>
      <form className="clinical-form" onSubmit={submit}>
        <div className="agenda__form-row">
          <label>Tipo
            <select value={values.tipo} onChange={set('tipo')}>
              <option value="vacuna">Vacuna</option>
              <option value="desparasitacion">Desparasitación</option>
            </select>
          </label>
          <label>Nombre
            <input list={values.tipo === 'vacuna' ? 'vacunas-ext' : 'desparasitantes-ext'} value={values.nombre} onChange={set('nombre')} minLength={2} maxLength={80} required />
          </label>
        </div>
        <datalist id="vacunas-ext">{VACUNAS_COMUNES.map((n) => <option key={n} value={n} />)}</datalist>
        <datalist id="desparasitantes-ext">{DESPARASITANTES.map((n) => <option key={n} value={n} />)}</datalist>
        <div className="agenda__form-row">
          <label>Aplicada el
            <input type="date" max={ymd(new Date())} value={values.fecha_aplicacion} onChange={set('fecha_aplicacion')} required />
          </label>
          <label>Próxima dosis (opcional)
            <input type="date" min={values.fecha_aplicacion || undefined} value={values.proxima_dosis} onChange={set('proxima_dosis')} />
          </label>
        </div>
        <div className="agenda__form-row">
          <label>Clínica donde se aplicó
            <input value={values.clinica_externa} onChange={set('clinica_externa')} maxLength={100} />
          </label>
          <label>Lote (opcional)
            <input value={values.lote} onChange={set('lote')} maxLength={40} />
          </label>
        </div>
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="pet-form__actions">
          <button className="btn btn--dark btn--sm" disabled={sending}>{sending ? 'Guardando…' : 'Agregar al carné'}</button>
          <button type="button" className="link-btn" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </Modal>
  )
}

// Observación en un servicio no clínico: «en peluquería se le encontró otitis».
export function NotaForm({ cita, onClose, onSaved }) {
  const [texto, setTexto] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      await api(`/api/citas/admin/${cita.id}/notas`, { method: 'POST', body: { texto } })
      onSaved()
    } catch (err) {
      setError(err.message)
      setSending(false)
    }
  }

  return (
    <Modal title={`Nota sobre ${cita.mascota.nombre}`} onClose={onClose} dirty={Boolean(texto) && !sending}>
      <p className="modal__sub">{cita.servicio.nombre} · {formatCita(cita.inicio)}. La nota queda en la ficha del paciente para el veterinario.</p>
      <form className="clinical-form" onSubmit={submit}>
        <label>Observación
          <textarea rows="3" value={texto} onChange={(e) => setTexto(e.target.value)} minLength={3} maxLength={500} required
            placeholder="Se le encontró otitis en el oído izquierdo; recomendar consulta." />
        </label>
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="pet-form__actions">
          <button className="btn btn--dark btn--sm" disabled={sending}>{sending ? 'Guardando…' : 'Guardar nota'}</button>
          <button type="button" className="link-btn" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </Modal>
  )
}

const signo = (valor, unidad) => (valor === null ? null : `${valor} ${unidad}`)

// Una consulta del historial, con sus adendas. La ficha no se edita: se corrige con una adenda.
export function ConsultaItem({ consulta: c, onUpdated, onPrint }) {
  const [adenda, setAdenda] = useState(null) // null cerrado o el texto
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const examen = [
    signo(c.peso_kg, 'kg'), signo(c.temperatura_c, '°C'), c.frecuencia_cardiaca !== null && `FC ${c.frecuencia_cardiaca} lpm`,
    c.frecuencia_respiratoria !== null && `FR ${c.frecuencia_respiratoria} rpm`, c.mucosas && `Mucosas ${MUCOSAS[c.mucosas].toLowerCase()}`,
    c.hidratacion && HIDRATACION[c.hidratacion], c.condicion_corporal !== null && `CC ${c.condicion_corporal}/9`,
  ].filter(Boolean)

  const guardarAdenda = async (e) => {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      onUpdated(await api(`/api/citas/admin/historial/${c.id}/adendas`, { method: 'POST', body: { texto: adenda } }))
      setAdenda(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <li>
      <div className="clinical__head">
        <strong>{formatCita(c.fecha)}</strong>
        {c.sin_cita && <span className="status status--warn">Sin cita</span>}
        <small>Atendió {c.registrado_por}</small>
      </div>
      {c.motivo && <p><b>Motivo:</b> {c.motivo}</p>}
      {c.anamnesis && <p><b>Anamnesis:</b> {c.anamnesis}</p>}
      {examen.length > 0 && <p><b>Examen:</b> {examen.join(' · ')}</p>}
      <p><b>Diagnóstico:</b> {c.diagnostico}</p>
      {c.tratamiento && <p><b>Tratamiento:</b> {c.tratamiento}</p>}
      {c.medicamentos.length > 0 && (
        <ul className="clinical__meds">
          {c.medicamentos.map((m, i) => <li key={i}><b>{m.nombre}</b> {[m.dosis, m.frecuencia, m.duracion].filter(Boolean).join(' · ')}</li>)}
        </ul>
      )}
      {c.indicaciones && <p><b>Indicaciones:</b> {c.indicaciones}</p>}
      {c.proximo_control && <p><b>Próximo control:</b> {fechaCorta(c.proximo_control)}</p>}
      {c.vacunas.length > 0 && <p><b>Aplicado:</b> {c.vacunas.map((v) => v.nombre).join(', ')}</p>}
      {c.adjuntos.length > 0 && (
        <p className="clinical__files">
          <b>Adjuntos:</b>{' '}
          {c.adjuntos.map((a) => (a.url
            ? <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"><Paperclip size={13} /> {a.nombre}</a>
            : <span key={a.id}><Paperclip size={13} /> {a.nombre}</span>))}
        </p>
      )}
      {c.adendas.map((a) => (
        <p key={a.id} className="clinical__addendum"><b>Adenda · {formatCita(a.fecha)} · {a.registrado_por}:</b> {a.texto}</p>
      ))}
      {adenda !== null ? (
        <form className="clinical-form clinical__addendum-form" onSubmit={guardarAdenda}>
          <label>Adenda <small>la ficha original no cambia; la corrección queda registrada</small>
            <textarea rows="2" value={adenda} onChange={(e) => setAdenda(e.target.value)} minLength={3} maxLength={1000} required autoFocus />
          </label>
          {error && <p className="form-alert" role="alert">{error}</p>}
          <div className="pet-form__actions">
            <button className="btn btn--dark btn--xs" disabled={sending}>{sending ? 'Guardando…' : 'Guardar adenda'}</button>
            <button type="button" className="link-btn" onClick={() => setAdenda(null)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <div className="clinical__actions">
          <button className="link-btn" onClick={() => setAdenda('')}>Agregar adenda</button>
          <button className="link-btn" onClick={() => onPrint(c)}><Printer size={14} /> Receta e indicaciones</button>
          <SubirAdjunto historialId={c.id} onUpdated={onUpdated} />
        </div>
      )}
    </li>
  )
}

const TIPOS_ADJUNTO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_ADJUNTO_MB = 10

// Resultado de laboratorio o radiografía. Se sube a Cloudinary como privado con la firma de
// citas-service; solo se ve con el enlace firmado (10 min) que trae la ficha.
function SubirAdjunto({ historialId, onUpdated }) {
  const input = useRef(null)
  const [tipo, setTipo] = useState('laboratorio')
  const [estado, setEstado] = useState('') // '', 'eligiendo', 'subiendo' o un error

  const subir = async (e) => {
    const archivo = e.target.files[0]
    e.target.value = ''
    if (!archivo) return
    if (!TIPOS_ADJUNTO.includes(archivo.type)) return setEstado('Usa un PDF o una imagen (JPG, PNG o WebP).')
    if (archivo.size > MAX_ADJUNTO_MB * 1024 * 1024) return setEstado(`El archivo pesa más de ${MAX_ADJUNTO_MB} MB.`)
    setEstado('subiendo')
    try {
      const f = await api('/api/citas/admin/adjuntos/firma', { method: 'POST' })
      const datos = new FormData()
      datos.append('file', archivo)
      for (const k of ['api_key', 'timestamp', 'signature', 'folder', 'type']) datos.append(k, f[k])
      const res = await fetch(f.upload_url, { method: 'POST', body: datos })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.public_id) throw new Error(json?.error?.message || 'Cloudinary rechazó el archivo')
      onUpdated(await api(`/api/citas/admin/historial/${historialId}/adjuntos`, {
        method: 'POST',
        body: { nombre: archivo.name.slice(0, 120), tipo, public_id: json.public_id, recurso: json.resource_type === 'image' ? 'image' : 'raw', formato: json.format || '' },
      }))
      setEstado('')
    } catch (err) {
      setEstado(err.message)
    }
  }

  return (
    <span className="clinical__upload">
      <input ref={input} type="file" accept={TIPOS_ADJUNTO.join(',')} onChange={subir} hidden />
      {estado === 'eligiendo' ? (
        <>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de archivo">
            <option value="laboratorio">Laboratorio</option>
            <option value="radiografia">Radiografía</option>
            <option value="otro">Otro</option>
          </select>
          <button className="link-btn" onClick={() => input.current.click()}>Elegir archivo</button>
          <button className="link-btn" onClick={() => setEstado('')}>Cancelar</button>
        </>
      ) : estado === 'subiendo' ? <span className="summary__hint">Subiendo…</span> : (
        <button className="link-btn" onClick={() => setEstado('eligiendo')}><Paperclip size={14} /> Adjuntar resultado</button>
      )}
      {estado && !['eligiendo', 'subiendo'].includes(estado) && <small className="field-error">{estado}</small>}
    </span>
  )
}
