import { useState } from 'react'
import { CheckCircle2, Dog, Cat, Rabbit } from 'lucide-react'
import SectionTitle from './SectionTitle'
import { services, locations } from '../data/content'
import Field from './Field'

const initial = {
  pet: 'perro',
  service: services[0].title,
  date: '',
  time: '',
  name: '',
  email: '',
  phone: '',
  location: locations[0].title,
  message: '',
}

const petTypes = [
  { value: 'perro', label: 'Perro', icon: Dog },
  { value: 'gato', label: 'Gato', icon: Cat },
  { value: 'otro', label: 'Otro', icon: Rabbit },
]

function validate(v) {
  const e = {}
  if (!v.name.trim()) e.name = 'Ingresa tu nombre'
  if (!/^\S+@\S+\.\S+$/.test(v.email)) e.email = 'Correo no válido'
  if (v.phone.replace(/\D/g, '').length < 7) e.phone = 'Teléfono no válido'
  if (!v.date) e.date = 'Elige una fecha'
  if (!v.time) e.time = 'Elige una hora'
  return e
}

export default function BookingForm() {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState({})
  const [sent, setSent] = useState(false)
  const today = new Date().toISOString().split('T')[0]

  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    const found = validate(values)
    setErrors(found)
    if (Object.keys(found).length) return
    // Proyecto solo frontend: aquí se conectaría con una API o servicio de correo.
    console.info('Reserva enviada', values)
    setSent(true)
  }

  return (
    <section className="section booking" id="reservar">
      <div className="container booking__inner">
        <div className="booking__intro">
          <SectionTitle
            eyebrow="Reserva"
            title="¡Conozcámonos!"
            text="Agenda una consulta o servicio en menos de un minuto. Te confirmaremos por correo o teléfono."
          />
          <div className="promo">
            <strong>¿Primera vez?</strong>
            <p>Tu primer día de guardería es <span>gratis</span> 🐶</p>
          </div>
        </div>

        <div className="booking__card">
          {sent ? (
            <div className="booking__success">
              <CheckCircle2 size={64} />
              <h3>¡Solicitud enviada!</h3>
              <p>
                Gracias, {values.name.split(' ')[0]}. Te contactaremos pronto para confirmar tu cita del{' '}
                {values.date} a las {values.time}.
              </p>
              <button
                className="btn btn--dark"
                onClick={() => {
                  setValues(initial)
                  setSent(false)
                }}
              >
                Nueva reserva
              </button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <fieldset className="pet-picker">
                <legend>Tu mascota es:</legend>
                {petTypes.map(({ value, label, icon: Icon }) => (
                  <label key={value} className={values.pet === value ? 'active' : ''}>
                    <input type="radio" name="pet" value={value} checked={values.pet === value} onChange={set('pet')} />
                    <Icon size={22} /> {label}
                  </label>
                ))}
              </fieldset>

              <div className="form-grid">
                <Field label="Servicio">
                  <select value={values.service} onChange={set('service')}>
                    {services.map((s) => (
                      <option key={s.slug}>{s.title}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Sede">
                  <select value={values.location} onChange={set('location')}>
                    {locations.map((l) => (
                      <option key={l.title}>{l.title}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Fecha" error={errors.date}>
                  <input type="date" min={today} value={values.date} onChange={set('date')} />
                </Field>
                <Field label="Hora" error={errors.time}>
                  <input type="time" min="08:00" max="20:00" value={values.time} onChange={set('time')} />
                </Field>
                <Field label="Nombre" error={errors.name} full>
                  <input type="text" placeholder="Tu nombre completo" value={values.name} onChange={set('name')} />
                </Field>
                <Field label="Correo" error={errors.email}>
                  <input type="email" placeholder="tu@correo.com" value={values.email} onChange={set('email')} />
                </Field>
                <Field label="Teléfono" error={errors.phone}>
                  <input type="tel" placeholder="+1 555 123 4567" value={values.phone} onChange={set('phone')} />
                </Field>
                <Field label="Mensaje" full>
                  <textarea
                    rows="3"
                    placeholder="Cuéntanos sobre tu mascota (opcional)"
                    value={values.message}
                    onChange={set('message')}
                  />
                </Field>
              </div>
              <button type="submit" className="btn btn--primary btn--block">
                Enviar solicitud
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
