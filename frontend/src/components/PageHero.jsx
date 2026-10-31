import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

// Encabezado de las páginas informativas, con el estilo de la portada de la tienda.
// `cara` es la carita de animal sobre el título. `tag` va en el círculo flotante: texto corto con un dato en <strong>.
// `compacto` para las páginas de uso (catálogo, reserva): más bajo, para llegar rápido al contenido.
export default function PageHero({ cara, title, text, cta, image, alt, tag, compacto = false }) {
  return (
    <section className={`shop-hero page-hero ${compacto ? 'page-hero--compacto' : ''}`}>
      <div className="container shop-hero__inner">
        <div className="shop-hero__content">
          <span className="shop-hero__face" aria-hidden="true">{cara}</span>
          <h1>{title}</h1>
          <p>{text}</p>
          {cta && (
            <Link to={cta.to} className="btn btn--primary">
              {cta.label} <ArrowRight size={18} />
            </Link>
          )}
        </div>
        <div className="shop-hero__media">
          <div className="shop-hero__circle" />
          <img src={image} alt={alt} />
          {tag && <span className="shop-hero__tag">{tag}</span>}
        </div>
      </div>
    </section>
  )
}
