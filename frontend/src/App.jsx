import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'
import { ShopProvider } from './context/ShopContext'
import { AuthProvider } from './context/AuthContext'
import { ClinicaProvider } from './context/ClinicaContext'
import Header from './components/Header'
import Footer from './components/Footer'
import CtaBanner from './components/CtaBanner'
import ScrollManager from './components/ScrollManager'
import CartDrawer from './components/shop/CartDrawer'
import Home from './pages/Home'
import Services from './pages/Services'
import About from './pages/About'
import FaqPage from './pages/FaqPage'
import Contact from './pages/Contact'
import Reservar from './pages/Reservar'
import Privacidad from './pages/Privacidad'
import Terminos from './pages/Terminos'
import NotFound from './pages/NotFound'
import ShopHome from './pages/shop/ShopHome'
import Catalog from './pages/shop/Catalog'
import ProductDetail from './pages/shop/ProductDetail'
import Cart from './pages/shop/Cart'
import Checkout from './pages/shop/Checkout'
import Wishlist from './pages/shop/Wishlist'
import Account from './pages/account/Account'
import Orders from './pages/account/Orders'
import OrderDetail from './pages/account/OrderDetail'
import Security from './pages/account/Security'
import Perfil from './pages/account/Perfil'
import Appointments from './pages/account/Appointments'
import Pets from './pages/account/Pets'
import Loading from './components/Loading'
import CambiarPassword from './components/CambiarPassword'
import { useAuth } from './context/useAuth'

// El panel se descarga solo al abrirlo: quien visita la tienda o reserva no baja su código (ni Chart.js,
// que trae el resumen). AdminLayout pone su propio Suspense alrededor de cada sección.
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const AdminResumen = lazy(() => import('./pages/admin/AdminResumen'))
const AdminAgenda = lazy(() => import('./pages/admin/AdminAgenda'))
const AdminPacientes = lazy(() => import('./pages/admin/AdminPacientes'))
const AdminPaciente = lazy(() => import('./pages/admin/AdminPaciente'))
const AdminPedidos = lazy(() => import('./pages/admin/AdminPedidos'))
const AdminPedido = lazy(() => import('./pages/admin/AdminPedido'))
const AdminCatalogo = lazy(() => import('./pages/admin/AdminCatalogo'))
const AdminBitacora = lazy(() => import('./pages/admin/AdminBitacora'))
const AdminClientes = lazy(() => import('./pages/admin/AdminClientes'))
const AdminCliente = lazy(() => import('./pages/admin/AdminCliente'))
const AdminCaja = lazy(() => import('./pages/admin/AdminCaja'))
const AdminSedes = lazy(() => import('./pages/admin/AdminSedes'))

// En el flujo de compra el banner de reservas distrae, así que se oculta.
const NO_CTA = ['/carrito', '/checkout', '/cuenta']

function LayoutPanel() {
  const { user } = useAuth()
  return (
    <>
      {user?.cambiar_password && <CambiarPassword obligatorio />}
      <ScrollManager />
      <Outlet />
    </>
  )
}

function Layout() {
  const { pathname } = useLocation()
  const { user } = useAuth()
  return (
    <>
      {/* Cuenta creada por el personal: hasta cambiar la contraseña temporal no se usa nada más. */}
      {user?.cambiar_password && <CambiarPassword obligatorio />}
      <ScrollManager />
      <Header />
      <main>
        <Outlet />
      </main>
      {!NO_CTA.some((p) => pathname.startsWith(p)) && <CtaBanner />}
      <Footer />
      <CartDrawer />
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ClinicaProvider>
      <ShopProvider>
        <BrowserRouter>
          <Routes>
            {/* El panel es una aplicación aparte: sin el menú ni el pie del sitio público. */}
            <Route element={<LayoutPanel />}>
    <Route path="admin" element={<Suspense fallback={<Loading />}><AdminLayout /></Suspense>}>
                <Route index element={<AdminResumen />} />
                <Route path="agenda" element={<AdminAgenda />} />
                <Route path="pacientes" element={<AdminPacientes />} />
                <Route path="pacientes/:id" element={<AdminPaciente />} />
                <Route path="pedidos" element={<AdminPedidos />} />
                <Route path="pedidos/:id" element={<AdminPedido />} />
                <Route path="catalogo" element={<AdminCatalogo />} />
                <Route path="bitacora" element={<AdminBitacora />} />
                <Route path="clientes" element={<AdminClientes />} />
                <Route path="clientes/:id" element={<AdminCliente />} />
                <Route path="caja" element={<AdminCaja />} />
                <Route path="sedes" element={<AdminSedes />} />
              </Route>
            </Route>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="servicios" element={<Services />} />
              <Route path="nosotros" element={<About />} />
              <Route path="preguntas" element={<FaqPage />} />
              <Route path="contacto" element={<Contact />} />
              <Route path="reservar" element={<Reservar />} />
              <Route path="privacidad" element={<Privacidad />} />
              <Route path="terminos" element={<Terminos />} />
              <Route path="tienda" element={<ShopHome />} />
              <Route path="tienda/productos" element={<Catalog />} />
              <Route path="tienda/producto/:slug" element={<ProductDetail />} />
              <Route path="carrito" element={<Cart />} />
              <Route path="checkout" element={<Checkout />} />
              <Route path="favoritos" element={<Wishlist />} />
              <Route path="cuenta" element={<Account />} />
              <Route path="cuenta/pedidos" element={<Orders />} />
              <Route path="cuenta/pedidos/:id" element={<OrderDetail />} />
              <Route path="cuenta/perfil" element={<Perfil />} />
              <Route path="cuenta/seguridad" element={<Security />} />
              <Route path="cuenta/citas" element={<Appointments />} />
              <Route path="cuenta/mascotas" element={<Pets />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ShopProvider>
      </ClinicaProvider>
    </AuthProvider>
  )
}
