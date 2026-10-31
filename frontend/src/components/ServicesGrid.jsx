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
        <div className="servicios">
          {services.map((s, i) => {
            const Icon = s.icon
            return (
              <Reveal key={s.slug} delay={i * 60}>
                <Link to={`/servicios#${s.slug}`} className="servicio">
                  <span className="servicio__foto">
                    <img src={s.image} alt="" loading="lazy" style={s.imagePos ? { objectPosition: s.imagePos } : undefined} />
                  </span>
                  <span className="servicio__cuerpo">
                    <span className="servicio__titulo">
                      <span className="servicio__icono"><Icon size={22} strokeWidth={1.8} aria-hidden="true" /></span>
                      <h3>{s.title}</h3>
                    </span>
                    <p>{s.short}</p>
                    <span className="servicio__mas">Ver más <ArrowRight size={16} aria-hidden="true" /></span>
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
