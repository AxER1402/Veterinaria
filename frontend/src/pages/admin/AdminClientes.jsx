import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, Search } from 'lucide-react'
import Loading from '../../components/Loading'
import { api, getToken } from '../../api'
import { useAuth } from '../../context/useAuth'
import { formatDate } from '../account/orderStatus'
import { ROLES } from './roles'
import Select from '../../components/Select'

const normalizar = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function AdminClientes() {
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
      <div className="admin-card">
        <div className="admin-card__head">
          <h2>Clientes {clientes && <small>· {lista.length}</small>}</h2>
          {user.rol === 'admin' && (
            <button className="btn btn--primary btn--sm" onClick={exportar} disabled={exportando}>
              <Download size={16} /> {exportando ? 'Exportando…' : 'Exportar CSV'}
            </button>
          )}
        </div>
        <div className="admin-filters">
          <label className="search admin-search">
            <Search size={18} />
            <input type="search" value={q} placeholder="Nombre, correo o teléfono" aria-label="Buscar cliente"
              onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })} />
          </label>
        </div>
        {user.rol === 'admin' && <p className="summary__hint">La exportación incluye solo id, nombre, correo, estado y fecha de alta, y queda registrada como EXPORTACION_CLIENTES.</p>}
        {error && <p className="form-alert">{error}</p>}
        {!clientes ? !error && <Loading /> : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead><tr><th>Cliente</th><th>Teléfono</th>{clinica && <><th className="num">Atendidas</th><th className="num">Canceladas</th><th className="num">Faltas</th></>}<th>Alta</th><th>Estado</th></tr></thead>
              <tbody>
                {lista.map((c) => {
                  const n = contadores[c.id] || {}
                  return (
                    <tr key={c.id}>
                      <td><Link to={`/admin/clientes/${c.id}`}><strong>{c.nombre}</strong></Link><small>{c.email}</small></td>
                      <td>{c.telefono ? <a href={`tel:${c.telefono}`}>{c.telefono}</a> : '—'}</td>
                      {clinica && (
                        <>
                          <td className="num">{n.atendidas ?? '—'}</td>
                          <td className="num">{n.canceladas ?? '—'}</td>
                          <td className="num">{n.faltas ? <span className={`status status--${n.faltas >= 3 ? 'bad' : 'warn'}`}>{n.faltas}</span> : n.faltas ?? '—'}</td>
                        </>
                      )}
                      <td>{formatDate(c.creado)}</td>
                      <td>
                        {c.bloqueado ? <span className="status status--bad">Bloqueado 15 min</span>
                          : c.activo ? <span className="status status--ok">Activo</span> : <span className="status status--warn">Inactivo</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {user.rol === 'admin' && <Personal yo={user.id} />}
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
    <div className="admin-card">
      <h2>Personal y roles</h2>
      <p className="summary__hint">
        Veterinario: agenda, pacientes e historial. Recepción: agenda y clientes. Tienda: pedidos y catálogo. Administración: todo,
        incluida la bitácora. Para dar acceso a alguien, abre su ficha de cliente y cambia su rol. Cada cambio queda como ROL_CAMBIADO.
      </p>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {aviso && <p className="form-ok" role="status">{aviso}</p>}
      {!personal ? !error && <Loading /> : (
        <div className="table-scroll">
          <table className="admin-table">
          <thead><tr><th>Nombre</th><th>Rol</th><th>Dos pasos</th></tr></thead>
          <tbody>
            {personal.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.nombre}</strong><small>{u.email}</small></td>
                <td>
                  {u.id === yo ? ROLES[u.rol] : (
                    <RolSelect valor={u.rol} onChange={(rol) => cambiar(u, rol)} nombre={u.nombre} />
                  )}
                </td>
                <td>{u.mfa ? <span className="status status--ok">Activa</span> : <span className="status status--warn">No</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}

export function RolSelect({ valor, onChange, nombre }) {
  return (
    <Select value={valor} onChange={(e) => e.target.value !== valor && onChange(e.target.value)} aria-label={`Rol de ${nombre}`}>
      {Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </Select>
  )
}
