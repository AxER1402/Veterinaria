import { Link } from 'react-router-dom'
import { Heart } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import ProductCard from '../../components/shop/ProductCard'
import { useShop } from '../../context/useShop'

export default function Wishlist() {
  const { wishlist, products } = useShop()
  const items = products.filter((p) => wishlist.includes(p.id))

  return (
    <>
      <PageHeader compact title="Favoritos" text="Los productos que guardaste para más tarde." />
      <section className="section">
        <div className="container">
          {items.length ? (
            <div className="products-grid">
              {items.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Heart size={56} />
              <h3>Aún no tienes favoritos</h3>
              <p>Toca el corazón de cualquier producto para guardarlo aquí.</p>
              <Link to="/tienda/productos" className="btn btn--primary">
                Explorar productos
              </Link>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
