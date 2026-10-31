import PageHero from '../components/PageHero'
import Faq from '../components/Faq'
import { faqs, images } from '../data/content'

export default function FaqPage() {
  return (
    <>
      <PageHero
        cara="(･ө･)"
        title={<>Resolvemos tus <span className="highlight">dudas</span></>}
        text="Las respuestas a lo que más nos preguntan nuestros clientes. Si no encuentras la tuya, escríbenos."
        cta={{ to: '/contacto', label: 'Contactarnos' }}
        image={images.preguntas}
        alt="Cachorro de pelo marrón y blanco asomado junto a un cojín rosado"
        tag={<><strong>{faqs.length}</strong> respuestas rápidas</>}
      />
      <Faq />
    </>
  )
}
