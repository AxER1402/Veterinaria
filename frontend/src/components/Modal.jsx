import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

// Diálogo nativo: el navegador atrapa el foco y cierra con Esc.
export default function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const d = ref.current
    d.showModal()
    return () => d.close()
  }, [])
  return (
    <dialog ref={ref} className={`modal ${wide ? 'modal--wide' : ''}`} onClose={onClose} onCancel={onClose}
      onClick={(e) => e.target === ref.current && onClose()} aria-label={title}>
      <div className="modal__inner">
        <header className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
