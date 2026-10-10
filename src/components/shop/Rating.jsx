import { Star } from 'lucide-react'

export default function Rating({ value, reviews, size = 15 }) {
  return (
    <span className="rating" aria-label={`${value} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= Math.round(value) ? 'on' : ''} />
      ))}
      {reviews != null && <small>({reviews})</small>}
    </span>
  )
}
