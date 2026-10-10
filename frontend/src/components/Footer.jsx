import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Phone, Clock, Send } from 'lucide-react'
import { Logo, InstagramIcon, FacebookIcon } from './Brand'
import { business, navLinks, services, locations } from '../data/content'

export default function Footer() {
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)

  const subscribe = (e) => {
    e.preventDefault()
    if (!email) return
    setSubscribed(true)
    setEmail('')
  }

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
              <li><Phone size={16} /> <a href={`tel:${business.phone}`}>{business.phone}</a></li>
              <li><Mail size={16} /> <a href={`mailto:${business.email}`}>{business.email}</a></li>
              <li><Clock size={16} /> {business.hours}</li>
              <li className="footer__address">{locations[0].address}</li>
            </ul>
          </div>

          <div className="footer__newsletter">
            <h4>Newsletter</h4>
            <p>Suscríbete y obtén <strong>20% de descuento</strong> en tu primera visita.</p>
            {subscribed ? (
              <p className="footer__thanks">¡Gracias por suscribirte! 🐾</p>
            ) : (
              <form onSubmit={subscribe} className="newsletter">
                <input
                  type="email"
                  required
                  placeholder="Tu correo"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-label="Correo electrónico"
                />
                <button type="submit" aria-label="Suscribirme">
                  <Send size={18} />
                </button>
              </form>
            )}
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
