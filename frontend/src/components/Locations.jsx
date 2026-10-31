import { useState } from 'react'
import { MapPin, ArrowUpRight, Clock, Phone } from 'lucide-react'
import SectionTitle from './SectionTitle'
import { business, locations } from '../data/content'
import MapEmbed from './MapEmbed'

// Una lista de sedes y un solo mapa: se carga menos y el mapa se ve grande.
export default function Locations() {
  const [activa, setActiva] = useState(0)
  const sede = locations[activa]

  return (
    <section className="section section--tint">
      <div className="container">
        <SectionTitle eyebrow="Sedes" title="Encuéntranos" center />
        <div className="sedes">
          <div className="sedes__lista">
            {locations.map((l, i) => (
              <button key={l.title} type="button" className={`sede ${i === activa ? 'is-activa' : ''}`} aria-pressed={i === activa} onClick={() => setActiva(i)}>
                <span className="sede__icono"><MapPin size={20} aria-hidden="true" /></span>
                <span>
                  <strong>{l.title}</strong>
                  <small>{l.address}</small>
                </span>
              </button>
            ))}
            <div className="sedes__datos">
              <a href={`tel:${business.tel}`}><Phone size={18} aria-hidden="true" /> {business.phone}</a>
              <span><Clock size={18} aria-hidden="true" /> {business.hours}</span>
            </div>
          </div>
          <div className="sedes__mapa">
            <MapEmbed key={sede.title} query={`${sede.address}, Ciudad de Guatemala`} title={`Mapa de ${sede.title}`} height={460} />
            <a href={sede.map} target="_blank" rel="noreferrer" className="btn btn--dark btn--sm sedes__llegar">
              Cómo llegar <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
