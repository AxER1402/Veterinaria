import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Phone, Plus } from 'lucide-react'
import SectionTitle from './SectionTitle'
import { business, faqs } from '../data/content'

export default function Faq({ limit }) {
  const [open, setOpen] = useState(0)
  const id = useId()
  const items = limit ? faqs.slice(0, limit) : faqs

  return (
    <section className="section">
      <div className="container faq">
        <div className="faq__lado">
          <SectionTitle eyebrow="FAQ" title="Preguntas frecuentes" text="¿Tienes otra duda? Escríbenos o llámanos, estaremos felices de ayudarte." light />
          <div className="faq__contacto">
            <a href={`tel:${business.tel}`} className="btn btn--primary btn--sm"><Phone size={16} aria-hidden="true" /> {business.phone}</a>
            <Link to="/contacto" className="btn btn--ghost-light btn--sm">Escríbenos</Link>
          </div>
        </div>
        <div className="faq__list">
          {items.map((f, i) => {
            const isOpen = open === i
            return (
              <div key={f.q} className={`faq__item ${isOpen ? 'open' : ''}`}>
                <h3 className="faq__pregunta">
                  <button id={`${id}-p${i}`} onClick={() => setOpen(isOpen ? -1 : i)} aria-expanded={isOpen} aria-controls={`${id}-r${i}`}>
                    {f.q}
                    <Plus className="faq__icon" size={20} aria-hidden="true" />
                  </button>
                </h3>
                <div className="faq__answer" id={`${id}-r${i}`} role="region" aria-labelledby={`${id}-p${i}`}>
                  <div>
                    <p>{f.a}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
