import { Link } from 'react-router-dom'
import { Mail, Phone, Clock } from 'lucide-react'
import { Logo, InstagramIcon, FacebookIcon } from './Brand'
import { business, navLinks, services, locations } from '../data/content'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div className="footer__brand">
            <Logo light />
            <p>Veterinaria profesional, guardería, paseos y cuidado integral para tu mejor amigo.</p>
            <div className="footer__social">
              <a href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="Instagram">
                <InstagramIcon />
              </a>
              <a href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook">
                <FacebookIcon />
              </a>
            </div>
          </div>

          <div>
            <h4>Servicios</h4>
            <ul>
              {services.map((s) => (
                <li key={s.slug}>
                  <Link to={`/servicios#${s.slug}`}>{s.title}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4>Tienda</h4>
            <ul>
              <li><Link to="/tienda">Inicio de tienda</Link></li>
              <li><Link to="/tienda/productos?mascota=perro">Perros</Link></li>
              <li><Link to="/tienda/productos?mascota=gato">Gatos</Link></li>
              <li><Link to="/tienda/productos?oferta=1">Ofertas</Link></li>
              <li><Link to="/carrito">Carrito</Link></li>
            </ul>
          </div>

          <div>
            <h4>Empresa</h4>
            <ul>
              {navLinks.map((l) => (
                <li key={l.to}>
                  <Link to={l.to}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4>Contacto</h4>
            <ul className="footer__contact">
              <li><Phone size={16} /> <a href={`tel:${business.tel}`}>{business.phone}</a></li>
              <li><Mail size={16} /> <a href={`mailto:${business.email}`}>{business.email}</a></li>
              <li><Clock size={16} /> {business.hours}</li>
              <li className="footer__address">{locations[0].address}</li>
            </ul>
          </div>

          <div className="footer__newsletter">
            <h4>Reserva en línea</h4>
            <p>Elige el servicio, el día y la hora. Te confirmamos por correo.</p>
            <Link to="/reservar" className="btn btn--primary btn--sm">Reservar cita</Link>
          </div>
        </div>

        <div className="footer__bottom">
          <span>© {new Date().getFullYear()} {business.name}. Todos los derechos reservados.</span>
          <div>
            <a href="#">Privacidad</a>
            <a href="#">Términos</a>
            <Link to="/contacto">Contacto</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
