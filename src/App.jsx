import { BrowserRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'
import { ShopProvider } from './context/ShopContext'
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

// En el flujo de compra el banner de reservas distrae, así que se oculta.
const NO_CTA = ['/carrito', '/checkout']

function Layout() {
  const { pathname } = useLocation()
  return (
    <>
      <ScrollManager />
      <Header />
      <main>
        <Outlet />
      </main>
      {!NO_CTA.includes(pathname) && <CtaBanner />}
      <Footer />
      <CartDrawer />
    </>
  )
}

export default function App() {
  return (
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
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ShopProvider>
  )
}
