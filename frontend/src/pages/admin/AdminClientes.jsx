import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import Loading from '../../components/Loading'
import { api, getToken } from '../../api'
import { formatDate } from '../account/orderStatus'

export default function AdminClientes() {
  const [clientes, setClientes] = useState(null)
  const [error, setError] = useState('')
  const [exportando, setExportando] = useState(false)

  useEffect(() => {
    api('/api/auth/admin/clientes').then((d) => setClientes(d.clientes)).catch((e) => setError(e.message))
  }, [])

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
    <div className="admin-card">
      <div className="admin-card__head">
        <h2>Clientes</h2>
        <button className="btn btn--primary btn--sm" onClick={exportar} disabled={exportando}>
          <Download size={16} /> {exportando ? 'Exportando…' : 'Exportar CSV'}
        </button>
      </div>
      <p className="summary__hint">La exportación incluye solo id, nombre, correo, estado y fecha de alta, y queda registrada como EXPORTACION_CLIENTES.</p>
      {error && <p className="form-alert">{error}</p>}
      {!clientes ? <Loading /> : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead><tr><th>ID</th><th>Nombre</th><th>Correo</th><th>Alta</th><th>Estado</th></tr></thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.id}</td>
                  <td>{c.nombre}</td>
                  <td>{c.email}</td>
                  <td>{formatDate(c.creado)}</td>
                  <td>
                    {c.bloqueado ? <span className="status status--bad">Bloqueado 15 min</span>
                      : c.activo ? <span className="status status--ok">Activo</span> : <span className="status status--warn">Inactivo</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
