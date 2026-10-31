import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { CalendarHeart, LogOut, Package, PawPrint, ShieldCheck, UserRound } from 'lucide-react'
import Avatar from './Avatar'
import { useAuth } from '../context/useAuth'
import { api } from '../api'

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

// Mi cuenta: saludo y, como menú, una tarjeta por sección con su dato principal.
export default function CuentaMarco({ titulo, texto, acciones, children }) {
  const { user, isStaff, logout } = useAuth()
  const [conteo, setConteo] = useState({})
  // El rol Tienda no tiene acceso a citas ni mascotas (ver Guard::CLINICA en el servidor).
  const conClinica = user.rol !== 'tienda'

  // Solo adornan las tarjetas: si una consulta falla, la tarjeta queda sin el dato.
  useEffect(() => {
    const ahora = new Date()
    if (conClinica) {
      api('/api/citas').then((d) => setConteo((c) => ({ ...c, citas: d.citas.filter((x) => ['pendiente', 'confirmada'].includes(x.estado) && new Date(x.fin || x.inicio) > ahora).length }))).catch(() => {})
      api('/api/citas/mascotas').then((d) => setConteo((c) => ({ ...c, mascotas: d.mascotas.length }))).catch(() => {})
    }
    api('/api/pedidos').then((d) => setConteo((c) => ({ ...c, pedidos: d.pedidos.length }))).catch(() => {})
  }, [conClinica])

  const secciones = [
    ...(conClinica ? [
      { to: '/cuenta/citas', label: 'Citas', icon: CalendarHeart, dato: conteo.citas === undefined ? '' : conteo.citas ? plural(conteo.citas, 'próxima', 'próximas') : 'Sin próximas' },
      { to: '/cuenta/mascotas', label: 'Mascotas', icon: PawPrint, dato: conteo.mascotas === undefined ? '' : conteo.mascotas ? plural(conteo.mascotas, 'registrada', 'registradas') : 'Agrega la primera' },
    ] : []),
    { to: '/cuenta/pedidos', label: 'Pedidos', icon: Package, dato: conteo.pedidos === undefined ? '' : conteo.pedidos ? plural(conteo.pedidos, 'pedido', 'pedidos') : 'Sin pedidos' },
    { to: '/cuenta/perfil', label: 'Mi perfil', icon: UserRound, dato: 'Nombre y teléfono' },
    { to: '/cuenta/seguridad', label: 'Seguridad', icon: ShieldCheck, dato: user.google ? 'Con Google' : user.mfa ? 'Dos pasos activa' : 'Activa los dos pasos', aviso: !user.google && !user.mfa },
  ]

  return (
    <div className="micuenta">
      <div className="micuenta__hero">
        <div className="container micuenta__saludo">
          <Avatar nombre={user.nombre} grande />
          <div className="micuenta__quien">
            <p className="micuenta__hola">Hola, {user.nombre.split(' ')[0]}</p>
            <span>{user.email}</span>
          </div>
          <div className="micuenta__salir">
            {isStaff && <Link to="/admin" className="btn btn--dark btn--xs"><ShieldCheck size={14} aria-hidden="true" /> Panel</Link>}
            <button type="button" className="micuenta__cerrar" onClick={logout}><LogOut size={16} aria-hidden="true" /> Cerrar sesión</button>
          </div>
        </div>
      </div>
      <div className="container">
        <nav className="micuenta__nav" aria-label="Mi cuenta">
          {secciones.map(({ to, label, icon: Icon, dato, aviso }) => (
            <NavLink key={to} to={to} className={aviso ? 'tiene-aviso' : ''}>
              <span className="micuenta__icono"><Icon size={20} aria-hidden="true" /></span>
              <span className="micuenta__texto"><strong>{label}</strong><small>{dato || '\u00a0'}</small></span>
            </NavLink>
          ))}
        </nav>
        <main className="micuenta__contenido">
          <header className="micuenta__titulo">
            <div>
              <h1>{titulo}</h1>
              {texto && <p>{texto}</p>}
            </div>
            {acciones}
          </header>
          {children}
        </main>
      </div>
    </div>
  )
}
