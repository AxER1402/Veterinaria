import PageHeader from './PageHeader'
import { business } from '../data/content'
import { useClinica } from '../context/useClinica'

// Plantilla de Privacidad y Términos: encabezado, fecha de actualización y texto en una columna legible.
export default function LegalPage({ title, text, actualizado, children }) {
  const { telefono, tel, horario } = useClinica()
  return (
    <>
      <PageHeader title={title} text={text} compact />
      <section className="section legal">
        <div className="container legal__body">
          <p className="legal__fecha">Última actualización: {actualizado}</p>
          {children}
          <h2>Contacto</h2>
          <p>
            Si tienes dudas sobre este texto, escríbenos a <a href={`mailto:${business.email}`}>{business.email}</a> o
            llámanos al <a href={tel}>{telefono}</a> ({horario}).
          </p>
        </div>
      </section>
    </>
  )
}
