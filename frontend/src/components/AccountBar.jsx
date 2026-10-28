import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

// Barra de «Mi cuenta»: correo, secciones y cerrar sesión.
export default function AccountBar() {
  const { user, logout } = useAuth()
  return (
    <div className="account__bar">
      <span>{user.email}</span>
      <span className="account__links">
        <NavLink to="/cuenta/citas">Citas</NavLink>
        <NavLink to="/cuenta/mascotas">Mascotas</NavLink>
        <NavLink to="/cuenta/pedidos" end>Pedidos</NavLink>
        <NavLink to="/cuenta/seguridad">Seguridad {user.mfa ? '· 2 pasos activa' : '· activar 2 pasos'}</NavLink>
        <button className="btn btn--dark btn--sm" onClick={logout}>Cerrar sesión</button>
      </span>
    </div>
  )
}
