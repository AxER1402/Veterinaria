import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import Flotante from './Flotante'

// Menú «⋯»: las acciones secundarias de una fila. `items`: { label, onClick | to, peligro }.
export default function MenuAcciones({ etiqueta, items }) {
  const [abierto, setAbierto] = useState(false)
  const boton = useRef(null)
  const lista = useRef(null)
  const cerrar = useCallback(() => setAbierto(false), [])
  const cerrarYVolver = () => {
    setAbierto(false)
    boton.current?.focus()
  }

  // El panel se monta oculto hasta medirse y un elemento oculto no recibe el foco: se espera al cuadro siguiente.
  useEffect(() => {
    if (!abierto) return
    const cuadro = requestAnimationFrame(() => lista.current?.querySelector('a, button')?.focus())
    return () => cancelAnimationFrame(cuadro)
  }, [abierto])

  const tecla = (e) => {
    const todos = [...lista.current.querySelectorAll('a, button')]
    const i = todos.indexOf(document.activeElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      todos[(i + (e.key === 'ArrowDown' ? 1 : -1) + todos.length) % todos.length]?.focus()
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      cerrarYVolver()
    }
  }

  if (!items.length) return null
  return (
    <>
      <button ref={boton} type="button" className="menu-acciones" aria-label={etiqueta} aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {abierto && (
        <Flotante ancla={boton} onCerrar={cerrar}>
          <div ref={lista} className="menu-acciones__lista" role="menu" aria-label={etiqueta} onKeyDown={tecla}>
            {items.map((it) => (it.to ? (
              <Link key={it.label} role="menuitem" to={it.to} onClick={cerrar}>{it.label}</Link>
            ) : (
              <button key={it.label} type="button" role="menuitem" className={it.peligro ? 'is-peligro' : ''} onClick={() => { cerrarYVolver(); it.onClick() }}>{it.label}</button>
            )))}
          </div>
        </Flotante>
      )}
    </>
  )
}
