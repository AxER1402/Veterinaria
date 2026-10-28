import { useEffect, useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import Modal from '../../components/Modal'
import PetIcon from '../../components/PetIcon'
import SlotPicker from '../../components/SlotPicker'
import { cuerpoReserva, eleccionLista } from '../../components/reserva'
import { api } from '../../api'
import { ESPECIES, formatReserva } from '../account/citas'

const normalizar = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Cita que agenda el personal para alguien que llama o llega sin cita. El cliente necesita cuenta
// (sus citas, mascotas y avisos van ligados a ella); la mascota se puede registrar aquí mismo.
// Con `inicial` ({ clienteId, mascotaId, servicio, fecha }) llega ya elegido, p. ej. para el próximo control.
export default function AgendarCita({ inicial = {}, onClose, onDone }) {
  const [clientes, setClientes] = useState(null)
  const [buscar, setBuscar] = useState('')
  const [cliente, setCliente] = useState(null)
  const [mascotas, setMascotas] = useState(null)
  const [mascotaId, setMascotaId] = useState(inicial.mascotaId || '')
  const [nueva, setNueva] = useState(null) // { nombre, especie } al registrar una mascota
  const [servicios, setServicios] = useState(null)
  const [servicio, setServicio] = useState(inicial.servicio || 'veterinaria')
  const [profesional, setProfesional] = useState('')
  const [eleccion, setEleccion] = useState({ fecha: inicial.fecha || '', hora: '', salida: '' })
  const [contacto, setContacto] = useState({ nombre: '', email: '', telefono: '', notas: '' })
  const [error, setError] = useState('')
  const [nuevoCliente, setNuevoCliente] = useState(null) // { nombre, email, telefono } al crear la cuenta
  const [temporal, setTemporal] = useState(null) // contraseña temporal, se muestra una sola vez
  const [sending, setSending] = useState(false)

  function elegirCliente(c) {
    setCliente(c)
    setContacto((x) => ({ ...x, nombre: c.nombre, email: c.email, telefono: c.telefono || '' }))
    setMascotas(null)
    api(`/api/citas/admin/clientes/${c.id}`).then((d) => {
      const activas = d.mascotas.filter((m) => m.activa)
      setMascotas(activas)
      if (activas.length === 1 && !inicial.mascotaId) setMascotaId(activas[0].id)
      // Si el cliente nunca guardó su teléfono, se usa el de su última cita.
      if (!c.telefono && d.telefono) setContacto((x) => ({ ...x, telefono: x.telefono || d.telefono }))
    }).catch((e) => setError(e.message))
  }

  useEffect(() => {
    api('/api/auth/admin/clientes').then((d) => {
      setClientes(d.clientes)
      const c = d.clientes.find((x) => x.id === inicial.clienteId)
      if (c) elegirCliente(c)
    }).catch((e) => setError(e.message))
    api('/api/citas/servicios', { auth: false }).then((d) => setServicios(d.servicios)).catch((e) => setError(e.message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const encontrados = useMemo(() => {
    const t = normalizar(buscar.trim())
    if (!clientes || t.length < 2) return []
    return clientes.filter((c) => [c.nombre, c.email, c.telefono].some((x) => normalizar(x).includes(t))).slice(0, 8)
  }, [clientes, buscar])

  const elegido = servicios?.find((s) => s.slug === servicio)
  const listo = cliente && mascotaId && elegido && eleccionLista(elegido.modalidad, eleccion) && contacto.telefono.trim()
    && (servicio !== 'veterinaria' || contacto.notas.trim().length >= 3)

  const crearCliente = async () => {
    setError('')
    try {
      const d = await api('/api/auth/admin/clientes', { method: 'POST', body: nuevoCliente })
      setClientes((l) => [d.cliente, ...(l || [])])
      setTemporal({ email: d.cliente.email, password: d.password_temporal })
      setNuevoCliente(null)
      elegirCliente(d.cliente)
    } catch (e) {
      setError(e.message)
    }
  }

  const registrarMascota = async () => {
    setError('')
    try {
      const d = await api(`/api/citas/admin/clientes/${cliente.id}/mascotas`, { method: 'POST', body: nueva })
      setMascotas((l) => [...l, d.mascota])
      setMascotaId(d.mascota.id)
      setNueva(null)
    } catch (e) {
      setError(e.message)
    }
  }

  const submit = async () => {
    setError('')
    setSending(true)
    try {
      const d = await api('/api/citas/admin/citas', {
        method: 'POST',
        body: { servicio, mascota_id: mascotaId, ...cuerpoReserva(elegido.modalidad, eleccion), ...(profesional ? { profesional_id: Number(profesional) } : {}),
                nombre: contacto.nombre, email: contacto.email,
                telefono: contacto.telefono, notas: contacto.notas.trim() },
      })
      onDone(d.cita, d.aviso)
    } catch (e) {
      setError(e.message)
      if (e.status === 409) setEleccion((x) => ({ ...x, hora: '' }))
      setSending(false)
    }
  }

  return (
    <Modal title="Agendar cita" onClose={onClose} wide dirty={Boolean(cliente) && !sending}>
      <p className="modal__sub">Para quien llama o llega sin cita. Sin el límite de citas del cliente; el cupo lo sigue decidiendo el sistema.</p>
      <div className="clinical-form">
        <fieldset className="clinical-form__group">
          <legend>Cliente</legend>
          {cliente ? (
            <p className="agendar__elegido">
              <strong>{cliente.nombre}</strong> · {cliente.email}{cliente.telefono && ` · ${cliente.telefono}`}
              <button type="button" className="link-btn" onClick={() => { setCliente(null); setMascotaId(''); setMascotas(null) }}>Cambiar</button>
            </p>
          ) : (
            <>
              <label className="search admin-search">
                <Search size={18} />
                <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre, correo o teléfono" autoFocus aria-label="Buscar cliente" />
              </label>
              {!clientes && !error && <p className="summary__hint">Cargando clientes…</p>}
              {encontrados.length > 0 && (
                <ul className="agendar__resultados">
                  {encontrados.map((c) => (
                    <li key={c.id}><button type="button" onClick={() => elegirCliente(c)}><strong>{c.nombre}</strong> <small>{c.email}{c.telefono && ` · ${c.telefono}`}</small></button></li>
                  ))}
                </ul>
              )}
              {buscar.trim().length >= 2 && clientes && encontrados.length === 0 && !nuevoCliente && (
                <p className="summary__hint">
                  No hay clientes con «{buscar}».{' '}
                  <button type="button" className="link-btn" onClick={() => setNuevoCliente({ nombre: buscar.includes('@') ? '' : buscar, email: buscar.includes('@') ? buscar : '', telefono: '' })}>
                    Crear su cuenta
                  </button>
                </p>
              )}
              {nuevoCliente && (
                <div className="agendar__nuevo-cliente">
                  <div className="agenda__form-row agenda__form-row--3">
                    <label>Nombre
                      <input value={nuevoCliente.nombre} onChange={(e) => setNuevoCliente((n) => ({ ...n, nombre: e.target.value }))} maxLength={100} />
                    </label>
                    <label>Correo
                      <input type="email" value={nuevoCliente.email} onChange={(e) => setNuevoCliente((n) => ({ ...n, email: e.target.value }))} maxLength={120} />
                    </label>
                    <label>Teléfono
                      <input type="tel" value={nuevoCliente.telefono} onChange={(e) => setNuevoCliente((n) => ({ ...n, telefono: e.target.value }))} maxLength={20} />
                    </label>
                  </div>
                  <span className="pet-form__actions">
                    <button type="button" className="btn btn--dark btn--xs" onClick={crearCliente}
                      disabled={nuevoCliente.nombre.trim().length < 2 || !nuevoCliente.email.includes('@')}>Crear cuenta</button>
                    <button type="button" className="link-btn" onClick={() => setNuevoCliente(null)}>Cancelar</button>
                  </span>
                </div>
              )}
            </>
          )}
        </fieldset>

        {temporal && (
          <p className="form-ok agendar__temporal">
            Cuenta creada. Dale al cliente su correo <strong>{temporal.email}</strong> y esta contraseña temporal:{' '}
            <strong className="mono">{temporal.password}</strong>. Al entrar por primera vez deberá cambiarla. No se vuelve a mostrar.
          </p>
        )}
        {cliente && (
          <fieldset className="clinical-form__group">
            <legend>Mascota</legend>
            {!mascotas ? <p className="summary__hint">Cargando mascotas…</p> : (
              <div className="pet-picker pet-picker--list">
                {mascotas.map((m) => (
                  <label key={m.id} className={mascotaId === m.id ? 'active' : ''}>
                    <input type="radio" name="mascota-agendar" checked={mascotaId === m.id} onChange={() => setMascotaId(m.id)} />
                    <PetIcon especie={m.especie} size={20} /> {m.nombre}
                  </label>
                ))}
                {!nueva && <button type="button" className="pet-picker__add" onClick={() => setNueva({ nombre: '', especie: 'perro' })}><Plus size={16} /> Nueva mascota</button>}
              </div>
            )}
            {nueva && (
              <div className="agenda__form-row agendar__nueva">
                <label>Nombre
                  <input value={nueva.nombre} onChange={(e) => setNueva((n) => ({ ...n, nombre: e.target.value }))} maxLength={60} />
                </label>
                <label>Especie
                  <select value={nueva.especie} onChange={(e) => setNueva((n) => ({ ...n, especie: e.target.value }))}>
                    {ESPECIES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                  </select>
                </label>
                <span className="pet-form__actions">
                  <button type="button" className="btn btn--dark btn--xs" disabled={!nueva.nombre.trim()} onClick={registrarMascota}>Registrar</button>
                  <button type="button" className="link-btn" onClick={() => setNueva(null)}>Cancelar</button>
                </span>
              </div>
            )}
          </fieldset>
        )}

        {cliente && mascotaId && servicios && (
          <>
            <label>Servicio
              <select value={servicio} onChange={(e) => { setServicio(e.target.value); setProfesional(''); setEleccion({ fecha: '', hora: '', salida: '' }) }}>
                {servicios.map((s) => <option key={s.slug} value={s.slug}>{s.nombre} · {s.sede.nombre.split(' · ')[0]}</option>)}
              </select>
            </label>
            {elegido?.profesionales?.length > 0 && (
              <label>Con quién
                <select value={profesional} onChange={(e) => { setProfesional(e.target.value); setEleccion((x) => ({ ...x, hora: '' })) }}>
                  <option value="">Quien tenga lugar</option>
                  {elegido.profesionales.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </label>
            )}
            {elegido && <SlotPicker servicio={servicio} modalidad={elegido.modalidad} value={eleccion} onChange={setEleccion} numerado={false} profesional={profesional} />}
            <div className="agenda__form-row">
              <label>Quien la trae
                <input value={contacto.nombre} onChange={(e) => setContacto((x) => ({ ...x, nombre: e.target.value }))} maxLength={100} />
              </label>
              <label>Teléfono
                <input type="tel" value={contacto.telefono} onChange={(e) => setContacto((x) => ({ ...x, telefono: e.target.value }))} maxLength={20} />
              </label>
            </div>
            <label>{servicio === 'veterinaria' ? 'Motivo de la consulta' : 'Notas (opcional)'}
              <input value={contacto.notas} onChange={(e) => setContacto((x) => ({ ...x, notas: e.target.value }))} maxLength={300}
                placeholder={servicio === 'veterinaria' ? 'Control, vacunación, vómitos…' : ''} />
            </label>
          </>
        )}
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="pet-form__actions">
          <button type="button" className="btn btn--dark btn--sm" disabled={!listo || sending} onClick={submit}>
            {sending ? 'Agendando…' : eleccion.fecha && elegido ? `Agendar · ${formatReserva({ inicio: `${eleccion.fecha}T${eleccion.hora || '08:00'}`, fin: eleccion.salida ? `${eleccion.salida}T08:00` : null, servicio: elegido })}` : 'Agendar'}
          </button>
          <button type="button" className="link-btn" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </Modal>
  )
}
