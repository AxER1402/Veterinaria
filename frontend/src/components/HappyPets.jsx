import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import Reveal from './Reveal'
import SectionTitle from './SectionTitle'
import { images } from '../data/content'
import { useClinica } from '../context/useClinica'

const points = ['Médicos veterinarios certificados', 'Instalaciones limpias y seguras', 'Reportes y fotos diarias']

// En la propia página Nosotros, `conEnlace` va apagado: el botón llevaría a la misma página.
export default function HappyPets({ conEnlace = true }) {
  const { sedes } = useClinica()
  return (
    <section className="section">
      <div className="container split">
        <Reveal className="split__media">
          <div className="oval-frame">
            <img src={images.happyPets} alt="Perro y gato descansando juntos" loading="lazy" />
          </div>
          <div className="sticker">
            <strong>{sedes.length || 1}</strong>
            <span>{sedes.length === 1 ? 'sede' : 'sedes'} en la ciudad</span>
          </div>
        </Reveal>
        <Reveal className="split__content" delay={150}>
          <SectionTitle
            eyebrow="Sobre nosotros"
            title="Mascotas felices, familias felices"
            text="En Huellitas combinamos medicina veterinaria de calidad con cuidado diario lleno de cariño. Cada mascota recibe atención personalizada para que tú tengas total tranquilidad."
          />
          <ul className="checklist">
            {points.map((p) => (
              <li key={p}>
                <span><Check size={16} /></span> {p}
              </li>
            ))}
          </ul>
          {conEnlace && (
            <Link to="/nosotros" className="btn btn--dark">
              Conoce más
            </Link>
          )}
        </Reveal>
      </div>
    </section>
  )
}
