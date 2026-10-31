import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight, Download, Search } from 'lucide-react'
import Avatar from '../../components/Avatar'
import Loading from '../../components/Loading'
import { api, getToken } from '../../api'
import { useAuth } from '../../context/useAuth'
import { ROLES } from './roles'
import Select from '../../components/Select'
import Subvistas from './Subvistas'

const normalizar = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function AdminClientes() {
  const { user } = useAuth()
  const [vista, setVista] = useState('clientes')
  // El personal y sus roles solo los ve el admin.
  if (user.rol !== 'admin') return <ListaClientes />
  return (
    <>
      <Subvistas vistas={[{ id: 'clientes', label: 'Clientes' }, { id: 'personal', label: 'Personal y roles' }]} activa={vista} onChange={setVista} />
      {vista === 'clientes' ? <ListaClientes /> : <Personal yo={user.id} />}
    </>
  )
}

function ListaClientes() {
  const { user } = useAuth()
  // Cancelaciones y faltas son datos de la agenda: solo los ve el personal de la clínica (la tienda no tiene acceso a citas).
  const clinica = ['admin', 'veterinario', 'recepcion'].includes(user.rol)
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const [clientes, setClientes] = useState(null)
  const [contadores, setContadores] = useState({})
  const [error, setError] = useState('')
  const [exportando, setExportando] = useState(false)

  useEffect(() => {
    api('/api/auth/admin/clientes').then((d) => setClientes(d.clientes)).catch((e) => setError(e.message))
    if (clinica) api('/api/citas/admin/clientes/contadores').then((d) => setContadores(d.contadores)).catch(() => {})
  }, [clinica])

  const lista = useMemo(() => {
    const t = normalizar(q.trim())
    return (clientes || []).filter((c) => !t || [c.nombre, c.email, c.telefono, String(c.id)].some((x) => normalizar(x).includes(t)))
  }, [clientes, q])

  // La descarga necesita el JWT en la cabecera: se baja como blob en vez de abrir un enlace.
  const exportar = async () => {
    setExportando(true)
    try {
      const res = await fetch('/api/auth/admin/clientes/exportar', { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'No se pudo exportar')
      const nombre = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'clientes.csv'
      const url = URL.createObjectURL(await res.blob())
      const a = Object.assign(document.createElement('a'), { href: url, download: nombre })
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e.message)
    } finally {
      setExportando(false)
    }
  }

  return (
    <>
      <div className="barra">
        <label className="search admin-search">
          <Search size={18} />
          <input type="search" value={q} placeholder="Nombre, correo o teléfono" aria-label="Buscar cliente"
            onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })} />
        </label>
        {clientes && <span className="barra__total">{lista.length} {lista.length === 1 ? 'cliente' : 'clientes'}</span>}
        {user.rol === 'admin' && (
          <button className="btn btn--ghost btn--xs barra__fin" onClick={exportar} disabled={exportando}
            title="Incluye id, nombre, correo, estado y fecha de alta. Queda registrada en la bitácora.">
            <Download size={16} /> {exportando ? 'Exportando…' : 'Exportar CSV'}
          </button>
        )}
      </div>
      {error && <p className="form-alert">{error}</p>}
      {!clientes ? !error && <Loading /> : lista.length === 0 ? (
        <div className="vacio"><Search size={32} aria-hidden="true" /><p>{q ? `Ningún cliente coincide con «${q}».` : 'Todavía no hay clientes.'}</p></div>
      ) : (
        <ul className="lista">
          {lista.map((c) => {
            const n = contadores[c.id] || {}
            return (
              <li key={c.id}>
                <Link to={`/admin/clientes/${c.id}`} className="fila fila--cliente">
                  <Avatar nombre={c.nombre} />
                  <span className="fila__principal"><strong>{c.nombre}</strong><small>{c.email}</small></span>
                  <span className="fila__dato">{c.telefono}</span>
                  <span className="fila__dato fila__dato--suave">{clinica && `${n.atendidas ?? 0} ${n.atendidas === 1 ? 'atendida' : 'atendidas'}`}</span>
                  <span className="fila__estado">
                    {n.faltas > 0 && <span className={`status status--${n.faltas >= 3 ? 'bad' : 'warn'}`}>{n.faltas} {n.faltas === 1 ? 'falta' : 'faltas'}</span>}
                    {c.bloqueado ? <span className="status status--bad">Bloqueado 15 min</span> : !c.activo && <span className="status status--warn">Inactivo</span>}
                  </span>
                  <ChevronRight size={18} className="fila__flecha" aria-hidden="true" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

// Personal con acceso al panel y su rol (solo admin). El rol nuevo rige al volver a iniciar sesión.
function Personal({ yo }) {
  const [personal, setPersonal] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    api('/api/auth/admin/personal').then((d) => setPersonal(d.personal)).catch((e) => setError(e.message))
  }, [])

  const cambiar = async (u, rol) => {
    setError('')
    setAviso('')
    try {
      const d = await api(`/api/auth/admin/usuarios/${u.id}/rol`, { method: 'PATCH', body: { rol } })
      setPersonal((l) => (rol === 'cliente' ? l.filter((x) => x.id !== u.id) : l.map((x) => (x.id === u.id ? { ...x, ...d.usuario } : x))))
      setAviso(`${u.nombre}: ${ROLES[rol]}. Rige en su próximo inicio de sesión.`)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <>
      <ul className="roles">
        <li><strong>Veterinario</strong> Agenda, pacientes e historial</li>
        <li><strong>Recepción</strong> Agenda y clientes</li>
        <li><strong>Tienda</strong> Pedidos y catálogo</li>
        <li><strong>Administración</strong> Todo, incluida la bitácora</li>
      </ul>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {aviso && <p className="form-ok" role="status">{aviso}</p>}
      {!personal ? !error && <Loading /> : (
        <ul className="lista">
          {personal.map((u) => (
            <li key={u.id} className="fila fila--personal">
              <Avatar nombre={u.nombre} />
              <span className="fila__principal"><strong>{u.nombre}</strong><small>{u.email}</small></span>
              <span className="fila__estado">
                <span className={`status status--${u.mfa ? 'ok' : 'warn'}`}>{u.mfa ? 'Dos pasos activa' : 'Sin dos pasos'}</span>
              </span>
              <span className="fila__rol">
                {u.id === yo ? ROLES[u.rol] : <RolSelect valor={u.rol} onChange={(rol) => cambiar(u, rol)} nombre={u.nombre} />}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="summary__hint">Para dar acceso a alguien, abre su ficha de cliente y cambia su rol. Cada cambio queda en la bitácora y rige en su próximo inicio de sesión.</p>
    </>
  )
}

export function RolSelect({ valor, onChange, nombre }) {
  return (
    <Select value={valor} onChange={(e) => e.target.value !== valor && onChange(e.target.value)} aria-label={`Rol de ${nombre}`}>
      {Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </Select>
  )
}
