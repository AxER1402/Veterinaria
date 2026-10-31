import { Link } from 'react-router-dom'
import { Phone } from 'lucide-react'
import { images } from '../data/content'
import { useClinica } from '../context/useClinica'

export default function CtaBanner() {
  const { telefono, tel } = useClinica()
  return (
    <section className="cta">
      <div className="container cta__inner">
        <img src={images.cta} alt="Bulldog francés con sudadera amarilla" loading="lazy" />
        <div className="cta__content">
          <h2>¿Listo para comenzar?</h2>
          <p>Reserva hoy y dale a tu mascota el cuidado que se merece.</p>
          <div className="cta__buttons">
            <Link to="/reservar" className="btn btn--primary">
              Reservar ahora
            </Link>
            <a href={tel} className="btn btn--ghost-light">
              <Phone size={18} /> {telefono}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
