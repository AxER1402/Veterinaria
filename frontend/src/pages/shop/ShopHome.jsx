import { Link } from 'react-router-dom'
import { ArrowRight, Truck, Store, BadgeCheck, Stethoscope, Sparkles, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import Reveal from '../../components/Reveal'
import SectionTitle from '../../components/SectionTitle'
import ProductCard from '../../components/shop/ProductCard'
import Rating from '../../components/shop/Rating'
import Countdown from '../../components/shop/Countdown'
import { PawIcon } from '../../components/Brand'
import { pets, brands, tips, formatPrice, FREE_SHIPPING_FROM } from '../../data/shop'
import { api } from '../../api'
import { useShop } from '../../context/useShop'
import { useClinica } from '../../context/useClinica'

const heroImage =
  'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?auto=format&fit=crop&w=1000&h=1000&q=75'

export default function ShopHome() {
  const { sedes } = useClinica()
  const { products } = useShop()
  const featured = products.filter((p) => p.featured)

  return (
    <>
      <section className="shop-hero">
        <div className="container shop-hero__inner">
          <div className="shop-hero__content">
            <span className="shop-hero__face">▼・ᴥ・▼</span>
            <h1>
              Todo para que tu mascota viva <span className="highlight">más feliz</span>
            </h1>
            <p>Alimento, snacks, juguetes y accesorios seleccionados por nuestros veterinarios.</p>
            <Link to="/tienda/productos" className="btn btn--primary">
              Comprar ahora <ArrowRight size={18} />
            </Link>
          </div>
          <div className="shop-hero__media">
            <div className="shop-hero__circle" />
            <img src={heroImage} alt="Bulldog francés con sudadera amarilla" />
            <span className="shop-hero__tag">
              Envío <strong>gratis</strong> desde {formatPrice(FREE_SHIPPING_FROM)}
            </span>
          </div>
        </div>
      </section>

      <section className="perks">
        <div className="container perks__grid">
          <div className="perk">
            <Truck size={30} />
            <div>
              <strong>Envío el mismo día</strong>
              <p>en pedidos antes de las 11:00</p>
            </div>
          </div>
          <div className="perk">
            <Store size={30} />
            <div>
              <strong>Retira en tienda</strong>
              <p>{(sedes.find((s) => s.retiro) || sedes[0])?.direccion}</p>
            </div>
          </div>
          <div className="perk">
            <BadgeCheck size={30} />
            <div>
              <strong>4,8 de calificación</strong>
              <p>de compradores verificados</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <SectionTitle eyebrow="Favoritos" title="Pruébalo, te encantará" />
            <Link to="/tienda/productos" className="link-arrow">
              Ver todos <ArrowRight size={18} />
            </Link>
          </div>
          <div className="products-grid">
            {featured.map((p, i) => (
              <Reveal key={p.id} delay={(i % 4) * 70}>
                <ProductCard product={p} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <FlashSale />

      <section className="section">
        <div className="container">
          <SectionTitle eyebrow="Categorías" title="Compra por mascota" center />
          <div className="pets-grid">
            {pets.map((pet, i) => (
              <Reveal key={pet.slug} delay={i * 60}>
                <Link to={`/tienda/productos?mascota=${pet.slug}`} className="pet-tile">
                  <span className="pet-tile__img">
                    <img src={pet.image} alt="" loading="lazy" />
                  </span>
                  <h3>{pet.label}</h3>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--tint">
        <div className="container promo-split">
          <Reveal className="promo-card promo-card--health">
            <span className="promo-card__icon">
              <Stethoscope size={30} />
            </span>
            <h2>Salud y bienestar</h2>
            <p>
              Nuestros veterinarios te ayudan a elegir la dieta y los cuidados ideales. Agenda una consulta y recibe
              recomendaciones personalizadas.
            </p>
            <div className="promo-card__buttons">
              <Link to="/reservar" className="btn btn--primary">
                Agendar cita
              </Link>
              <Link to="/servicios" className="btn btn--ghost-light">
                Ver servicios
              </Link>
            </div>
          </Reveal>
          <Reveal className="promo-card promo-card--new" delay={120}>
            <span className="promo-card__icon">
              <Sparkles size={30} />
            </span>
            <h2>¿Nueva mascota en casa?</h2>
            <p>Encuentra todo lo que necesitas para empezar: camas, platos, correas y su primer alimento.</p>
            <Link to="/tienda/productos?categoria=accesorios" className="btn btn--dark">
              Ver kit de inicio
            </Link>
          </Reveal>
        </div>
      </section>

      <section className="section section--compact brands-section">
        <div className="container">
          <SectionTitle title="Marcas que amamos" center />
          <div className="brands">
            {brands.map((b) => (
              <Link key={b} to={`/tienda/productos?marca=${encodeURIComponent(b)}`} className="brand-chip">
                <PawIcon size={16} /> {b}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionTitle eyebrow="Blog" title="Consejos y recomendaciones" center />
          <div className="tips-grid">
            {tips.map((t, i) => (
              <Reveal key={t.title} className="tip-card" delay={i * 100}>
                <div className="tip-card__img">
                  <img src={t.image} alt="" loading="lazy" />
                  <span>{t.tag}</span>
                </div>
                <h3>{t.title}</h3>
                <p>{t.excerpt}</p>
                <Link to="/preguntas" className="link-arrow">
                  Leer más <ArrowRight size={16} />
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <ReviewsWall />

      <div className="free-shipping-strip">
        <Truck size={20} /> Envío <strong>GRATIS</strong> en pedidos desde {formatPrice(FREE_SHIPPING_FROM)}
      </div>
    </>
  )
}

// Oferta flash con el cupón real FLASH50: si no existe o venció, no se muestra; la cuenta regresiva
// solo aparece si el cupón tiene fecha de vencimiento (antes se «reiniciaba» cada medianoche).
function FlashSale() {
  const [copied, setCopied] = useState(false)
  const [cupon, setCupon] = useState(undefined)
  useEffect(() => {
    api('/api/pedidos/cupones/FLASH50', { auth: false }).then((d) => setCupon(d.cupon)).catch(() => setCupon(null))
  }, [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText('FLASH50')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Portapapeles no disponible; el código sigue visible en pantalla.
    }
  }
  if (!cupon) return null

  return (
    <section className="flash">
      <div className="container flash__inner">
        <div className="flash__percent">
          <span>Flash</span>
          <strong>
            {cupon.porcentaje}<small>%</small>
          </strong>
        </div>
        <div className="flash__text">
          <h3>{cupon.marca ? `En todos los productos ${cupon.marca}` : 'En toda la tienda'}</h3>
          <p>
            Usa el código{' '}
            <button className="coupon-code" onClick={copy}>
              FLASH50 <Copy size={14} />
            </button>{' '}
            {copied && <em>¡Copiado!</em>}
          </p>
        </div>
        {cupon.vence ? <Countdown hasta={cupon.vence} /> : <p className="flash__limit">Por tiempo limitado</p>}
        <Link to="/tienda/productos?marca=NutriHuella" className="btn btn--dark">
          Aprovechar
        </Link>
      </div>
    </section>
  )
}

// Reseñas reales de clientes que compraron (las más recientes). Sin reseñas, la sección no se muestra.
function ReviewsWall() {
  const [datos, setDatos] = useState(null)
  useEffect(() => {
    api('/api/catalogo/resenas/recientes', { auth: false }).then(setDatos).catch(() => setDatos(null))
  }, [])
  if (!datos || datos.resenas.length === 0) return null
  return (
    <section className="section section--tint">
      <div className="container reviews-wall">
        <div className="reviews-wall__score">
          <h2>Opiniones de clientes</h2>
          <Rating value={datos.promedio} size={24} />
          <p>
            <strong>{datos.promedio.toFixed(1)} de 5</strong> · {datos.total} {datos.total === 1 ? 'reseña' : 'reseñas'} de compras verificadas
          </p>
        </div>
        <div className="reviews-wall__list">
          {datos.resenas.map((r, i) => (
            <Reveal key={r.id} className="review-card" delay={i * 80}>
              <Rating value={r.calificacion} />
              <h3><Link to={`/tienda/producto/${r.slug}`}>{r.producto}</Link></h3>
              <p>{r.comentario}</p>
              <small>{r.autor}</small>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
