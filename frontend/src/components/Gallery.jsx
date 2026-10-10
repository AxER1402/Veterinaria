import { InstagramIcon } from './Brand'
import SectionTitle from './SectionTitle'
import { gallery } from '../data/content'

export default function Gallery() {
  return (
    <section className="section gallery-section">
      <div className="container">
        <SectionTitle eyebrow="#HuellitasFelices" title="Síguenos en Instagram" center />
      </div>
      <div className="gallery">
        {gallery.map((src, i) => (
          <a key={src} href="https://instagram.com" target="_blank" rel="noreferrer" className="gallery__item">
            <img src={src} alt={`Mascota feliz ${i + 1}`} loading="lazy" />
            <span>
              <InstagramIcon size={28} />
            </span>
          </a>
        ))}
      </div>
    </section>
  )
}
