import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { X, Trash2, ShoppingBag, Truck } from 'lucide-react'
import QuantityInput from './QuantityInput'
import { useShop } from '../../context/useShop'
import { formatPrice, FREE_SHIPPING_FROM } from '../../data/shop'

export default function CartDrawer() {
  const { drawerOpen, closeDrawer, lines, totals, setQty, removeFromCart } = useShop()

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e) => e.key === 'Escape' && closeDrawer()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [drawerOpen, closeDrawer])

  const progress = Math.min(100, ((FREE_SHIPPING_FROM - totals.missingForFreeShipping) / FREE_SHIPPING_FROM) * 100)

  return (
    <div className={`drawer ${drawerOpen ? 'drawer--open' : ''}`} aria-hidden={!drawerOpen}>
      <div className="drawer__overlay" onClick={closeDrawer} />
      <aside className="drawer__panel" role="dialog" aria-label="Carrito de compras">
        <header className="drawer__header">
          <h3>Tu carrito ({totals.count})</h3>
          <button onClick={closeDrawer} aria-label="Cerrar carrito">
            <X />
          </button>
        </header>

        {lines.length === 0 ? (
          <div className="drawer__empty">
            <ShoppingBag size={56} />
            <p>Tu carrito está vacío.</p>
            <Link to="/tienda/productos" className="btn btn--primary" onClick={closeDrawer}>
              Ir a la tienda
            </Link>
          </div>
        ) : (
          <>
            <div className="shipping-meter">
              <Truck size={18} />
              <div>
                <p>
                  {totals.missingForFreeShipping > 0 ? (
                    <>Te faltan <strong>{formatPrice(totals.missingForFreeShipping)}</strong> para envío gratis</>
                  ) : (
                    <>¡Tienes <strong>envío gratis</strong>! 🎉</>
                  )}
                </p>
                <span className="shipping-meter__bar">
                  <span style={{ width: `${progress}%` }} />
                </span>
              </div>
            </div>

            <ul className="drawer__lines">
              {lines.map((l) => (
                <li key={l.key}>
                  <img src={l.product.image} alt="" />
                  <div>
                    <Link to={`/tienda/producto/${l.product.slug}`} onClick={closeDrawer}>
                      {l.product.name}
                    </Link>
                    <small>{l.variant.label}</small>
                    <div className="drawer__line-row">
                      <QuantityInput small value={l.qty} min={1} onChange={(q) => setQty(l.key, q)} />
                      <strong>{formatPrice(l.total)}</strong>
                    </div>
                  </div>
                  <button className="remove" onClick={() => removeFromCart(l.key)} aria-label="Eliminar">
                    <Trash2 size={18} />
                  </button>
                </li>
              ))}
            </ul>

            <footer className="drawer__footer">
              <div className="drawer__subtotal">
                <span>Subtotal</span>
                <strong>{formatPrice(totals.subtotal)}</strong>
              </div>
              <Link to="/carrito" className="btn btn--outline btn--block" onClick={closeDrawer}>
                Ver carrito
              </Link>
              <Link to="/checkout" className="btn btn--primary btn--block" onClick={closeDrawer}>
                Finalizar compra
              </Link>
            </footer>
          </>
        )}
      </aside>
    </div>
  )
}
