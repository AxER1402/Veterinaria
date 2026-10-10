import PageHeader from '../components/PageHeader'
import HappyPets from '../components/HappyPets'
import WhyUs from '../components/WhyUs'
import Testimonials from '../components/Testimonials'
import Reveal from '../components/Reveal'
import { stats } from '../data/content'

export default function About() {
  return (
    <>
      <PageHeader
        title="Nosotros"
        text="Una familia de veterinarios y cuidadores apasionados por el bienestar animal."
      />
      <HappyPets />
      <section className="stats">
        <div className="container stats__grid">
          {stats.map((s, i) => (
            <Reveal key={s.label} className="stat" delay={i * 100}>
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </Reveal>
          ))}
        </div>
      </section>
      <WhyUs />
      <Testimonials />
    </>
  )
}
