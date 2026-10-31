import PageHero from '../components/PageHero'
import BookingForm from '../components/BookingForm'
import { images } from '../data/content'

// La reserva en su propia página (antes vivía dentro de «Contacto»).
export default function Reservar() {
  return (
    <>
      <PageHero
        compacto
        cara="U・ᴥ・U"
        title={<>Reserva tu cita en <span className="highlight">pocos pasos</span></>}
        text="Elige el servicio, el día y la hora. Se paga en la sede y te avisamos por correo."
        image={images.reservar}
        alt="Perro de orejas caídas con una flor en el hocico"
      />
      <BookingForm />
    </>
  )
}
