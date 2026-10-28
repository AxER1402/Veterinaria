import Hero from '../components/Hero'
import HappyPets from '../components/HappyPets'
import ServicesGrid from '../components/ServicesGrid'
import Testimonials from '../components/Testimonials'
import Locations from '../components/Locations'
import Faq from '../components/Faq'

export default function Home() {
  return (
    <>
      <Hero />
      <HappyPets />
      <ServicesGrid />
      <Testimonials />
      <Locations />
      <Faq limit={4} />
    </>
  )
}
