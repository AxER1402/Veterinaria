import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../context/useAuth'

// Cambio de contraseña con la actual. Con `obligatorio` (contraseña temporal que dio el personal)
// cubre la página y no se puede cerrar hasta cambiarla.
export default function CambiarPassword({ obligatorio = false }) {
  const { setPerfil, logout } = useAuth()
  const [values, setValues] = useState({ actual: '', nueva: '', repetir: '' })
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setOk('')
    if (values.nueva !== values.repetir) return setError('Las dos contraseñas nuevas no coinciden')
    setSending(true)
    try {
      const d = await api('/api/auth/password', { method: 'PATCH', body: { actual: values.actual, nueva: values.nueva } })
      setValues({ actual: '', nueva: '', repetir: '' })
      setOk('Contraseña cambiada.')
      setPerfil({ cambiar_password: d.usuario.cambiar_password })
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const form = (
    <form className="account__card password-form" onSubmit={submit}>
      <h2><KeyRound size={20} /> {obligatorio ? 'Crea tu contraseña' : 'Cambiar contraseña'}</h2>
      {obligatorio && <p>Entraste con una contraseña temporal que te dio la clínica. Elige una nueva para seguir.</p>}
      <label>{obligatorio ? 'Contraseña temporal' : 'Contraseña actual'}
        <input type="password" value={values.actual} onChange={set('actual')} autoComplete="current-password" required />
      </label>
      <label>Contraseña nueva <small>8 o más caracteres, con letras y números</small>
        <input type="password" value={values.nueva} onChange={set('nueva')} autoComplete="new-password" minLength={8} maxLength={72} required />
      </label>
      <label>Repite la contraseña nueva
        <input type="password" value={values.repetir} onChange={set('repetir')} autoComplete="new-password" required />
      </label>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {ok && !obligatorio && <p className="form-ok" role="status">{ok}</p>}
      <div className="pet-form__actions">
        <button className="btn btn--dark btn--sm" disabled={sending}>{sending ? 'Guardando…' : 'Guardar contraseña'}</button>
        {obligatorio && <button type="button" className="link-btn" onClick={logout}>Cerrar sesión</button>}
      </div>
    </form>
  )
  return obligatorio ? <div className="password-gate" role="dialog" aria-modal="true" aria-label="Crea tu contraseña">{form}</div> : form
}
