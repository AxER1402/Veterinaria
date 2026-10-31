import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import Reveal from '../components/Reveal'
import Faq from '../components/Faq'
import { images, services } from '../data/content'
import { useClinica } from '../context/useClinica'

// El sufijo («/ noche») sale del texto del servicio; el monto, de lo que se administra en el panel.
function precioDesde(s, servicios) {
  const actual = servicios.find((x) => x.slug === s.slug)
  if (!actual) return s.price
  const monto = Number.isInteger(actual.precio_desde) ? actual.precio_desde : actual.precio_desde.toFixed(2)
  return s.price.replace(/Q[\d.,]+/, `Q${monto}`)
}

export default function Services() {
  const { servicios, cargando } = useClinica()
  const precioTexto = (s) => precioDesde(s, servicios)
  // Un servicio apagado en el panel deja de ofrecerse.
  const visibles = cargando ? services : services.filter((s) => servicios.some((x) => x.slug === s.slug))
  return (
    <>
      <PageHero
        cara="><(((º>"
        title={<>Todo para tu mascota, <span className="highlight">en un solo lugar</span></>}
        text="Salud, higiene, paseos, entrenamiento y cuidado para una vida sana y feliz."
        cta={{ to: '/reservar', label: 'Reservar cita' }}
        image={images.servicios}
        alt="Perro pastor australiano sonriendo en la playa"
        tag={<><strong>{services.length}</strong> servicios para tu mascota</>}
      />
      <section className="section">
        <div className="container service-list">
          {visibles.map((s, i) => {
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
                    <span className="price">{precioTexto(s)}</span>
                    <Link to={`/reservar?servicio=${s.slug}`} className="btn btn--primary btn--sm">
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
