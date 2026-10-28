import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2, ShoppingBag, Tag, X } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import QuantityInput from '../../components/shop/QuantityInput'
import { useShop } from '../../context/useShop'
import { formatPrice } from '../../data/shop'
import { api } from '../../api'
import Loading from '../../components/Loading'

export default function Cart() {
  const { lines, totals, setQty, removeFromCart, catalogLoading } = useShop()

  return (
    <>
      <PageHeader title="Carrito" />
      <section className="section">
        <div className="container">
          {catalogLoading ? (
            <Loading />
          ) : lines.length === 0 ? (
            <div className="empty-state">
              <ShoppingBag size={56} />
              <h3>Tu carrito está vacío</h3>
              <p>Descubre lo que tenemos para tu mascota.</p>
              <Link to="/tienda/productos" className="btn btn--primary">
                Ir a la tienda
              </Link>
            </div>
          ) : (
            <div className="cart-layout">
              <div className="cart-table">
                <div className="cart-table__head">
                  <span>Producto</span>
                  <span>Precio</span>
                  <span>Cantidad</span>
                  <span>Total</span>
                </div>
                {lines.map((l) => (
                  <div className="cart-row" key={l.key}>
                    <div className="cart-row__product">
                      <img src={l.product.image} alt="" />
                      <div>
                        <Link to={`/tienda/producto/${l.product.slug}`}>{l.product.name}</Link>
                        <small>{l.variant.label}</small>
                      </div>
                    </div>
                    <span className="cart-row__price" data-label="Precio">{formatPrice(l.variant.price)}</span>
                    <QuantityInput value={l.qty} onChange={(q) => setQty(l.key, q)} />
                    <strong className="cart-row__total">{formatPrice(l.total)}</strong>
                    <button className="remove" onClick={() => removeFromCart(l.key)} aria-label={`Eliminar ${l.product.name}`}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
                <Link to="/tienda/productos" className="link-arrow">
                  ← Seguir comprando
                </Link>
              </div>

              <OrderSummary totals={totals}>
                <Link to="/checkout" className="btn btn--primary btn--block">
                  Finalizar compra
                </Link>
              </OrderSummary>
            </div>
          )}
        </div>
      </section>
    </>
  )
}

export function OrderSummary({ totals, lines, children }) {
  const { coupon, applyCoupon } = useShop()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  // El cupón lo valida pedidos-service; el descuento real también se recalcula allí al comprar.
  const submit = async (e) => {
    e.preventDefault()
    const normalized = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{3,30}$/.test(normalized)) return setError('Cupón no válido')
    setChecking(true)
    try {
      const d = await api(`/api/pedidos/cupones/${normalized}`, { auth: false })
      applyCoupon(d.cupon)
      setCode('')
      setError('')
    } catch (err) {
      setError(err.status === 404 ? 'Cupón no válido' : err.message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <aside className="summary">
      <h3>Resumen del pedido</h3>
      {lines && (
        <ul className="summary__lines">
          {lines.map((l) => (
            <li key={l.key}>
              <span className="summary__thumb">
                <img src={l.product.image} alt="" />
                <em>{l.qty}</em>
              </span>
              <span>
                {l.product.name}
                <small>{l.variant.label}</small>
              </span>
              <strong>{formatPrice(l.total)}</strong>
            </li>
          ))}
        </ul>
      )}

      {coupon ? (
        <div className="coupon-applied">
          <Tag size={16} /> <span><strong>{coupon.codigo}</strong> · {coupon.descripcion}</span>
          <button onClick={() => applyCoupon(null)} aria-label="Quitar cupón">
            <X size={16} />
          </button>
        </div>
      ) : (
        <form className="coupon-form" onSubmit={submit}>
          <input
            placeholder="Código de descuento"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Código de descuento"
          />
          <button type="submit" className="btn btn--dark btn--sm" disabled={checking}>
            {checking ? '…' : 'Aplicar'}
          </button>
          {error && <small>{error}</small>}
        </form>
      )}

      <dl>
        <div>
          <dt>Subtotal</dt>
          <dd>{formatPrice(totals.subtotal)}</dd>
        </div>
        {totals.discount > 0 && (
          <div className="summary__discount">
            <dt>Descuento</dt>
            <dd>−{formatPrice(totals.discount)}</dd>
          </div>
        )}
        <div>
          <dt>Envío</dt>
          <dd>{totals.shipping ? formatPrice(totals.shipping) : 'Gratis'}</dd>
        </div>
        <div className="summary__total">
          <dt>Total</dt>
          <dd>{formatPrice(totals.total)}</dd>
        </div>
      </dl>
      {totals.missingForFreeShipping > 0 && (
        <p className="summary__hint">Agrega {formatPrice(totals.missingForFreeShipping)} más para envío gratis.</p>
      )}
      {children}
    </aside>
  )
}
