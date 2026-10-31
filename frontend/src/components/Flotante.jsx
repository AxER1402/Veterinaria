import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const MARGEN = 8

// Panel flotante de Select y DateInput, pegado al botón que lo abre. Se monta fuera del <label> (un clic
// dentro volvería a activar el botón) y fuera de las tarjetas que recortan su contenido. Dentro de un
// <dialog> nativo se monta en el propio diálogo: fuera quedaría debajo de él.
export default function Flotante({ ancla, onCerrar, className = '', children, ...resto }) {
  const panel = useRef(null)
  const [pos, setPos] = useState(null)
  const destino = ancla.current?.closest('dialog') ?? document.body

  useLayoutEffect(() => {
    const ubicar = () => {
      if (!ancla.current || !panel.current) return
      const a = ancla.current.getBoundingClientRect()
      const { offsetWidth: ancho, offsetHeight: alto } = panel.current
      const abajo = window.innerHeight - a.bottom - MARGEN
      const arriba = a.top - MARGEN
      const haciaArriba = alto > abajo && arriba > abajo
      setPos({
        left: Math.max(MARGEN, Math.min(a.left, window.innerWidth - ancho - MARGEN)),
        top: haciaArriba ? Math.max(MARGEN, a.top - alto - 4) : a.bottom + 4,
        minWidth: a.width,
        '--flotante-alto': `${Math.max(arriba, abajo) - 4}px`,
      })
    }
    ubicar()
    window.addEventListener('resize', ubicar)
    window.addEventListener('scroll', ubicar, true)
    return () => {
      window.removeEventListener('resize', ubicar)
      window.removeEventListener('scroll', ubicar, true)
    }
  }, [ancla])

  useEffect(() => {
    const fuera = (e) => {
      if (!panel.current?.contains(e.target) && !ancla.current?.contains(e.target)) onCerrar()
    }
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [ancla, onCerrar])

  // Con el panel abierto, Esc debe cerrar solo el panel: el <dialog> nativo se cancela aunque la tecla se
  // detenga. Se deja escuchando un instante más porque la tecla ya cerró el panel cuando llega el «cancel».
  useEffect(() => {
    const dialogo = ancla.current?.closest('dialog')
    if (!dialogo) return
    const retener = (e) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      onCerrar()
    }
    dialogo.addEventListener('cancel', retener, true)
    return () => {
      setTimeout(() => dialogo.removeEventListener('cancel', retener, true))
    }
  }, [ancla, onCerrar])

  // El portal sigue siendo hijo del formulario para React: sin esto, un clic llegaría a la fila o tarjeta de atrás.
  const detener = (e) => e.stopPropagation()

  return createPortal(
    <div ref={panel} className={`flotante ${className}`} style={pos ?? { visibility: 'hidden', left: 0, top: 0 }} onClick={detener} onMouseDown={detener} {...resto}>
      {children}
    </div>,
    destino,
  )
}
