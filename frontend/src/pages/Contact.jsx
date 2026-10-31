import { Link } from 'react-router-dom'
import { Phone, Mail, Clock, CalendarHeart } from 'lucide-react'
import PageHero from '../components/PageHero'
import Locations from '../components/Locations'
import { business, images } from '../data/content'

export default function Contact() {
  const [dias, horas] = business.hours.split(' · ')
  const items = [
    { icon: Phone, label: 'Llámanos', value: business.phone, href: `tel:${business.tel}` },
    { icon: Mail, label: 'Escríbenos', value: business.email, href: `mailto:${business.email}` },
    { icon: Clock, label: 'Horario', value: business.hours },
  ]

  return (
    <>
      <PageHero
        cara="ʕ•ᴥ•ʔ"
        title={<>Estamos aquí para <span className="highlight">ti y tu mascota</span></>}
        text="Llámanos, escríbenos o agenda una cita en línea."
        cta={{ to: '/reservar', label: 'Reservar cita' }}
        image={images.contacto}
        alt="Perro tricolor mirando al frente sobre un fondo rosado"
        tag={<>{dias} <strong className="shop-hero__tag-corto">{horas}</strong></>}
      />
      <section className="section section--compact">
        <div className="container contact-cards">
          {items.map(({ icon: Icon, label, value, href }) => (
            <div key={label} className="contact-card">
              <span className="reason__icon">
                <Icon size={26} />
              </span>
              <div>
                <small>{label}</small>
                {href ? <a href={href}>{value}</a> : <strong>{value}</strong>}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="section section--compact">
        <div className="container contact-cta">
          <CalendarHeart size={32} />
          <p><strong>¿Quieres agendar?</strong> Reserva en línea y elige el día y la hora que te queden mejor.</p>
          <Link to="/reservar" className="btn btn--primary">Reservar cita</Link>
        </div>
      </section>
      <Locations />
    </>
  )
}
