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
  const { user, isStaff } = useAuth()
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
          {/* En celulares, lo secundario va aquí para que el encabezado solo lleve el logo, el carrito y el menú. */}
          <div className="nav__extra">
            <Link to={user ? '/cuenta/citas' : '/cuenta'} className="nav__link"><User size={20} /> {user ? 'Mi cuenta' : 'Ingresar'}</Link>
            <Link to="/favoritos" className="nav__link"><Heart size={20} /> Favoritos{wishlist.length > 0 && ` (${wishlist.length})`}</Link>
            {isStaff && <NavLink to="/admin" className="nav__link"><ShieldCheck size={20} /> Panel de la clínica</NavLink>}
            <a href={`tel:${business.tel}`} className="nav__link"><Phone size={20} /> {business.phone}</a>
            <Link to="/reservar" className="btn btn--primary btn--block">Reservar cita</Link>
          </div>
        </nav>

        <div className="header__actions">
          {isStaff && (
            <Link to="/admin" className="header__panel" title="Panel de la clínica">
              <ShieldCheck size={18} /> <span>Panel</span>
            </Link>
          )}
          <Link to={user ? '/cuenta/citas' : '/cuenta'} className="header__icon header__icon--escritorio" aria-label={user ? `Mi cuenta (${user.nombre})` : 'Ingresar'} title={user ? 'Mi cuenta' : 'Ingresar'}>
            <User size={20} />
            {user && <span className="header__dot" />}
          </Link>
          <Link to="/favoritos" className="header__icon header__icon--escritorio" aria-label={`Favoritos (${wishlist.length})`} title="Favoritos">
            <Heart size={20} />
            {wishlist.length > 0 && <span className="header__count">{wishlist.length}</span>}
          </Link>
          <button className="header__icon" onClick={openDrawer} aria-label={`Carrito (${totals.count})`} title="Carrito">
            <ShoppingBag size={20} />
            {totals.count > 0 && <span className="header__count">{totals.count}</span>}
          </button>
          <Link to="/reservar" className="btn btn--primary btn--sm header__reservar">
            Reservar
          </Link>
          <button
            className="menu-toggle"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>
    </header>
  )
}
