import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import Reveal from '../components/Reveal'
import Faq from '../components/Faq'
import { services } from '../data/content'

export default function Services() {
  return (
    <>
      <PageHeader
        title="Servicios"
        text="Todo lo que tu mascota necesita para una vida sana y feliz, en un solo lugar."
      />
      <section className="section">
        <div className="container service-list">
          {services.map((s, i) => {
            const Icon = s.icon
            return (
              <Reveal key={s.slug} id={s.slug} className={`service-row ${i % 2 ? 'service-row--reverse' : ''}`}>
                <div className="service-row__media">
                  <img src={s.image} alt={s.title} loading="lazy" />
                </div>
                <div className="service-row__content">
                  <span className="service-card__icon">
                    <Icon size={30} strokeWidth={1.8} />
                  </span>
                  <h2>{s.title}</h2>
                  <p>{s.description}</p>
                  <div className="service-row__footer">
                    <span className="price">{s.price}</span>
                    <Link to={`/contacto?servicio=${s.slug}#reservar`} className="btn btn--primary btn--sm">
                      Reservar
                    </Link>
                  </div>
                </div>
              </Reveal>
            )
          })}
        </div>
      </section>
      <Faq limit={3} />
    </>
  )
}
