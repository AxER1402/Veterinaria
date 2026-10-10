import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Menu, X, Phone, Heart, ShoppingBag, User, ShieldCheck } from 'lucide-react'
import { Logo } from './Brand'
import { business, navLinks } from '../data/content'
import { useShop } from '../context/useShop'
import { useAuth } from '../context/useAuth'

export default function Header() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { totals, wishlist, openDrawer } = useShop()
  const { user, isAdmin } = useAuth()
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
  }, [open])

  return (
    <header className={`header ${scrolled ? 'header--scrolled' : ''}`}>
      <div className="container header__inner">
        <Link to="/" aria-label="Inicio">
          <Logo />
        </Link>

        <nav className={`nav ${open ? 'nav--open' : ''}`} aria-label="Principal" onClick={() => setOpen(false)}>
          {navLinks.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.to === '/'} className="nav__link">
              {link.label}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink to="/admin" className="nav__link nav__admin-mobile">
              Panel de administración
            </NavLink>
          )}
          <Link to="/contacto#reservar" className="btn btn--primary nav__cta-mobile">
            Reservar cita
          </Link>
        </nav>

        <div className="header__actions">
          <a href={`tel:${business.phone}`} className="header__phone">
            <Phone size={18} /> {business.phone}
          </a>
          {isAdmin && (
            <Link to="/admin" className="header__icon header__icon--admin" aria-label="Panel de administración">
              <ShieldCheck size={22} />
            </Link>
          )}
          <Link to={user ? '/cuenta/pedidos' : '/cuenta'} className="header__icon" aria-label={user ? `Mi cuenta (${user.nombre})` : 'Ingresar'}>
            <User size={22} />
            {user && <span className="header__dot" />}
          </Link>
          <Link to="/favoritos" className="header__icon" aria-label={`Favoritos (${wishlist.length})`}>
            <Heart size={22} />
            {wishlist.length > 0 && <span className="header__count">{wishlist.length}</span>}
          </Link>
          <button className="header__icon" onClick={openDrawer} aria-label={`Carrito (${totals.count})`}>
            <ShoppingBag size={22} />
            {totals.count > 0 && <span className="header__count">{totals.count}</span>}
          </button>
          <Link to="/contacto#reservar" className="btn btn--primary btn--sm">
            Reservar
          </Link>
          <button
            className="menu-toggle"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={26} /> : <Menu size={26} />}
          </button>
        </div>
      </div>
    </header>
  )
}
