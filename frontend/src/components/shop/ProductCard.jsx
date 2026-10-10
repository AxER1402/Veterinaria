import { Link } from 'react-router-dom'
import { Heart, ShoppingBag } from 'lucide-react'
import Rating from './Rating'
import { useShop } from '../../context/useShop'
import { formatPrice, minPrice, maxPrice } from '../../data/shop'

export default function ProductCard({ product }) {
  const { addToCart, toggleWish, isWished } = useShop()
  const url = `/tienda/producto/${product.slug}`
  const first = product.variants[0]
  const low = minPrice(product)
  const high = maxPrice(product)
  const wished = isWished(product.id)

  return (
    <article className="product-card">
      <div className="product-card__media">
        <Link to={url} tabIndex={-1} aria-hidden="true">
          <img src={product.image} alt="" loading="lazy" />
        </Link>
        {product.badge && (
          <span className={`badge ${product.badge === 'Oferta' ? 'badge--sale' : ''}`}>{product.badge}</span>
        )}
        <button
          className={`wish ${wished ? 'wish--on' : ''}`}
          onClick={() => toggleWish(product.id)}
          aria-label={wished ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          aria-pressed={wished}
        >
          <Heart size={18} />
        </button>
      </div>
      <div className="product-card__body">
        <span className="product-card__brand">{product.brand}</span>
        <h3>
          <Link to={url}>{product.name}</Link>
        </h3>
        <Rating value={product.rating} reviews={product.reviews} />
        <div className="product-card__footer">
          <span className="product-price">
            {low === high ? formatPrice(low) : `${formatPrice(low)} – ${formatPrice(high)}`}
            {product.variants.length === 1 && first.oldPrice && <del>{formatPrice(first.oldPrice)}</del>}
          </span>
          {product.variants.length > 1 ? (
            <Link to={url} className="icon-btn" aria-label={`Elegir opciones de ${product.name}`}>
              <ShoppingBag size={18} />
            </Link>
          ) : (
            <button className="icon-btn" onClick={() => addToCart(product.id, first.label)} disabled={!first.available}
              aria-label={first.available ? `Agregar ${product.name} al carrito` : `${product.name} está agotado`}>
              <ShoppingBag size={18} />
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
