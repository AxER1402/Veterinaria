import { Link } from 'react-router-dom'
import { PawIcon } from '../components/Brand'

export default function NotFound() {
  return (
    <section className="not-found">
      <PawIcon size={80} />
      <h1>404</h1>
      <p>¡Ups! Parece que esta página salió a pasear.</p>
      <Link to="/" className="btn btn--primary">
        Volver al inicio
      </Link>
    </section>
  )
}
