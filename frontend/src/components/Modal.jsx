import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

// Diálogo nativo: el navegador atrapa el foco y cierra con Esc. Con `dirty` (cambios sin guardar),
// Esc, un clic fuera o la X preguntan antes de cerrar en vez de perder lo escrito.
export default function Modal({ title, onClose, children, wide = false, dirty = false }) {
  const ref = useRef(null)
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    const d = ref.current
    d.showModal()
    return () => d.close()
  }, [])
  const tryClose = () => (dirty ? setAsking(true) : onClose())
  return (
    <dialog ref={ref} className={`modal ${wide ? 'modal--wide' : ''}`} onClose={onClose}
      onCancel={(e) => { e.preventDefault(); tryClose() }}
      onClick={(e) => e.target === ref.current && tryClose()} aria-label={title}>
      <div className="modal__inner">
        <header className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__close" onClick={tryClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        {asking && (
          <div className="modal__confirm" role="alert">
            <span>Tienes cambios sin guardar. ¿Cerrar y descartarlos?</span>
            <button type="button" className="btn btn--dark btn--sm" onClick={onClose}>Descartar</button>
            <button type="button" className="link-btn" onClick={() => setAsking(false)} autoFocus>Seguir editando</button>
          </div>
        )}
        {children}
      </div>
    </dialog>
  )
}
