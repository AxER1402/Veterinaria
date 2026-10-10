import { useState } from 'react'
import { Plus } from 'lucide-react'
import SectionTitle from './SectionTitle'
import { faqs } from '../data/content'

export default function Faq({ limit }) {
  const [open, setOpen] = useState(0)
  const items = limit ? faqs.slice(0, limit) : faqs

  return (
    <section className="section">
      <div className="container faq">
        <SectionTitle
          eyebrow="FAQ"
          title="Preguntas frecuentes"
          text="¿Tienes otra duda? Escríbenos o llámanos, estaremos felices de ayudarte."
        />
        <div className="faq__list">
          {items.map((f, i) => {
            const isOpen = open === i
            return (
              <div key={f.q} className={`faq__item ${isOpen ? 'open' : ''}`}>
                <button onClick={() => setOpen(isOpen ? -1 : i)} aria-expanded={isOpen}>
                  {f.q}
                  <Plus className="faq__icon" size={22} />
                </button>
                <div className="faq__answer">
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
