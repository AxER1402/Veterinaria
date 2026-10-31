import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'
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

  const porRevisar = resenas?.filter((r) => r.estado === 'en_revision').length ?? 0

  return (
    <>
      {resenas && <p className="barra__total barra__total--lista">{porRevisar > 0 ? `${porRevisar} por revisar` : 'Ninguna por revisar'} · solo opinan clientes que compraron el producto</p>}
      {error && <p className="form-alert" role="alert">{error}</p>}
      {!resenas ? !error && <Loading /> : resenas.length === 0 ? (
        <div className="vacio"><Star size={32} aria-hidden="true" /><p>Todavía no hay reseñas.</p></div>
      ) : (
        <ul className="lista">
          {resenas.map((r) => (
            <li key={r.id} className={`resena-fila ${r.estado === 'oculta' ? 'is-apagada' : ''}`}>
              <div className="resena-fila__texto">
                <p className="resena-fila__cabeza"><Rating value={r.calificacion} /> <strong>{r.autor}</strong> sobre <Link to={`/tienda/producto/${r.slug}`}>{r.producto}</Link></p>
                {r.comentario && <p>{r.comentario}</p>}
                <small>{fechaCorta(r.fecha)}</small>
              </div>
              <div className="resena-fila__acciones">
                {r.estado === 'en_revision' && <span className="status status--warn">Por revisar</span>}
                {r.estado === 'oculta' && <span className="status status--warn">Oculta</span>}
                {r.estado !== 'publicada' && <button className="btn btn--dark btn--xs" onClick={() => moderar(r, true)}>Publicar</button>}
                {r.estado !== 'oculta' && <button className="link-btn link-btn--danger" onClick={() => moderar(r, false)}>Ocultar</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
