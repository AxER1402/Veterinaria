import Hero from '../components/Hero'
import HappyPets from '../components/HappyPets'
import ServicesGrid from '../components/ServicesGrid'
import WhyUs from '../components/WhyUs'
import Testimonials from '../components/Testimonials'
import BookingForm from '../components/BookingForm'
import Locations from '../components/Locations'
import Faq from '../components/Faq'
import Gallery from '../components/Gallery'

export default function Home() {
  return (
    <>
      <Hero />
      <HappyPets />
      <ServicesGrid />
      <WhyUs />
      <Testimonials />
      <BookingForm />
      <Locations />
      <Faq limit={4} />
      <Gallery />
    </>
  )
}
