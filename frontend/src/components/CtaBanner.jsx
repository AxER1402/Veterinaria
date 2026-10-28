import { Link } from 'react-router-dom'
import { Phone } from 'lucide-react'
import { business, images } from '../data/content'

export default function CtaBanner() {
  return (
    <section className="cta">
      <div className="container cta__inner">
        <img src={images.cta} alt="Bulldog francés con sudadera amarilla" loading="lazy" />
        <div className="cta__content">
          <h2>¿Listo para comenzar?</h2>
          <p>Reserva hoy y dale a tu mascota el cuidado que se merece.</p>
          <div className="cta__buttons">
            <Link to="/contacto#reservar" className="btn btn--primary">
              Reservar ahora
            </Link>
            <a href={`tel:${business.tel}`} className="btn btn--ghost-light">
              <Phone size={18} /> {business.phone}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
