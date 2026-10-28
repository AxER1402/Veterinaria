import { Phone, Mail, Clock } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import BookingForm from '../components/BookingForm'
import Locations from '../components/Locations'
import { business } from '../data/content'

export default function Contact() {
  const items = [
    { icon: Phone, label: 'Llámanos', value: business.phone, href: `tel:${business.tel}` },
    { icon: Mail, label: 'Escríbenos', value: business.email, href: `mailto:${business.email}` },
    { icon: Clock, label: 'Horario', value: business.hours },
  ]

  return (
    <>
      <PageHeader title="Contacto" text="Estamos aquí para ti y tu mascota. ¡Escríbenos o agenda una cita!" />
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
      <BookingForm />
      <Locations />
    </>
  )
}
