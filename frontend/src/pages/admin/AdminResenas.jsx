import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Loading from '../../components/Loading'
import Rating from '../../components/shop/Rating'
import { api } from '../../api'
import { fechaCorta } from '../account/vacunas'

// Reseñas por revisar primero. Una reseña no se publica hasta aprobarla, y no se borra: se oculta
// (y deja de contar en la calificación).
export default function AdminResenas() {
  const [resenas, setResenas] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/api/catalogo/admin/resenas').then((d) => setResenas(d.resenas)).catch((e) => setError(e.message))
  }, [])

  const moderar = async (r, visible) => {
    try {
      await api(`/api/catalogo/admin/resenas/${r.id}`, { method: 'PATCH', body: { visible } })
      setResenas((l) => l.map((x) => (x.id === r.id ? { ...x, visible, estado: visible ? 'publicada' : 'oculta' } : x)))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="admin-card">
      <h2>Reseñas <small>· solo de clientes que compraron el producto{resenas && ` · ${resenas.filter((r) => r.estado === 'en_revision').length} por revisar`}</small></h2>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {!resenas ? !error && <Loading /> : resenas.length === 0 ? <p className="summary__hint">Todavía no hay reseñas.</p> : (
        <ul className="resumen__list">
          {resenas.map((r) => (
            <li key={r.id} className={r.estado === 'oculta' ? 'is-muted' : ''}>
              <span>
                <Rating value={r.calificacion} /> <strong>{r.autor}</strong> sobre <Link to={`/tienda/producto/${r.slug}`}>{r.producto}</Link>
                {r.comentario && <><br />{r.comentario}</>}
              </span>
              <small>
                {r.estado === 'en_revision' && <span className="status status--warn">Por revisar</span>}{' '}
                {fechaCorta(r.fecha)} ·{' '}
                {r.estado !== 'publicada' && <button className="link-btn" onClick={() => moderar(r, true)}>Publicar</button>}{' '}
                {r.estado !== 'oculta' && <button className="link-btn link-btn--danger" onClick={() => moderar(r, false)}>Ocultar</button>}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
