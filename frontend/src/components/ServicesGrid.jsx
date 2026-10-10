import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import Reveal from './Reveal'
import SectionTitle from './SectionTitle'
import { services } from '../data/content'

export default function ServicesGrid() {
  return (
    <section className="section section--tint">
      <div className="container">
        <SectionTitle eyebrow="Servicios" title="Somos los mejores en:" center />
        <div className="services-grid">
          {services.map((s, i) => {
            const Icon = s.icon
            return (
              <Reveal key={s.slug} delay={i * 80}>
                <Link to={`/servicios#${s.slug}`} className="service-card">
                  <span className="service-card__icon">
                    <Icon size={34} strokeWidth={1.8} />
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.short}</p>
                  <span className="service-card__more">
                    Ver más <ArrowRight size={16} />
                  </span>
                </Link>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
