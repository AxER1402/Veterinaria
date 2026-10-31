import { Suspense, useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { CalendarDays, ExternalLink, LayoutDashboard, LogOut, Menu, Package, PawPrint, ShieldCheck, Tags, UserRound, Users, X } from 'lucide-react'
import { Logo } from '../../components/Brand'
import Loading from '../../components/Loading'
import { useAuth } from '../../context/useAuth'
import { api } from '../../api'
import { ROLES } from './roles'

// Primero el día a día de la clínica; la tienda después y la bitácora al final. Cada rol ve sus
// secciones; esto solo ordena el menú: el servidor vuelve a revisar el rol en cada acción.
const CLINICA = ['admin', 'veterinario', 'recepcion']
const secciones = [
  { to: '/admin', label: 'Hoy', icon: LayoutDashboard, end: true, ayuda: 'Lo que necesita atención hoy.' },
  { grupo: 'Clínica', to: '/admin/agenda', label: 'Agenda', icon: CalendarDays, roles: CLINICA, ayuda: 'Las citas de cada día, los bloqueos de turnos y el equipo.' },
  { grupo: 'Clínica', to: '/admin/pacientes', label: 'Pacientes', icon: PawPrint, roles: ['admin', 'veterinario'], ayuda: 'Busca una mascota para ver su historial y sus vacunas.' },
  { grupo: 'Clínica', to: '/admin/clientes', label: 'Clientes', icon: Users, ayuda: 'Datos de contacto de los clientes y sus mascotas.' },
  { grupo: 'Tienda', to: '/admin/pedidos', label: 'Pedidos', icon: Package, roles: ['admin', 'tienda'], ayuda: 'Prepara los pedidos, cambia su estado y revisa las ventas.' },
  { grupo: 'Tienda', to: '/admin/catalogo', label: 'Catálogo', icon: Tags, roles: ['admin', 'tienda'], ayuda: 'Productos, precios, existencias y reseñas.' },
  { grupo: 'Seguridad', to: '/admin/bitacora', label: 'Bitácora', icon: ShieldCheck, roles: ['admin'], ayuda: 'Quién hizo qué y cuándo. No se puede modificar.' },
]

function PantallaSimple({ children }) {
  return <main className="panel__simple"><div className="admin-card empty-state">{children}</div></main>
}

export default function AdminLayout() {
  const { user, checking, isStaff, logout } = useAuth()
  const [allowed, setAllowed] = useState(null)
  const [menu, setMenu] = useState(false)
  const { pathname } = useLocation()
  // Sección abierta por un enlace o un marcador de otro rol: se avisa en vez de mostrar la pantalla a medias
  // (el servidor igual respondería 403 a cada dato).
  const seccion = secciones.find((t) => !t.end && (pathname === t.to || pathname.startsWith(t.to + '/')))
  const actual = seccion ?? secciones[0]
  const fueraDeRol = seccion?.roles && user && !seccion.roles.includes(user.rol)
  const esPortada = pathname === '/admin' || pathname === '/admin/'
  const esDetalle = seccion && pathname !== seccion.to

  // El servidor decide: registra ACCESO_ADMIN_PANEL (éxito o intento fallido) y responde 200/403.
  useEffect(() => {
    if (!user) return
    api('/api/auth/admin/acceso', { method: 'POST' })
      .then(() => setAllowed(true))
      .catch(() => setAllowed(false))
  }, [user])

  useEffect(() => {
    if (!menu) return
    const tecla = (e) => e.key === 'Escape' && setMenu(false)
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [menu])

  if (checking) return <Loading />
  if (!user) return <Navigate to="/cuenta" state={{ from: '/admin' }} replace />
  if (allowed === false || (allowed === null && !isStaff)) {
    return allowed === null ? <Loading /> : (
      <PantallaSimple>
        <ShieldCheck size={56} />
        <h3>No tienes acceso al panel</h3>
        <Link to="/" className="btn btn--primary btn--sm">Ir al sitio</Link>
      </PantallaSimple>
    )
  }
  if (!allowed) return <Loading text="Verificando acceso…" />

  const visibles = secciones.filter((t) => !t.roles || t.roles.includes(user.rol))
  const grupos = [...new Set(visibles.map((t) => t.grupo))]

  return (
    <div className="panel">
      <aside className={`panel__lado ${menu ? 'is-abierto' : ''}`} onClick={(e) => e.target.closest('a') && setMenu(false)}>
        <div className="panel__marca">
          <Link to="/admin" aria-label="Panel de la clínica"><Logo light /></Link>
          <button type="button" className="panel__cerrar" onClick={() => setMenu(false)} aria-label="Cerrar menú"><X size={22} /></button>
        </div>
        <nav className="panel__nav" aria-label="Secciones del panel">
          {grupos.map((g) => (
            <div key={g ?? 'inicio'} className="panel__grupo">
              {g && <p>{g}</p>}
              {visibles.filter((t) => t.grupo === g).map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end}><Icon size={18} aria-hidden="true" /> {label}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="panel__pie">
          <p className="panel__quien"><strong>{ROLES[user.rol] || user.rol}</strong><span>{user.email}</span></p>
          <Link to="/"><ExternalLink size={16} aria-hidden="true" /> Ver el sitio</Link>
          <Link to="/cuenta/perfil"><UserRound size={16} aria-hidden="true" /> Mi cuenta</Link>
          <button type="button" onClick={logout}><LogOut size={16} aria-hidden="true" /> Cerrar sesión</button>
        </div>
      </aside>
      {menu && <button type="button" className="panel__velo" onClick={() => setMenu(false)} aria-label="Cerrar menú" />}

      <div className="panel__cuerpo">
        <div className="panel__barra">
          <button type="button" onClick={() => setMenu(true)} aria-label="Abrir menú" aria-expanded={menu}><Menu size={24} /></button>
          <strong>{actual.label}</strong>
        </div>
        <main className="panel__contenido">
          {!esDetalle && (
            <header className="panel__titulo">
              <h1>{actual.label}</h1>
              {!fueraDeRol && <p className="admin__ayuda">{actual.ayuda}</p>}
            </header>
          )}
          {esPortada && !user.mfa && user.rol === 'admin' && (
            <p className="panel__aviso">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Protege tu cuenta de administrador: <Link to="/cuenta/seguridad">activa la verificación en dos pasos</Link>.</span>
            </p>
          )}
          {fueraDeRol ? (
            <div className="admin-card empty-state">
              <ShieldCheck size={48} />
              <h3>{seccion.label} no es parte de tu rol</h3>
              <p>Tu cuenta es de {ROLES[user.rol] || user.rol}. Si necesitas esta sección, pídele al administrador que revise tu rol.</p>
              <Link to="/admin" className="btn btn--primary btn--sm">Ir a Hoy</Link>
            </div>
          ) : <Suspense fallback={<Loading />}><Outlet /></Suspense>}
        </main>
      </div>
    </div>
  )
}
