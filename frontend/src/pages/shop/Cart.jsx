import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Trash2, ShoppingBag, Tag, X } from 'lucide-react'
import PageHero from '../../components/PageHero'
import ProductCard from '../../components/shop/ProductCard'
import QuantityInput from '../../components/shop/QuantityInput'
import { images } from '../../data/content'
import { useShop } from '../../context/useShop'
import { FREE_SHIPPING_FROM, formatPrice } from '../../data/shop'
import { api } from '../../api'
import Loading from '../../components/Loading'

const SUGERENCIAS = 4

export default function Cart() {
  const { lines, totals, products, setQty, removeFromCart, catalogLoading } = useShop()
  const sugerencias = products.filter((p) => p.featured).slice(0, SUGERENCIAS)

  return (
    <>
      <PageHero
        compacto
        cara="<:3 )~~"
        title={<>Tu <span className="highlight">carrito</span></>}
        text={lines.length ? 'Revisa tu pedido antes de finalizar la compra.' : 'Todavía no has agregado nada.'}
        image={images.cta}
        alt="Un bulldog francés con sudadera amarilla"
        tag={totals.count > 0 ? <><strong>{totals.count}</strong> {totals.count === 1 ? 'producto' : 'productos'}</> : null}
      />
      <section className="section section--catalogo carrito">
        <div className="container">
          {catalogLoading ? (
            <Loading />
          ) : lines.length === 0 ? (
            <>
              <div className="favoritos__vacio carrito__vacio">
                <ShoppingBag size={36} aria-hidden="true" />
                <div>
                  <h2>Tu carrito está vacío</h2>
                  <p>Descubre lo que tenemos para tu mascota.</p>
                </div>
                <Link to="/tienda/productos" className="btn btn--primary">Ir a la tienda <ArrowRight size={18} /></Link>
              </div>
              {sugerencias.length > 0 && (
                <>
                  <h2 className="favoritos__titulo">Te pueden gustar</h2>
                  <div className="products-grid">
                    {sugerencias.map((p) => <ProductCard key={p.id} product={p} />)}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="cart-layout">
              <div>
                <div className="carrito__cabeza">
                  <h2>{totals.count} {totals.count === 1 ? 'producto' : 'productos'}</h2>
                  <Link to="/tienda/productos" className="carrito__seguir"><ArrowLeft size={16} aria-hidden="true" /> Seguir comprando</Link>
                </div>
                <ul className="carrito__lista">
                  {lines.map((l) => (
                    <li className={`carrito__linea ${l.variant.oldPrice ? 'carrito__linea--oferta' : ''}`} key={l.key}>
                      <Link to={`/tienda/producto/${l.product.slug}`} className="carrito__foto" tabIndex={-1} aria-hidden="true"><img src={l.product.image} alt="" /></Link>
                      <div className="carrito__info">
                        <Link to={`/tienda/producto/${l.product.slug}`}>{l.product.name}</Link>
                        <small>{l.variant.label} · {formatPrice(l.variant.price)} c/u {l.variant.oldPrice && <del>{formatPrice(l.variant.oldPrice)}</del>}</small>
                      </div>
                      <QuantityInput small value={l.qty} onChange={(q) => setQty(l.key, q)} />
                      <strong className="carrito__total">{formatPrice(l.total)}</strong>
                      <button className="remove" onClick={() => removeFromCart(l.key)} aria-label={`Eliminar ${l.product.name}`}>
                        <Trash2 size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
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
        <div className="envio-barra">
          <p className="summary__hint">Agrega {formatPrice(totals.missingForFreeShipping)} más para envío gratis.</p>
          <span aria-hidden="true"><i style={{ width: `${100 - (totals.missingForFreeShipping / FREE_SHIPPING_FROM) * 100}%` }} /></span>
        </div>
      )}
      {children}
    </aside>
  )
}
