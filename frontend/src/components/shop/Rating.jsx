import { Star } from 'lucide-react'

// Calificación promedio de reseñas reales. Sin reseñas no se inventa nada: «Sin reseñas».
export default function Rating({ value, reviews, size = 15 }) {
  if (reviews === 0) return <span className="rating rating--empty">Sin reseñas todavía</span>
  return (
    <span className="rating" aria-label={`${value} de 5 estrellas${reviews != null ? `, ${reviews} ${reviews === 1 ? 'reseña' : 'reseñas'}` : ''}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= Math.round(value) ? 'on' : ''} />
      ))}
      {reviews != null && <small>({reviews})</small>}
    </span>
  )
}
