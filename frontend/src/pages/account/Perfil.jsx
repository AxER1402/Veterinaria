import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Mail, Phone, UserRound } from 'lucide-react'
import CuentaMarco from '../../components/CuentaMarco'
import Field from '../../components/Field'
import Loading from '../../components/Loading'
import { useAuth } from '../../context/useAuth'
import { api } from '../../api'
import { business } from '../../data/content'

// Solo ayuda al usuario: el servidor vuelve a validar todo.
const TELEFONO = /^\+?[0-9 ()-]{7,20}$/

export default function Perfil() {
  const { user, checking } = useAuth()
  if (checking) return <Loading />
  if (!user) return <Navigate to="/cuenta" state={{ from: '/cuenta/perfil' }} replace />
  return (
    <CuentaMarco titulo="Mi perfil" texto="Usamos estos datos para confirmar tus citas y entregar tus pedidos.">
      <PerfilForm key={user.id} />
    </CuentaMarco>
  )
}

function PerfilForm() {
  const { user, setPerfil } = useAuth()
  const [values, setValues] = useState({ nombre: user.nombre || '', telefono: user.telefono || '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [guardado, setGuardado] = useState(false)
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => {
    setGuardado(false)
    setValues((v) => ({ ...v, [f]: e.target.value }))
  }
  const sinCambios = values.nombre.trim() === (user.nombre || '') && values.telefono.trim() === (user.telefono || '')

  const submit = async (e) => {
    e.preventDefault()
    const nombre = values.nombre.trim()
    const telefono = values.telefono.trim()
    const found = {}
    if (nombre.length < 2) found.nombre = 'Ingresa tu nombre'
    if (telefono && (!TELEFONO.test(telefono) || telefono.replace(/\D/g, '').length < 7)) found.telefono = 'Teléfono no válido'
    setErrors(found)
    setError('')
    setGuardado(false)
    if (Object.keys(found).length) return
    setSending(true)
    try {
      const d = await api('/api/auth/perfil', { method: 'PATCH', body: { nombre, telefono } })
      setPerfil({ nombre: d.usuario.nombre, telefono: d.usuario.telefono })
      setValues({ nombre: d.usuario.nombre, telefono: d.usuario.telefono || '' })
      setGuardado(true)
    } catch (err) {
      if (err.data?.campo) setErrors({ [err.data.campo]: err.message })
      else setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="cuenta__tarjeta perfil" onSubmit={submit} noValidate>
      <Field label="Nombre completo" error={errors.nombre}>
        <span className="entrada">
          <UserRound size={18} className="entrada__icono" aria-hidden="true" />
          <input value={values.nombre} onChange={set('nombre')} autoComplete="name" maxLength={100} />
        </span>
      </Field>
      <Field label="Teléfono" error={errors.telefono}>
        <span className="entrada">
          <Phone size={18} className="entrada__icono" aria-hidden="true" />
          <input type="tel" value={values.telefono} onChange={set('telefono')} autoComplete="tel" placeholder="5555 1234" maxLength={20} />
        </span>
      </Field>
      <Field label="Correo">
        <span className="entrada">
          <Mail size={18} className="entrada__icono" aria-hidden="true" />
          <input type="email" value={user.email} readOnly disabled />
        </span>
      </Field>
      <p className="account__hint perfil__nota">
        {user.google ? 'Tu cuenta entra con Google, y el correo es el de esa cuenta.' : <>Para cambiar el correo, escríbenos a <a href={`mailto:${business.email}`}>{business.email}</a>. La contraseña se cambia en <Link to="/cuenta/seguridad">Seguridad</Link>.</>}
      </p>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {guardado && <p className="form-ok" role="status">Cambios guardados.</p>}
      <button className="btn btn--primary" disabled={sending || sinCambios}>{sending ? 'Guardando…' : 'Guardar cambios'}</button>
    </form>
  )
}
