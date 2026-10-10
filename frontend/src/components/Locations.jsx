import { MapPin, ArrowUpRight } from 'lucide-react'
import Reveal from './Reveal'
import SectionTitle from './SectionTitle'
import { locations } from '../data/content'

export default function Locations() {
  return (
    <section className="section section--tint">
      <div className="container">
        <SectionTitle eyebrow="Sedes" title="Encuéntranos" center />
        <div className="locations">
          {locations.map((l, i) => (
            <Reveal key={l.title} className="location" delay={i * 100}>
              <span className="location__icon">
                <MapPin size={26} />
              </span>
              <h3>{l.title}</h3>
              <p>{l.address}</p>
              <a href={l.map} target="_blank" rel="noreferrer">
                Ver en el mapa <ArrowUpRight size={16} />
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
