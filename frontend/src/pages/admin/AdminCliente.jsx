import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import Avatar from '../../components/Avatar'
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
import Subvistas from './Subvistas'

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
  const [vista, setVista] = useState(null)
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

  const veVet = ['admin', 'veterinario'].includes(user.rol)
  const vistas = [
    ...(veCitas ? [{ id: 'citas', label: `Citas${clinica ? ` (${clinica.citas.length})` : ''}` }, { id: 'mascotas', label: `Mascotas${clinica ? ` (${clinica.mascotas.length})` : ''}` }] : []),
    ...(pedidos !== null ? [{ id: 'pedidos', label: `Pedidos${pedidos ? ` (${pedidos.length})` : ''}` }] : []),
  ]
  const activa = vista ?? vistas[0]?.id

  return (
    <>
      <Link to="/admin/clientes" className="volver"><ArrowLeft size={16} aria-hidden="true" /> Clientes</Link>
      <header className="ficha-cabeza ficha-cabeza--persona">
        <Avatar nombre={cliente.nombre} grande />
        <div>
          <h1>{cliente.nombre}</h1>
          <p>{cliente.email}{telefono && <> · <a href={`tel:${telefono}`}>{telefono}</a></>}</p>
          <p className="ficha-cabeza__suave">Cliente desde {formatDate(cliente.creado)}</p>
        </div>
        {(cliente.bloqueado || !cliente.activo) && <span className={`status status--${cliente.bloqueado ? 'bad' : 'warn'}`}>{cliente.bloqueado ? 'Bloqueada 15 min' : 'Inactiva'}</span>}
        <div className="ficha-cabeza__acciones">
          {veCitas && <button className="btn btn--primary btn--sm" onClick={() => setModal('agendar')}><Plus size={16} aria-hidden="true" /> Agendar cita</button>}
        </div>
      </header>
      {aviso && <p className="form-ok" role="status">{aviso}</p>}

      {clinica && (
        <dl className="cifras">
          <div><dt>Atendidas</dt><dd>{clinica.contadores.atendidas}</dd></div>
          <div><dt>Canceladas</dt><dd>{clinica.contadores.canceladas}</dd></div>
          <div className={clinica.contadores.faltas >= 3 ? 'es-mala' : ''}><dt>Faltas</dt><dd>{clinica.contadores.faltas}</dd></div>
          {clinica.contadores.faltas >= 3 && <p>Con 3 faltas en 3 meses ya no reserva en línea.</p>}
        </dl>
      )}

      {vistas.length > 1 && <Subvistas vistas={vistas} activa={activa} onChange={setVista} />}

      {activa === 'mascotas' && (!clinica ? clinica === false ? <p className="summary__hint">No disponible.</p> : <Loading /> : clinica.mascotas.length === 0 ? (
        <div className="vacio"><p>Sin mascotas registradas.</p></div>
      ) : (
        <ul className="pacientes">
          {clinica.mascotas.map((m) => {
            const cuerpo = (
              <>
                <span className="paciente__cabeza">
                  <span className="cita-fila__icono"><PetIcon especie={m.especie} size={24} /></span>
                  <span className="fila__principal">
                    <strong>{m.nombre}{!m.activa && ' · inactiva'}</strong>
                    <small>{[ESPECIES.find((e) => e.value === m.especie)?.label, m.raza, edad(m.fecha_nacimiento)].filter(Boolean).join(' · ')}</small>
                  </span>
                </span>
                <AlertasClinicas mascota={m} compact />
              </>
            )
            return <li key={m.id} className={m.activa ? '' : 'is-apagada'}>{veVet ? <Link to={`/admin/pacientes/${m.id}`} className="paciente">{cuerpo}</Link> : <div className="paciente">{cuerpo}</div>}</li>
          })}
        </ul>
      ))}

      {activa === 'citas' && (!clinica ? clinica === false ? <p className="summary__hint">No disponible.</p> : <Loading /> : clinica.citas.length === 0 ? (
        <div className="vacio"><p>Sin citas.</p></div>
      ) : (
        <ul className="lista">
          {clinica.citas.map((c) => (
            <li key={c.id} className="fila fila--historial">
              <span className="fila__principal"><strong className="primera-mayuscula">{formatReserva(c, true)}</strong><small>{c.servicio.nombre} · {c.mascota.nombre}</small></span>
              <span className={`status status--${CITA_STATUS[c.estado].tone}`}>{CITA_STATUS[c.estado].label}</span>
            </li>
          ))}
        </ul>
      ))}

      {activa === 'pedidos' && (pedidos === false ? <p className="summary__hint">No disponible.</p> : !pedidos || pedidos.length === 0 ? (
        <div className="vacio"><p>Sin pedidos.</p></div>
      ) : (
        <ul className="lista">
          {pedidos.map((p) => (
            <li key={p.id}>
              <Link to={`/admin/pedidos/${p.id}`} className="fila fila--pedido-corto">
                <span className="fila__principal"><strong className="mono">#{shortId(p.id)}</strong><small>{formatDate(p.fecha)}</small></span>
                <strong className="fila__monto">{formatPrice(p.total)}</strong>
                <span className={`status status--${STATUS[p.estado].tone}`}>{STATUS[p.estado].label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ))}

      {user.rol === 'admin' && (
        <p className="ficha-rol">
          <span>Dar acceso al panel</span>
          <RolSelect valor="cliente" nombre={cliente.nombre} onChange={(rol) => setModal({ rol })} />
        </p>
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
