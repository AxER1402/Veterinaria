import { useEffect, useState } from 'react'
import { MapPin, Phone, Plus } from 'lucide-react'
import ConfirmDialog from '../../components/ConfirmDialog'
import Loading from '../../components/Loading'
import MapEmbed from '../../components/MapEmbed'
import Select from '../../components/Select'
import { api } from '../../api'
import { useClinica } from '../../context/useClinica'
import { DIAS, HORAS_DIA, resumenHorario } from '../../data/horarios'
import Subvistas from './Subvistas'

const HORARIO_INICIAL = DIAS.map((_, i) => ({ dia: i + 1, abre: i < 6 ? '08:00' : null, cierra: i < 6 ? '20:00' : null }))
const SEDE_NUEVA = { nombre: '', direccion: '', telefono: '', ubicacion: '', simultaneas: null, retiro: true, activa: true, horarios: HORARIO_INICIAL }
const MODALIDAD = { turno: 'Por turnos', dia: 'Por día', estadia: 'Por noche' }

const textoLimite = (s) => (s.simultaneas !== null ? `${s.simultaneas} a la vez` : s.limite === 1 ? '1 a la vez (única sede activa)' : 'Según el equipo')

// Sedes, horarios y precios de los servicios (solo administración; el servidor lo vuelve a revisar).
export default function AdminSedes() {
  const { recargar } = useClinica()
  const [vista, setVista] = useState('sedes')
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    api('/api/citas/admin/sedes').then(setDatos).catch((e) => setError(e.message))
  }, [])

  const actualizado = (d, mensaje) => {
    setDatos(d)
    setError('')
    setAviso(d.aviso ? `${mensaje} ${d.aviso}` : mensaje)
    recargar()
  }

  return (
    <>
      <Subvistas vistas={[{ id: 'sedes', label: 'Sedes y horarios' }, { id: 'servicios', label: 'Servicios y precios' }]} activa={vista} onChange={(v) => { setVista(v); setAviso(''); setError('') }} />
      {error && <p className="form-alert" role="alert">{error}</p>}
      {aviso && <p className="form-ok" role="status">{aviso}</p>}
      {!datos ? !error && <Loading /> : vista === 'sedes'
        ? <Sedes sedes={datos.sedes} onGuardado={actualizado} />
        : <Servicios servicios={datos.servicios} sedes={datos.sedes} onGuardado={actualizado} onError={(m) => { setAviso(''); setError(m) }} />}
    </>
  )
}

function Sedes({ sedes, onGuardado }) {
  const [editando, setEditando] = useState(null) // código, 'nueva' o null

  return (
    <>
      <div className="barra">
        <p className="barra__nota">Lo que cambies aquí se ve en el sitio, las reservas y los correos.</p>
        {editando !== 'nueva' && <button className="btn btn--primary btn--xs barra__fin" onClick={() => setEditando('nueva')}><Plus size={16} /> Nueva sede</button>}
      </div>
      {editando === 'nueva' && <SedeForm inicial={SEDE_NUEVA} onCancel={() => setEditando(null)} onGuardado={(d) => { setEditando(null); onGuardado(d, 'Sede creada.') }} />}
      <ul className="sedes-admin">
        {sedes.map((s) => (editando === s.codigo ? (
          <li key={s.codigo} className="sedes-admin__form"><SedeForm inicial={s} onCancel={() => setEditando(null)} onGuardado={(d, mensaje = 'Sede guardada.') => { setEditando(null); onGuardado(d, mensaje) }} /></li>
        ) : (
          <li key={s.codigo} className={`sede-admin ${s.activa ? '' : 'is-apagada'}`}>
            <span className="sede-admin__icono"><MapPin size={22} aria-hidden="true" /></span>
            <div className="sede-admin__datos">
              <h3>{s.nombre}</h3>
              <p>{s.direccion}</p>
              {s.telefono && <p className="sede-admin__tel"><Phone size={14} aria-hidden="true" /> {s.telefono}</p>}
              <p className="sede-admin__horario">{resumenHorario(s.horarios) || 'Sin horario'}</p>
            </div>
            <div className="sede-admin__estado">
              {!s.activa && <span className="status status--warn">Inactiva</span>}
              <span className="status status--info">{textoLimite(s)}</span>
              {s.retiro && <span className="status status--ok">Retiro de pedidos</span>}
              <small>{s.citas_proximas} {s.citas_proximas === 1 ? 'cita próxima' : 'citas próximas'}</small>
              <button className="btn btn--ghost btn--xs" onClick={() => setEditando(s.codigo)}>Editar</button>
            </div>
          </li>
        )))}
      </ul>
    </>
  )
}

function SedeForm({ inicial, onCancel, onGuardado }) {
  const nueva = !inicial.codigo
  const [v, setV] = useState({
    nombre: inicial.nombre, direccion: inicial.direccion, telefono: inicial.telefono || '', ubicacion: nueva ? '' : inicial.ubicacion === inicial.direccion ? '' : inicial.ubicacion,
    simultaneas: inicial.simultaneas, retiro: inicial.retiro, activa: inicial.activa, horarios: inicial.horarios,
  })
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [eliminar, setEliminar] = useState(false)
  const set = (f) => (e) => setV((x) => ({ ...x, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const setDia = (dia, cambios) => setV((x) => ({ ...x, horarios: x.horarios.map((h) => (h.dia === dia ? { ...h, ...cambios } : h)) }))
  const mapa = v.ubicacion.trim() || v.direccion.trim()

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      onGuardado(await api(nueva ? '/api/citas/admin/sedes' : `/api/citas/admin/sedes/${inicial.codigo}`, { method: nueva ? 'POST' : 'PATCH', body: v }))
    } catch (err) {
      setError(err.message)
      setSending(false)
    }
  }

  return (
    <form className="clinical-form sede-form" onSubmit={submit}>
      <h3>{nueva ? 'Nueva sede' : `Editar ${inicial.nombre}`}</h3>
      <div className="sede-form__cuerpo">
        <div className="sede-form__datos">
          <label>Nombre<input value={v.nombre} onChange={set('nombre')} minLength={3} maxLength={80} required /></label>
          <label>Dirección<input value={v.direccion} onChange={set('direccion')} minLength={5} maxLength={160} required /></label>
          <div className="agenda__form-row">
            <label>Teléfono<input type="tel" value={v.telefono} onChange={set('telefono')} maxLength={20} placeholder="+502 2385-6420" /></label>
            <label>Mascotas a la vez
              <Select value={v.simultaneas === null ? '' : String(v.simultaneas)} onChange={(e) => setV((x) => ({ ...x, simultaneas: e.target.value === '' ? null : Number(e.target.value) }))}>
                <option value="">Automático</option>
                {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n === 1 ? 'Una por horario' : `Hasta ${n} por horario`}</option>)}
              </Select>
            </label>
          </div>
          <p className="summary__hint">Suma todos los servicios por turnos de la sede. En automático: una por horario si es la única sede activa; con más sedes, lo decide el equipo de cada servicio.</p>
          <label>Ubicación en el mapa (opcional)<input value={v.ubicacion} onChange={set('ubicacion')} maxLength={200} placeholder="Coordenadas o una dirección más exacta" /></label>
          {mapa.length >= 5 && <MapEmbed key={mapa} query={mapa} title="Vista previa del mapa" height={180} />}
          <div className="sede-form__checks">
            <label className="check-row"><input type="checkbox" checked={v.retiro} onChange={set('retiro')} /> Aquí se pueden retirar pedidos</label>
            {!nueva && <label className="check-row"><input type="checkbox" checked={v.activa} onChange={set('activa')} /> Sede activa</label>}
          </div>
        </div>
        <fieldset className="sede-form__horario">
          <legend>Horario</legend>
          {v.horarios.map((h) => {
            const abierto = Boolean(h.abre)
            return (
              <div key={h.dia} className={`sede-dia ${abierto ? '' : 'is-cerrado'}`}>
                <label className="check-row"><input type="checkbox" checked={abierto} onChange={(e) => setDia(h.dia, e.target.checked ? { abre: '08:00', cierra: '20:00' } : { abre: null, cierra: null })} /> {DIAS[h.dia - 1]}</label>
                {abierto ? (
                  <span className="sede-dia__horas">
                    <Select value={h.abre} aria-label={`Abre ${DIAS[h.dia - 1]}`} onChange={(e) => setDia(h.dia, { abre: e.target.value })}>{HORAS_DIA.map((x) => <option key={x}>{x}</option>)}</Select>
                    <Select value={h.cierra} aria-label={`Cierra ${DIAS[h.dia - 1]}`} onChange={(e) => setDia(h.dia, { cierra: e.target.value })}>{HORAS_DIA.map((x) => <option key={x}>{x}</option>)}</Select>
                  </span>
                ) : <small>Cerrado</small>}
              </div>
            )
          })}
        </fieldset>
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="pet-form__actions">
        <button className="btn btn--dark btn--sm" disabled={sending}>{sending ? 'Guardando…' : nueva ? 'Crear sede' : 'Guardar'}</button>
        <button type="button" className="link-btn" onClick={onCancel}>Cancelar</button>
        {!nueva && <button type="button" className="link-btn link-btn--danger sede-form__eliminar" onClick={() => setEliminar(true)}>Eliminar sede</button>}
      </div>
      {eliminar && (
        <ConfirmDialog title={`Eliminar ${inicial.nombre}`} onClose={() => setEliminar(false)} peligro confirmLabel="Eliminar sede"
          text="Deja de aparecer en el panel, el sitio y las reservas, y no se puede deshacer desde aquí. Sus citas, cobros y pedidos anteriores conservan el nombre y la dirección que tenían."
          onConfirm={async () => onGuardado(await api(`/api/citas/admin/sedes/${inicial.codigo}`, { method: 'DELETE' }), 'Sede eliminada.')} />
      )}
    </form>
  )
}

function Servicios({ servicios, sedes, onGuardado, onError }) {
  return (
    <>
      <p className="barra__nota servicios-nota">Es el precio «desde» que se muestra en el sitio y el que aparece al cobrar. Se puede ajustar en cada cobro.</p>
      <ul className="lista">
        {servicios.map((s) => <ServicioFila key={s.slug} servicio={s} sedes={sedes.filter((x) => x.activa || x.codigo === s.sede)} onGuardado={onGuardado} onError={onError} />)}
      </ul>
    </>
  )
}

function ServicioFila({ servicio: s, sedes, onGuardado, onError }) {
  const [precio, setPrecio] = useState(String(s.precio_desde))
  const [sede, setSede] = useState(s.sede)
  const [activo, setActivo] = useState(s.activo)
  const sucio = Number(precio) !== s.precio_desde || sede !== s.sede || activo !== s.activo

  const guardar = async () => {
    try {
      onGuardado(await api(`/api/citas/admin/servicios/${s.slug}`, { method: 'PATCH', body: { precio_desde: Number(precio), sede, activo } }), `${s.nombre} guardado.`)
    } catch (e) {
      onError(`${s.nombre}: ${e.message}`)
      setSede(s.sede)
      setActivo(s.activo)
    }
  }

  return (
    <li className={`fila fila--servicio ${activo ? '' : 'is-apagada'}`}>
      <span className="fila__principal"><strong>{s.nombre}</strong><small>{MODALIDAD[s.modalidad]} · {s.citas_proximas} {s.citas_proximas === 1 ? 'cita próxima' : 'citas próximas'}</small></span>
      <label className="servicio-campo"><span>Sede</span>
        <Select value={sede} onChange={(e) => setSede(e.target.value)} aria-label={`Sede de ${s.nombre}`}>{sedes.map((x) => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}</Select>
      </label>
      <label className="servicio-campo servicio-campo--precio"><span>Precio desde (Q)</span>
        <input type="number" min="0.01" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} aria-label={`Precio de ${s.nombre}`} />
      </label>
      <label className="toggle" title={activo ? 'Se ofrece en el sitio' : 'No se ofrece'}>
        <input type="checkbox" checked={activo} aria-label={`${s.nombre} activo`} onChange={(e) => setActivo(e.target.checked)} />
        <span />
      </label>
      <button className="btn btn--dark btn--xs" disabled={!sucio || !(Number(precio) > 0)} onClick={guardar}>Guardar</button>
    </li>
  )
}
