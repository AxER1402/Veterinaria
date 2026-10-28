import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer, Stethoscope, Syringe } from 'lucide-react'
import Loading from '../../components/Loading'
import PetIcon from '../../components/PetIcon'
import VaccineTable, { Carne } from '../../components/VaccineTable'
import { api } from '../../api'
import { CITA_STATUS, ESPECIES, edad, formatCita, ymd } from '../account/citas'
import { fechaCorta } from '../account/vacunas'
import { AlertasClinicas, ConsultaForm, ConsultaItem, VacunaExternaForm } from './ClinicalRecord'
import AgendarCita from './AgendarCita'

// Ficha del paciente. El servidor registra cada apertura como HISTORIAL_CONSULTADO.
export default function AdminPaciente() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [dueno, setDueno] = useState(null) // nombre de la cuenta (auth-service)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null) // 'consulta' | 'vacuna' | 'control' | null
  const [aviso, setAviso] = useState('')
  const [imprimir, setImprimir] = useState(null) // { tipo: 'receta', consulta } | { tipo: 'carne' }

  const cerrarImpresion = useCallback(() => setImprimir(null), [])
  const cargar = useCallback(() => {
    api(`/api/citas/admin/mascotas/${id}/historial`).then(setData).catch((e) => setError(e.message))
  }, [id])
  useEffect(cargar, [cargar])
  const duenoId = data?.dueno.id
  useEffect(() => {
    if (!duenoId) return
    api('/api/auth/admin/clientes').then((d) => setDueno(d.clientes.find((c) => c.id === duenoId) || null)).catch(() => {})
  }, [duenoId])

  // Lo nuevo (adenda, vacuna) llega en la respuesta: no se vuelve a pedir la ficha ni a auditar otra lectura.
  const actualizar = (h) => setData((d) => ({ ...d, consultas: h.consultas, vacunas: h.vacunas }))

  if (error) return <div className="admin-card"><p className="form-alert" role="alert">{error}</p><Link to="/admin/pacientes">Volver a pacientes</Link></div>
  if (!data) return <Loading />

  const m = data.mascota
  const nombreDueno = dueno?.nombre || data.dueno.nombre || `Cliente #${data.dueno.id}`
  const hoy = ymd(new Date())
  const control = data.consultas.find((c) => c.proximo_control && c.proximo_control >= hoy)?.proximo_control
  const proxima = data.citas.filter((c) => ['pendiente', 'confirmada'].includes(c.estado) && c.inicio.slice(0, 10) >= hoy).at(-1)
  const detalle = [
    ESPECIES.find((e) => e.value === m.especie)?.label, m.raza, m.sexo === 'macho' ? 'Macho' : m.sexo === 'hembra' ? 'Hembra' : null,
    edad(m.fecha_nacimiento), m.peso_kg ? `${m.peso_kg} kg` : null,
  ].filter(Boolean)

  return (
    <>
      <Link to="/admin/pacientes" className="link-btn patient__back"><ArrowLeft size={16} /> Pacientes</Link>
      <div className="admin-card patient">
        <div className="admin-card__head">
          <h2 className="patient__name"><PetIcon especie={m.especie} size={26} /> {m.nombre} {!m.activa && <small>· inactiva</small>}</h2>
          <div className="patient__actions">
            {m.activa && <button className="btn btn--dark btn--sm" onClick={() => setModal('consulta')}><Stethoscope size={16} /> Nueva consulta</button>}
            <button className="btn btn--primary btn--sm" onClick={() => setModal('vacuna')}><Syringe size={16} /> Vacuna externa</button>
          </div>
        </div>
        <p className="patient__meta">{detalle.join(' · ') || 'Sin datos'}</p>
        <p className="patient__meta">
          Dueño: <strong>{nombreDueno}</strong>
          {data.dueno.telefono && <> · <a href={`tel:${data.dueno.telefono}`}>{data.dueno.telefono}</a></>}
          {(dueno?.email || data.dueno.email) && <> · {dueno?.email || data.dueno.email}</>}
        </p>
        {m.notas && <p className="patient__meta">Notas: {m.notas}</p>}
        <AlertasEditor mascota={m} onSaved={(mascota) => setData((d) => ({ ...d, mascota }))} />
        {(control || proxima) && (
          <p className="patient__next">
            {proxima && <>Próxima cita: <strong>{formatCita(proxima.inicio)}</strong> ({proxima.servicio.nombre}). </>}
            {control && <>Control sugerido: <strong>{fechaCorta(control)}</strong>{!proxima && ' · todavía sin cita agendada'}.</>}
            {control && !proxima && m.activa && <button className="btn btn--dark btn--xs" onClick={() => setModal('control')}>Agendar control</button>}
          </p>
        )}
        {aviso && <p className="form-ok" role="status">{aviso}</p>}
      </div>

      <div className="admin-card">
        <div className="admin-card__head">
          <h2>Carné</h2>
          <button className="link-btn" onClick={() => setImprimir({ tipo: 'carne' })}><Printer size={16} /> Imprimir carné</button>
        </div>
        <Carne vacunas={data.vacunas} lote />
      </div>

      <div className="admin-card">
        <h2>Consultas <small>· {data.consultas.length}</small></h2>
        {data.consultas.length === 0 ? <p className="summary__hint">Sin consultas registradas.</p> : (
          <ol className="clinical__list clinical__list--page">
            {data.consultas.map((c) => (
              <ConsultaItem key={c.id} consulta={c} onUpdated={actualizar} onPrint={(consulta) => setImprimir({ tipo: 'receta', consulta })} />
            ))}
          </ol>
        )}
      </div>

      <div className="admin-grid admin-grid--even">
        <div className="admin-card">
          <h2>Notas de otros servicios</h2>
          {data.notas.length === 0 ? <p className="summary__hint">Sin notas de peluquería, guardería u otros servicios.</p> : (
            <ul className="clinical__list">
              {data.notas.map((n) => (
                <li key={n.id}><strong>{n.servicio} · {formatCita(n.fecha)}</strong><p>{n.texto}</p><small>{n.registrado_por}</small></li>
              ))}
            </ul>
          )}
        </div>
        <div className="admin-card">
          <h2>Citas</h2>
          {data.citas.length === 0 ? <p className="summary__hint">Sin citas.</p> : (
            <ul className="patient__citas">
              {data.citas.map((c) => (
                <li key={c.id}>
                  <span><strong>{formatCita(c.inicio)}</strong><small>{c.servicio.nombre}</small></span>
                  <span className={`status status--${CITA_STATUS[c.estado].tone}`}>{CITA_STATUS[c.estado].label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {modal === 'consulta' && (
        <ConsultaForm mascota={m} onClose={() => setModal(null)} onSaved={(h) => {
          setModal(null)
          setAviso(h?.proximo_control ? `Consulta guardada. Control sugerido para el ${fechaCorta(h.proximo_control)}: recuerda agendarlo con el dueño.` : 'Consulta guardada.')
          cargar()
        }} />
      )}
      {modal === 'control' && (
        <AgendarCita inicial={{ clienteId: data.dueno.id, mascotaId: m.id, servicio: 'veterinaria', fecha: control }} onClose={() => setModal(null)}
          onDone={(c) => { setModal(null); setAviso(`Control agendado: ${formatCita(c.inicio)}.`); cargar() }} />
      )}
      {modal === 'vacuna' && (
        <VacunaExternaForm mascota={m} onClose={() => setModal(null)} onSaved={(h) => { setModal(null); actualizar(h) }} />
      )}
      {imprimir && <HojaImpresion {...imprimir} mascota={m} dueno={nombreDueno} vacunas={data.vacunas} onDone={cerrarImpresion} />}
    </>
  )
}

function AlertasEditor({ mascota, onSaved }) {
  const [values, setValues] = useState(null) // null = solo lectura
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      onSaved((await api(`/api/citas/admin/mascotas/${mascota.id}/alertas`, { method: 'PATCH', body: values })).mascota)
      setValues(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  if (!values) {
    return (
      <div className="patient__alerts">
        <AlertasClinicas mascota={mascota} />
        {!mascota.alergias && !mascota.enfermedades_cronicas && <span className="summary__hint">Sin alergias ni enfermedades crónicas registradas.</span>}
        <button className="link-btn" onClick={() => setValues({ alergias: mascota.alergias || '', enfermedades_cronicas: mascota.enfermedades_cronicas || '' })}>
          Editar alertas
        </button>
      </div>
    )
  }
  return (
    <form className="clinical-form patient__alerts-form" onSubmit={submit}>
      <div className="agenda__form-row">
        <label>Alergias
          <input value={values.alergias} onChange={(e) => setValues((v) => ({ ...v, alergias: e.target.value }))} maxLength={300} autoFocus />
        </label>
        <label>Enfermedades crónicas
          <input value={values.enfermedades_cronicas} onChange={(e) => setValues((v) => ({ ...v, enfermedades_cronicas: e.target.value }))} maxLength={300} />
        </label>
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="pet-form__actions">
        <button className="btn btn--dark btn--xs" disabled={sending}>{sending ? 'Guardando…' : 'Guardar alertas'}</button>
        <button type="button" className="link-btn" onClick={() => setValues(null)}>Cancelar</button>
      </div>
    </form>
  )
}

// Hoja para imprimir o guardar como PDF (el diálogo de impresión del navegador lo permite).
// Va en un portal directo en <body>: al imprimir se oculta todo lo demás.
function HojaImpresion({ tipo, consulta, mascota, dueno, vacunas, onDone }) {
  useEffect(() => {
    document.body.classList.add('printing')
    const fin = () => onDone()
    window.addEventListener('afterprint', fin)
    const t = setTimeout(() => window.print(), 50)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', fin)
      document.body.classList.remove('printing')
    }
  }, [onDone])

  return createPortal(
    <div className="print-sheet">
      <header>
        <strong>Huellitas · Clínica veterinaria</strong>
        <span>6a. avenida 9-35, zona 10</span>
      </header>
      <h1>{tipo === 'carne' ? 'Carné de vacunación' : 'Receta e indicaciones'}</h1>
      <p><b>Paciente:</b> {mascota.nombre} · {[mascota.raza, edad(mascota.fecha_nacimiento)].filter(Boolean).join(' · ')}<br /><b>Dueño:</b> {dueno}</p>
      {mascota.alergias && <p><b>Alergias:</b> {mascota.alergias}</p>}
      {tipo === 'carne' ? (
        <>
          <h2>Vacunas</h2>
          <VaccineTable vacunas={vacunas.filter((v) => v.tipo !== 'desparasitacion')} lote />
          <h2>Desparasitaciones</h2>
          <VaccineTable vacunas={vacunas.filter((v) => v.tipo === 'desparasitacion')} lote vacio="Sin desparasitaciones registradas." />
        </>
      ) : (
        <>
          <p><b>Fecha:</b> {formatCita(consulta.fecha)}<br /><b>Atendió:</b> {consulta.registrado_por}</p>
          <h2>Medicamentos</h2>
          {consulta.medicamentos.length === 0 ? <p>Sin medicamentos recetados.</p> : (
            <ol>{consulta.medicamentos.map((d, i) => <li key={i}><b>{d.nombre}</b> {[d.dosis, d.frecuencia, d.duracion].filter(Boolean).join(' · ')}</li>)}</ol>
          )}
          {consulta.indicaciones && <><h2>Indicaciones</h2><p>{consulta.indicaciones}</p></>}
          {consulta.proximo_control && <p><b>Próximo control:</b> {fechaCorta(consulta.proximo_control)}</p>}
          <p className="print-sheet__firma">Firma y sello</p>
        </>
      )}
    </div>,
    document.body,
  )
}
