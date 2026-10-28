import PageHeader from '../components/PageHeader'
import BookingForm from '../components/BookingForm'

// La reserva en su propia página (antes vivía dentro de «Contacto»).
export default function Reservar() {
  return (
    <>
      <PageHeader title="Reservar cita" text="Consulta, peluquería, guardería, hospedaje, paseos o entrenamiento: elige el día y la hora." />
      <BookingForm />
    </>
  )
}
