import { Link } from 'react-router-dom'
import { ArrowRight, Heart } from 'lucide-react'
import Loading from '../../components/Loading'
import PageHero from '../../components/PageHero'
import ProductCard from '../../components/shop/ProductCard'
import { images } from '../../data/content'
import { useShop } from '../../context/useShop'

const SUGERENCIAS = 4

export default function Wishlist() {
  const { wishlist, products, catalogLoading } = useShop()
  const items = products.filter((p) => wishlist.includes(p.id))
  const sugerencias = products.filter((p) => p.featured).slice(0, SUGERENCIAS)

  return (
    <>
      <PageHero
        compacto
        cara="(=^･ω･^=)♡"
        title={<>Tus <span className="highlight">favoritos</span></>}
        text="Los productos que guardaste para más tarde."
        image={images.happyPets}
        alt="Un gato y un perro acostados juntos"
        tag={items.length > 0 ? <><strong>{items.length}</strong> {items.length === 1 ? 'guardado' : 'guardados'}</> : null}
      />
      <section className="section section--catalogo">
        <div className="container">
          {catalogLoading ? <Loading /> : items.length ? (
            <>
              <div className="products-grid">
                {items.map((p) => <ProductCard key={p.id} product={p} />)}
              </div>
              <p className="favoritos__mas">
                <Link to="/tienda/productos" className="btn btn--outline">Seguir comprando <ArrowRight size={18} /></Link>
              </p>
            </>
          ) : (
            <>
              <div className="favoritos__vacio">
                <Heart size={36} aria-hidden="true" />
                <div>
                  <h2>Aún no tienes favoritos</h2>
                  <p>Toca el corazón de cualquier producto para guardarlo aquí.</p>
                </div>
                <Link to="/tienda/productos" className="btn btn--primary">Ver productos <ArrowRight size={18} /></Link>
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
          )}
        </div>
      </section>
    </>
  )
}
