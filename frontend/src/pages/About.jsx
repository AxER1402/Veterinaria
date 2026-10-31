import PageHero from '../components/PageHero'
import HappyPets from '../components/HappyPets'
import WhyUs from '../components/WhyUs'
import Testimonials from '../components/Testimonials'
import Reveal from '../components/Reveal'
import { images, stats } from '../data/content'
import { useClinica } from '../context/useClinica'

export default function About() {
  const { sedes } = useClinica()
  return (
    <>
      <PageHero
        cara="=^･ω･^="
        title={<>Una familia que cuida a <span className="highlight">tu familia</span></>}
        text="Somos veterinarios y cuidadores apasionados por el bienestar animal."
        cta={{ to: '/servicios', label: 'Ver servicios' }}
        image={images.nosotros}
        alt="Persona acariciando a un gato atigrado"
        tag={<><strong>{sedes.length || 1}</strong> {sedes.length === 1 ? 'sede' : 'sedes'} en la ciudad</>}
      />
      <HappyPets conEnlace={false} />
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
