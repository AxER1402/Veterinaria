import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import Loading from '../../components/Loading'
import PetIcon from '../../components/PetIcon'
import ConfirmDialog from '../../components/ConfirmDialog'
import { api } from '../../api'
import { useAuth } from '../../context/useAuth'
import { CITA_STATUS, ESPECIES, edad, formatReserva } from '../account/citas'
import { STATUS, formatDate, shortId } from '../account/orderStatus'
import { formatPrice } from '../../data/shop'
import AgendarCita from './AgendarCita'
import { RolSelect } from './AdminClientes'
import { AlertasClinicas } from './ClinicalRecord'
import { ROLES } from './roles'

const CLINICA = ['admin', 'veterinario', 'recepcion']
const TIENDA = ['admin', 'tienda']

// Ficha del cliente: contacto, mascotas, citas (con cancelaciones y faltas) y pedidos. Cada parte
// viene del servicio que la tiene; si un rol no tiene acceso a una, esa parte no se muestra.
export default function AdminCliente() {
  const { id } = useParams()
  const { user } = useAuth()
  const [cliente, setCliente] = useState(null)
  const [clinica, setClinica] = useState(null)
  const [pedidos, setPedidos] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [modal, setModal] = useState(null)
  const veCitas = CLINICA.includes(user.rol)

  const cargarCitas = () => api(`/api/citas/admin/clientes/${id}`).then(setClinica).catch(() => setClinica(false))
  useEffect(() => {
    api(`/api/auth/admin/clientes/${id}`).then((d) => setCliente(d.cliente)).catch((e) => setError(e.message))
    if (veCitas) cargarCitas()
    if (TIENDA.includes(user.rol)) api(`/api/pedidos/admin/clientes/${id}`).then((d) => setPedidos(d.pedidos)).catch(() => setPedidos(false))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="admin-card"><p className="form-alert">{error}</p><Link to="/admin/clientes">Volver a clientes</Link></div>
  if (!cliente) return <Loading />
  const telefono = cliente.telefono || clinica?.telefono

  return (
    <>
      <Link to="/admin/clientes" className="link-btn patient__back"><ArrowLeft size={16} /> Clientes</Link>
      <div className="admin-card">
        <div className="admin-card__head">
          <h2>{cliente.nombre}</h2>
          {veCitas && <button className="btn btn--primary btn--sm" onClick={() => setModal('agendar')}><Plus size={16} /> Agendar cita</button>}
        </div>
        <p className="patient__meta">
          {cliente.email}{telefono && <> · <a href={`tel:${telefono}`}>{telefono}</a></>} · cliente desde {formatDate(cliente.creado)}
          {' · '}{cliente.bloqueado ? <span className="status status--bad">Bloqueada 15 min</span> : cliente.activo ? <span className="status status--ok">Activa</span> : <span className="status status--warn">Inactiva</span>}
        </p>
        {clinica && (
          <div className="stat-tiles stat-tiles--compact">
            <div className="stat-tile"><span>Citas atendidas</span><strong>{clinica.contadores.atendidas}</strong></div>
            <div className="stat-tile"><span>Canceladas</span><strong>{clinica.contadores.canceladas}</strong></div>
            <div className={`stat-tile ${clinica.contadores.faltas >= 3 ? 'stat-tile--bad' : ''}`}><span>Faltas</span><strong>{clinica.contadores.faltas}</strong>
              {clinica.contadores.faltas >= 3 && <small>Con 3 faltas en 3 meses ya no reserva en línea</small>}</div>
          </div>
        )}
        {user.rol === 'admin' && (
          <p className="patient__meta">
            Acceso al panel: <RolSelect valor="cliente" nombre={cliente.nombre} onChange={(rol) => setModal({ rol })} />
          </p>
        )}
        {aviso && <p className="form-ok" role="status">{aviso}</p>}
      </div>

      {veCitas && (
        <div className="admin-grid admin-grid--even">
          <div className="admin-card">
            <h2>Mascotas</h2>
            {!clinica ? clinica === false ? <p className="summary__hint">No disponible.</p> : <Loading /> : clinica.mascotas.length === 0 ? (
              <p className="summary__hint">Sin mascotas registradas.</p>
            ) : (
              <ul className="resumen__list">
                {clinica.mascotas.map((m) => (
                  <li key={m.id} className={m.activa ? '' : 'is-muted'}>
                    <span>
                      <PetIcon especie={m.especie} size={16} />{' '}
                      {['admin', 'veterinario'].includes(user.rol) ? <Link to={`/admin/pacientes/${m.id}`}>{m.nombre}</Link> : <strong>{m.nombre}</strong>}
                      {' · '}{[ESPECIES.find((e) => e.value === m.especie)?.label, m.raza, edad(m.fecha_nacimiento)].filter(Boolean).join(' · ')}
                      {!m.activa && ' · inactiva'}
                      <AlertasClinicas mascota={m} compact />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="admin-card">
            <h2>Citas</h2>
            {!clinica ? clinica === false ? <p className="summary__hint">No disponible.</p> : <Loading /> : clinica.citas.length === 0 ? (
              <p className="summary__hint">Sin citas.</p>
            ) : (
              <ul className="patient__citas">
                {clinica.citas.map((c) => (
                  <li key={c.id}>
                    <span><strong>{formatReserva(c, true)}</strong><small>{c.servicio.nombre} · {c.mascota.nombre}</small></span>
                    <span className={`status status--${CITA_STATUS[c.estado].tone}`}>{CITA_STATUS[c.estado].label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {pedidos !== null && (
        <div className="admin-card">
          <h2>Pedidos</h2>
          {pedidos === false ? <p className="summary__hint">No disponible.</p> : pedidos.length === 0 ? <p className="summary__hint">Sin pedidos.</p> : (
            <div className="table-scroll">
              <table className="admin-table">
              <thead><tr><th>Pedido</th><th>Fecha</th><th className="num">Total</th><th>Estado</th></tr></thead>
              <tbody>
                {pedidos.map((p) => (
                  <tr key={p.id}>
                    <td className="mono"><Link to={`/admin/pedidos/${p.id}`}>{shortId(p.id)}</Link></td>
                    <td>{formatDate(p.fecha)}</td>
                    <td className="num">{formatPrice(p.total)}</td>
                    <td><span className={`status status--${STATUS[p.estado].tone}`}>{STATUS[p.estado].label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {modal === 'agendar' && (
        <AgendarCita inicial={{ clienteId: cliente.id }} onClose={() => setModal(null)}
          onDone={(c) => { setModal(null); setAviso(`Cita agendada: ${c.mascota.nombre}, ${formatReserva(c)}.`); cargarCitas() }} />
      )}
      {modal?.rol && (
        <ConfirmDialog title={`Dar acceso al panel a ${cliente.nombre}`} onClose={() => setModal(null)} confirmLabel={`Hacer ${ROLES[modal.rol]}`}
          text={`Su cuenta pasará a ${ROLES[modal.rol]} y verá esas secciones del panel desde su próximo inicio de sesión. Queda registrado en la bitácora.`}
          onConfirm={async () => {
            await api(`/api/auth/admin/usuarios/${cliente.id}/rol`, { method: 'PATCH', body: { rol: modal.rol } })
            setModal(null)
            setAviso(`${cliente.nombre} ahora es ${ROLES[modal.rol]}. Aparece en «Personal y roles».`)
          }} />
      )}
    </>
  )
}
