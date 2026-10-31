import { Link } from 'react-router-dom'
import { MapPin, ArrowRight } from 'lucide-react'
import { PawIcon } from './Brand'
import { images } from '../data/content'
import { useClinica } from '../context/useClinica'

export default function Hero() {
  const { horario, sedes } = useClinica()
  return (
    <section className="hero">
      <PawIcon className="hero__paw hero__paw--1" size={60} />
      <PawIcon className="hero__paw hero__paw--2" size={40} />
      <div className="container hero__inner">
        <div className="hero__content">
          <span className="hero__location">
            <MapPin size={18} /> Veterinaria &amp; cuidado de mascotas
          </span>
          <h1>
            Tu mascota, <span className="highlight">nuestra prioridad</span>
          </h1>
          <p>
            Consultas veterinarias, guardería, paseos y peluquería con un equipo que ama a los animales tanto como tú.
          </p>
          <div className="hero__buttons">
            <Link to="/servicios" className="btn btn--outline">
              Conoce más
            </Link>
            <Link to="/reservar" className="btn btn--primary">
              Reservar cita <ArrowRight size={18} />
            </Link>
          </div>
          <p className="hero__reviews">
            <span>{horario} · {sedes.length || 1} {sedes.length === 1 ? 'sede' : 'sedes'} en la Ciudad de Guatemala</span>
          </p>
        </div>

        <div className="hero__media">
          <div className="hero__blob" />
          <img src={images.hero} alt="Perro pug feliz" className="hero__img" />
          <div className="hero__badge">
            <span className="hero__badge-icon">
              <PawIcon size={22} />
            </span>
            <div>
              <strong>6 servicios</strong>
              <small>consulta, peluquería, guardería y más</small>
            </div>
          </div>
        </div>
      </div>
      <svg className="hero__wave" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 40c240 50 480 50 720 20S1200 0 1440 40v50H0z" />
      </svg>
    </section>
  )
}
