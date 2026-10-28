import { useState } from 'react'
import Modal from './Modal'

// Confirmación propia (en vez de window.confirm/prompt). Con `motivos` muestra opciones rápidas y
// «Otro» para escribirlo; con `requiereMotivo` no deja confirmar sin uno. onConfirm(comentario) puede
// ser async: si falla, el error se muestra aquí y el diálogo sigue abierto.
export default function ConfirmDialog({ title, text, motivos = null, requiereMotivo = false, confirmLabel = 'Confirmar', peligro = false, onConfirm, onClose, children }) {
  const [motivo, setMotivo] = useState('')
  const [otro, setOtro] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const comentario = motivo === 'Otro' ? otro.trim() : motivo
  const falta = requiereMotivo && comentario.length < 3

  const confirmar = async () => {
    setError('')
    setSending(true)
    try {
      await onConfirm(comentario)
    } catch (e) {
      setError(e.message)
      setSending(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose} dirty={Boolean(otro) && !sending}>
      {text && <p className="modal__sub">{text}</p>}
      {children}
      {motivos && (
        <fieldset className="confirm__motivos">
          <legend>Motivo{requiereMotivo ? '' : ' (opcional)'}</legend>
          <div className="chips-row">
            {[...motivos, 'Otro'].map((m) => (
              <button key={m} type="button" className={`chip ${motivo === m ? 'chip--active' : ''}`} aria-pressed={motivo === m} onClick={() => setMotivo(m)}>{m}</button>
            ))}
          </div>
          {motivo === 'Otro' && (
            <input className="confirm__otro" value={otro} onChange={(e) => setOtro(e.target.value)} maxLength={200} placeholder="Escribe el motivo" autoFocus />
          )}
        </fieldset>
      )}
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="pet-form__actions">
        <button className={`btn btn--sm ${peligro ? 'btn--danger' : 'btn--dark'}`} disabled={sending || falta} onClick={confirmar}>
          {sending ? 'Guardando…' : confirmLabel}
        </button>
        <button type="button" className="link-btn" onClick={onClose}>Volver</button>
      </div>
    </Modal>
  )
}
