import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Heart, ShoppingBag, Truck, ShieldCheck, RotateCcw } from 'lucide-react'
import Rating from '../../components/shop/Rating'
import QuantityInput from '../../components/shop/QuantityInput'
import ProductCard from '../../components/shop/ProductCard'
import SectionTitle from '../../components/SectionTitle'
import NotFound from '../NotFound'
import { useShop } from '../../context/useShop'
import { pets, categories, formatPrice } from '../../data/shop'
import Loading from '../../components/Loading'

export default function ProductDetail() {
  const { slug } = useParams()
  const { findProduct, catalogLoading } = useShop()
  const product = findProduct(slug)
  if (!product && catalogLoading) return <Loading />
  // key={slug} reinicia la variante y cantidad al navegar entre productos.
  return product ? <ProductView key={slug} product={product} /> : <NotFound />
}

function ProductView({ product }) {
  const { addToCart, toggleWish, isWished, products } = useShop()
  const [variantLabel, setVariantLabel] = useState((product.variants.find((v) => v.available) ?? product.variants[0]).label)
  const [qty, setQty] = useState(1)

  const variant = product.variants.find((v) => v.label === variantLabel)
  const pet = pets.find((p) => p.slug === product.pet)
  const category = categories.find((c) => c.slug === product.category)
  const wished = isWished(product.id)
  const related = products
    .filter((p) => p.id !== product.id && (p.pet === product.pet || p.category === product.category))
    .slice(0, 4)

  return (
    <>
      <section className="section section--compact">
        <div className="container">
          <nav className="breadcrumb breadcrumb--left" aria-label="Ruta">
            <Link to="/tienda">Tienda</Link> / <Link to={`/tienda/productos?mascota=${pet.slug}`}>{pet.label}</Link> /{' '}
            <Link to={`/tienda/productos?mascota=${pet.slug}&categoria=${category.slug}`}>{category.label}</Link>
          </nav>

          <div className="product-detail">
            <div className="product-detail__media">
              <img src={product.image.replace('w=600&h=600', 'w=900&h=900')} alt={product.name} />
              {product.badge && (
                <span className={`badge ${product.badge === 'Oferta' ? 'badge--sale' : ''}`}>{product.badge}</span>
              )}
            </div>

            <div className="product-detail__info">
              <span className="product-card__brand">{product.brand}</span>
              <h1>{product.name}</h1>
              <Rating value={product.rating} reviews={product.reviews} size={18} />

              <p className="product-detail__price">
                {formatPrice(variant.price)}
                {variant.oldPrice && <del>{formatPrice(variant.oldPrice)}</del>}
              </p>
              <p>{product.description}</p>
              {!variant.available && <p className="stock-note stock-note--out">Agotado por ahora</p>}
              {variant.few && <p className="stock-note">¡Quedan pocas unidades!</p>}

              {product.variants.length > 1 && (
                <fieldset className="variants">
                  <legend>
                    Presentación: <strong>{variantLabel}</strong>
                  </legend>
                  {product.variants.map((v) => (
                    <label key={v.label} className={v.label === variantLabel ? 'active' : ''}>
                      <input
                        type="radio"
                        name="variant"
                        value={v.label}
                        checked={v.label === variantLabel}
                        onChange={() => setVariantLabel(v.label)}
                      />
                      {v.label}
                    </label>
                  ))}
                </fieldset>
              )}

              <div className="product-detail__actions">
                <QuantityInput value={qty} onChange={setQty} />
                <button className="btn btn--primary" onClick={() => addToCart(product.id, variantLabel, qty)} disabled={!variant.available}>
                  <ShoppingBag size={18} /> Agregar al carrito
                </button>
                <button
                  className={`wish wish--lg ${wished ? 'wish--on' : ''}`}
                  onClick={() => toggleWish(product.id)}
                  aria-label={wished ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  aria-pressed={wished}
                >
                  <Heart size={20} />
                </button>
              </div>

              <ul className="guarantees">
                <li><Truck size={18} /> Envío gratis en pedidos desde Q400</li>
                <li><RotateCcw size={18} /> Devoluciones gratis durante 30 días</li>
                <li><ShieldCheck size={18} /> Producto recomendado por nuestros veterinarios</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {related.length > 0 && (
        <section className="section">
          <div className="container">
            <SectionTitle title="También te puede gustar" />
            <div className="products-grid">
              {related.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  )
}
