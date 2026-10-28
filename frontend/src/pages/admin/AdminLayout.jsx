import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Package, Tags, ShieldCheck, Users, CalendarDays, PawPrint } from 'lucide-react'
import Loading from '../../components/Loading'
import { useAuth } from '../../context/useAuth'
import { api } from '../../api'

// Primero el día a día de la clínica; la tienda después y la bitácora al final. Cada rol ve sus
// secciones; esto solo ordena el menú: el servidor vuelve a revisar el rol en cada acción.
const CLINICA = ['admin', 'veterinario', 'recepcion']
const tabs = [
  { to: '/admin', label: 'Hoy', icon: LayoutDashboard, end: true },
  { to: '/admin/agenda', label: 'Agenda', icon: CalendarDays, roles: CLINICA },
  { to: '/admin/pacientes', label: 'Pacientes', icon: PawPrint, roles: ['admin', 'veterinario'] },
  { to: '/admin/clientes', label: 'Clientes', icon: Users },
  { to: '/admin/pedidos', label: 'Pedidos', icon: Package, roles: ['admin', 'tienda'] },
  { to: '/admin/catalogo', label: 'Catálogo', icon: Tags, roles: ['admin', 'tienda'] },
  { to: '/admin/bitacora', label: 'Bitácora', icon: ShieldCheck, roles: ['admin'] },
]
export const ROLES = { admin: 'Administración', veterinario: 'Veterinario', recepcion: 'Recepción', tienda: 'Tienda', cliente: 'Cliente' }

export default function AdminLayout() {
  const { user, checking, isStaff } = useAuth()
  const [allowed, setAllowed] = useState(null)

  // El servidor decide: registra ACCESO_ADMIN_PANEL (éxito o intento fallido) y responde 200/403.
  useEffect(() => {
    if (!user) return
    api('/api/auth/admin/acceso', { method: 'POST' })
      .then(() => setAllowed(true))
      .catch(() => setAllowed(false))
  }, [user])

  if (checking) return <Loading />
  if (!user) return <Navigate to="/cuenta" state={{ from: '/admin' }} replace />
  if (allowed === false || (allowed === null && !isStaff)) {
    return allowed === null ? <Loading /> : (
      <section className="section"><div className="container empty-state"><ShieldCheck size={56} /><h3>No tienes acceso al panel</h3></div></section>
    )
  }
  if (!allowed) return <Loading text="Verificando acceso…" />

  return (
    <section className="admin">
      <div className="container">
        <header className="admin__head">
          <h1>Panel de la clínica</h1>
          <span>{user.email} · {ROLES[user.rol] || user.rol}</span>
        </header>
        {!user.mfa && user.rol === 'admin' && (
          <p className="form-alert admin__mfa">
            Tu cuenta de administrador no tiene verificación en dos pasos. <Link to="/cuenta/seguridad">Actívala ahora</Link>: si te roban la contraseña, sin el código del teléfono no podrán entrar.
          </p>
        )}
        <nav className="admin__tabs" aria-label="Secciones del panel">
          {tabs.filter((t) => !t.roles || t.roles.includes(user.rol)).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
    </section>
  )
}
