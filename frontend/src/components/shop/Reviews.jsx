import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Star } from 'lucide-react'
import Rating from './Rating'
import { api } from '../../api'
import { useAuth } from '../../context/useAuth'
import { fechaCorta } from '../../pages/account/vacunas'

// Reseñas de un producto. Solo opina quien lo compró (lo verifica el servidor con pedidos-service);
// cada cliente tiene una reseña por producto y la puede editar.
export default function Reviews({ slug }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [datos, setDatos] = useState(null)
  const [mia, setMia] = useState(null)

  useEffect(() => {
    api(`/api/catalogo/productos/${slug}/resenas`, { auth: false }).then(setDatos).catch(() => setDatos({ resenas: [], total: 0, calificacion: 0 }))
  }, [slug])
  useEffect(() => {
    if (user?.rol !== 'cliente') return
    api(`/api/catalogo/productos/${slug}/resenas/mia`).then(setMia).catch(() => {})
  }, [slug, user?.rol])

  if (!datos) return null
  return (
    <section className="section section--compact reviews" id="resenas">
      <div className="container">
        <h2>Reseñas {datos.total > 0 && <small><Rating value={datos.calificacion} reviews={datos.total} /> {datos.calificacion.toFixed(1)} de 5</small>}</h2>
        {!user && <p className="summary__hint"><Link to="/cuenta" state={{ from: pathname }}>Inicia sesión</Link> para opinar sobre un producto que compraste.</p>}
        {mia && (mia.compro
          ? <ReviewForm slug={slug} actual={mia.resena} onSaved={(d) => {
              setDatos(d)
              api(`/api/catalogo/productos/${slug}/resenas/mia`).then(setMia).catch(() => {})
            }} />
          : <p className="summary__hint">Podrás dejar una reseña cuando compres este producto.</p>)}
        {datos.resenas.length === 0 ? <p className="summary__hint">Todavía nadie ha opinado sobre este producto.</p> : (
          <ul className="reviews__list">
            {datos.resenas.map((r) => (
              <li key={r.id}>
                <Rating value={r.calificacion} />
                <strong>{r.autor}</strong> <small>· compra verificada · {fechaCorta(r.fecha)}</small>
                {r.comentario && <p>{r.comentario}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function ReviewForm({ slug, actual, onSaved }) {
  const [calificacion, setCalificacion] = useState(actual?.calificacion || 0)
  const [comentario, setComentario] = useState(actual?.comentario || '')
  const [abierto, setAbierto] = useState(!actual)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!calificacion) return setError('Elige de 1 a 5 estrellas')
    setError('')
    setSending(true)
    try {
      onSaved(await api(`/api/catalogo/productos/${slug}/resenas`, { method: 'POST', body: { calificacion, comentario: comentario.trim() } }))
      setOk('¡Gracias! Tu reseña ya está publicada.')
      setAbierto(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  if (!abierto) {
    return (
      <p className="summary__hint">
        {ok || 'Ya opinaste sobre este producto.'} <button className="link-btn" onClick={() => { setOk(''); setAbierto(true) }}>Editar mi reseña</button>
      </p>
    )
  }
  return (
    <form className="reviews__form" onSubmit={submit}>
      <span className="reviews__stars" role="radiogroup" aria-label="Calificación">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={calificacion === n} aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}
            className={n <= calificacion ? 'on' : ''} onClick={() => setCalificacion(n)}><Star size={26} /></button>
        ))}
      </span>
      <textarea rows="3" value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={600}
        placeholder="¿Qué te pareció? ¿Le gustó a tu mascota? (opcional)" aria-label="Comentario" />
      {error && <p className="form-alert" role="alert">{error}</p>}
      <button className="btn btn--dark btn--sm" disabled={sending}>{sending ? 'Publicando…' : actual ? 'Guardar cambios' : 'Publicar reseña'}</button>
    </form>
  )
}
