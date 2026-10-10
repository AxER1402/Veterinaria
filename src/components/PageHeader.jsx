import { Link } from 'react-router-dom'
import { PawIcon } from './Brand'

export default function PageHeader({ title, text }) {
  return (
    <section className="page-header">
      <PawIcon className="hero__paw hero__paw--1" size={56} />
      <div className="container">
        <nav className="breadcrumb" aria-label="Ruta">
          <Link to="/">Inicio</Link> / <span>{title}</span>
        </nav>
        <h1>{title}</h1>
        {text && <p>{text}</p>}
      </div>
    </section>
  )
}
