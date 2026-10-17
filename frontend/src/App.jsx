import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'
import { ShopProvider } from './context/ShopContext'
import { AuthProvider } from './context/AuthContext'
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
import Appointments from './pages/account/Appointments'
import Pets from './pages/account/Pets'
import AdminLayout from './pages/admin/AdminLayout'
import AdminPedidos from './pages/admin/AdminPedidos'
import AdminCatalogo from './pages/admin/AdminCatalogo'
import AdminBitacora from './pages/admin/AdminBitacora'
import AdminClientes from './pages/admin/AdminClientes'
import AdminAgenda from './pages/admin/AdminAgenda'
import Loading from './components/Loading'

// El resumen trae Chart.js: se descarga solo al abrir el panel, no en la tienda.
const AdminResumen = lazy(() => import('./pages/admin/AdminResumen'))

// En el flujo de compra el banner de reservas distrae, así que se oculta.
const NO_CTA = ['/carrito', '/checkout', '/cuenta', '/admin']

function Layout() {
  const { pathname } = useLocation()
  return (
    <>
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
      <ShopProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="servicios" element={<Services />} />
              <Route path="nosotros" element={<About />} />
              <Route path="preguntas" element={<FaqPage />} />
              <Route path="contacto" element={<Contact />} />
              <Route path="tienda" element={<ShopHome />} />
              <Route path="tienda/productos" element={<Catalog />} />
              <Route path="tienda/producto/:slug" element={<ProductDetail />} />
              <Route path="carrito" element={<Cart />} />
              <Route path="checkout" element={<Checkout />} />
              <Route path="favoritos" element={<Wishlist />} />
              <Route path="cuenta" element={<Account />} />
              <Route path="cuenta/pedidos" element={<Orders />} />
              <Route path="cuenta/pedidos/:id" element={<OrderDetail />} />
              <Route path="cuenta/seguridad" element={<Security />} />
              <Route path="cuenta/citas" element={<Appointments />} />
              <Route path="cuenta/mascotas" element={<Pets />} />
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<Suspense fallback={<Loading />}><AdminResumen /></Suspense>} />
                <Route path="agenda" element={<AdminAgenda />} />
                <Route path="pedidos" element={<AdminPedidos />} />
                <Route path="catalogo" element={<AdminCatalogo />} />
                <Route path="bitacora" element={<AdminBitacora />} />
                <Route path="clientes" element={<AdminClientes />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ShopProvider>
    </AuthProvider>
  )
}
