import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Quote } from 'lucide-react'
import SectionTitle from './SectionTitle'
import { testimonials } from '../data/content'

export default function Testimonials() {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const total = testimonials.length
  const go = (dir) => setIndex((i) => (i + dir + total) % total)

  useEffect(() => {
    if (paused) return
    const id = setInterval(() => setIndex((i) => (i + 1) % total), 6000)
    return () => clearInterval(id)
  }, [paused, total])

  return (
    <section className="section testimonials">
      <div className="container testimonials__inner">
        <div className="testimonials__intro">
          <SectionTitle eyebrow="Testimonios" title="Nuestros clientes dicen:" />

        </div>

        <div
          className="slider"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="slider__track" style={{ transform: `translateX(-${index * 100}%)` }}>
            {testimonials.map((t) => (
              <figure className="testimonial" key={t.pet}>
                <Quote className="testimonial__quote" size={48} />
                <blockquote>“{t.text}”</blockquote>
                <figcaption>
                  <img src={t.image} alt={t.pet} loading="lazy" />
                  <div>
                    <strong>{t.owner}</strong>
                    <span>con {t.pet}</span>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="slider__controls">
            <button onClick={() => go(-1)} aria-label="Anterior">
              <ChevronLeft />
            </button>
            <div className="slider__dots">
              {testimonials.map((t, i) => (
                <button
                  key={t.pet}
                  className={i === index ? 'active' : ''}
                  onClick={() => setIndex(i)}
                  aria-label={`Testimonio ${i + 1}`}
                />
              ))}
            </div>
            <button onClick={() => go(1)} aria-label="Siguiente">
              <ChevronRight />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
