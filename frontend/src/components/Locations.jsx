import { useState } from 'react'
import { MapPin, ArrowUpRight, Clock, Phone } from 'lucide-react'
import SectionTitle from './SectionTitle'
import { useClinica } from '../context/useClinica'
import { resumenHorario } from '../data/horarios'
import MapEmbed from './MapEmbed'

// Una lista de sedes y un solo mapa: se carga menos y el mapa se ve grande.
export default function Locations() {
  const [activa, setActiva] = useState(0)
  const { sedes, cargando, telefono, tel } = useClinica()
  const sede = sedes[activa] || sedes[0]
  if (cargando || !sede) return null

  return (
    <section className="section section--tint">
      <div className="container">
        <SectionTitle eyebrow="Sedes" title="Encuéntranos" center />
        <div className="sedes">
          <div className="sedes__lista">
            {sedes.map((l, i) => (
              <button key={l.codigo} type="button" className={`sede ${i === activa ? 'is-activa' : ''}`} aria-pressed={i === activa} onClick={() => setActiva(i)}>
                <span className="sede__icono"><MapPin size={20} aria-hidden="true" /></span>
                <span>
                  <strong>{l.nombre}</strong>
                  <small>{l.direccion}</small>
                </span>
              </button>
            ))}
            <div className="sedes__datos">
              <a href={sede.telefono ? `tel:${sede.telefono.replace(/[^+\d]/g, '')}` : tel}><Phone size={18} aria-hidden="true" /> {sede.telefono || telefono}</a>
              <span><Clock size={18} aria-hidden="true" /> {resumenHorario(sede.horarios)}</span>
            </div>
          </div>
          <div className="sedes__mapa">
            <MapEmbed key={sede.codigo} query={sede.ubicacion} title={`Mapa de ${sede.nombre}`} height={460} />
            <a href={`https://maps.google.com/?q=${encodeURIComponent(sede.ubicacion)}`} target="_blank" rel="noreferrer" className="btn btn--dark btn--sm sedes__llegar">
              Cómo llegar <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
