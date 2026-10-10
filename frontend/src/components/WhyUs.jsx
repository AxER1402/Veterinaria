import Reveal from './Reveal'
import SectionTitle from './SectionTitle'
import { reasons } from '../data/content'

export default function WhyUs() {
  return (
    <section className="section">
      <div className="container">
        <SectionTitle
          eyebrow="Nuestra promesa"
          title="¿Por qué confiar en nosotros?"
          text="Más que una veterinaria, somos una familia que cuida a la tuya."
          center
        />
        <div className="reasons-grid">
          {reasons.map((r, i) => {
            const Icon = r.icon
            return (
              <Reveal key={r.title} className="reason" delay={i * 80}>
                <span className="reason__icon">
                  <Icon size={28} />
                </span>
                <div>
                  <h3>{r.title}</h3>
                  <p>{r.text}</p>
                </div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
