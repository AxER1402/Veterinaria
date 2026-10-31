const iniciales = (nombre = '') => nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')

// Círculo con las iniciales de una persona.
export default function Avatar({ nombre, grande = false }) {
  return <span className={`avatar ${grande ? 'avatar--grande' : ''}`} aria-hidden="true">{iniciales(nombre)}</span>
}
