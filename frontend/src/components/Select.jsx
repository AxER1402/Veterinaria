import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import Flotante from './Flotante'

function leerOpciones(children) {
  return Children.toArray(children).flatMap((c) => {
    if (!isValidElement(c)) return []
    if (c.type === Fragment) return leerOpciones(c.props.children)
    if (c.type !== 'option') return []
    const etiqueta = Children.toArray(c.props.children).join('')
    return [{ value: String(c.props.value ?? etiqueta), etiqueta, disabled: Boolean(c.props.disabled) }]
  })
}

// Reemplaza a <select> con el mismo uso: recibe <option> y llama a onChange con e.target.value.
export default function Select({ value, onChange, children, className = '', disabled, ...resto }) {
  const opciones = leerOpciones(children)
  const actual = String(value ?? '')
  const elegida = opciones.find((o) => o.value === actual) ?? opciones[0]
  const [abierto, setAbierto] = useState(false)
  const [activa, setActiva] = useState(0)
  const boton = useRef(null)
  const lista = useRef(null)
  const busqueda = useRef({ texto: '', hasta: 0 })
  const id = useId()

  const cerrar = useCallback(() => setAbierto(false), [])
  const cerrarYVolver = () => {
    setAbierto(false)
    boton.current?.focus()
  }
  const abrir = () => {
    setActiva(Math.max(0, opciones.indexOf(elegida)))
    setAbierto(true)
  }
  const elegir = (o) => {
    if (o.disabled) return
    cerrarYVolver()
    if (o.value !== actual) onChange?.({ target: { value: o.value, name: resto.name } })
  }

  useEffect(() => {
    if (abierto) lista.current?.focus()
  }, [abierto])
  useEffect(() => {
    if (abierto) lista.current?.querySelector(`[data-i="${activa}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [abierto, activa])

  const mover = (desde, paso) => {
    let i = desde
    do i += paso
    while (opciones[i]?.disabled)
    if (opciones[i]) setActiva(i)
  }
  const teclaLista = (e) => {
    const acciones = {
      ArrowDown: () => mover(activa, 1),
      ArrowUp: () => mover(activa, -1),
      Home: () => mover(-1, 1),
      End: () => mover(opciones.length, -1),
      Enter: () => opciones[activa] && elegir(opciones[activa]),
      ' ': () => opciones[activa] && elegir(opciones[activa]),
      Escape: cerrarYVolver,
      Tab: cerrarYVolver,
    }
    if (acciones[e.key]) {
      // Esc solo cierra la lista, no el modal donde esté.
      e.preventDefault()
      e.stopPropagation()
      return acciones[e.key]()
    }
    if (e.key.length === 1) {
      const texto = (e.timeStamp < busqueda.current.hasta ? busqueda.current.texto : '') + e.key.toLowerCase()
      busqueda.current = { texto, hasta: e.timeStamp + 700 }
      const i = opciones.findIndex((o) => !o.disabled && o.etiqueta.toLowerCase().startsWith(texto))
      if (i >= 0) setActiva(i)
    }
  }
  const teclaBoton = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      abrir()
    }
  }

  return (
    <>
      <button ref={boton} type="button" className={`ctl ctl--select ${className}`} disabled={disabled} aria-haspopup="listbox" aria-expanded={abierto}
        onClick={() => (abierto ? cerrar() : abrir())} onKeyDown={teclaBoton} {...resto}>
        <span className="ctl__valor">
          <span>{elegida?.etiqueta}</span>
          {/* Como en un select nativo, el ancho es el de la opción más larga: no cambia al elegir. */}
          {opciones.map((o) => <span key={o.value} className="ctl__medida" aria-hidden="true">{o.etiqueta}</span>)}
        </span>
        <ChevronDown size={16} className="ctl__icono" aria-hidden="true" />
      </button>
      {abierto && (
        <Flotante ancla={boton} onCerrar={cerrar}>
          <ul ref={lista} className="opciones" role="listbox" tabIndex={-1} aria-label={resto['aria-label']} aria-activedescendant={`${id}-${activa}`} onKeyDown={teclaLista}>
            {opciones.map((o, i) => (
              <li key={o.value} id={`${id}-${i}`} data-i={i} role="option" aria-selected={o === elegida} aria-disabled={o.disabled}
                className={`opciones__item ${i === activa ? 'is-activa' : ''} ${o === elegida ? 'is-elegida' : ''}`}
                onPointerEnter={() => !o.disabled && setActiva(i)} onClick={() => elegir(o)}>
                <span>{o.etiqueta}</span>
                {o === elegida && <Check size={16} aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </Flotante>
      )}
    </>
  )
}
