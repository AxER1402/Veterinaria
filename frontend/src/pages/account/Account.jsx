import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Field from '../../components/Field'
import Loading from '../../components/Loading'
import { useAuth } from '../../context/useAuth'

export default function Account() {
  const { user, checking } = useAuth()
  const location = useLocation()
  const [tab, setTab] = useState('ingresar')
  const from = location.state?.from || '/cuenta/pedidos'

  if (checking) return <Loading />
  if (user) return <Navigate to={from} replace />

  return (
    <>
      <PageHeader title="Mi cuenta" text="Ingresa para comprar y seguir tus pedidos." />
      <section className="section">
        <div className="container account">
          <div className="account__tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'ingresar'} className={tab === 'ingresar' ? 'active' : ''} onClick={() => setTab('ingresar')}>
              Ingresar
            </button>
            <button role="tab" aria-selected={tab === 'registro'} className={tab === 'registro' ? 'active' : ''} onClick={() => setTab('registro')}>
              Crear cuenta
            </button>
          </div>
          {tab === 'ingresar' ? <LoginForm from={from} /> : <RegisterForm onDone={() => setTab('ingresar')} />}
        </div>
      </section>
    </>
  )
}

function LoginForm({ from }) {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSending(true)
    setError('')
    try {
      await login(values.email, values.password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="account__form" onSubmit={submit}>
      <Field label="Correo">
        <input type="email" value={values.email} onChange={set('email')} autoComplete="email" required maxLength={120} />
      </Field>
      <Field label="Contraseña">
        <input type="password" value={values.password} onChange={set('password')} autoComplete="current-password" required maxLength={72} />
      </Field>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" disabled={sending}>{sending ? 'Ingresando…' : 'Ingresar'}</button>
      <p className="account__hint">Por seguridad, la cuenta se bloquea 15 minutos tras 5 intentos fallidos.</p>
    </form>
  )
}

function RegisterForm({ onDone }) {
  const { register, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [values, setValues] = useState({ nombre: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    const found = {}
    if (values.nombre.trim().length < 2) found.nombre = 'Ingresa tu nombre'
    if (values.password.length < 8 || !/\d/.test(values.password) || !/[a-zA-ZÀ-ÿ]/.test(values.password))
      found.password = 'Mínimo 8 caracteres, con letras y números'
    if (values.password !== values.confirm) found.confirm = 'Las contraseñas no coinciden'
    setErrors(found)
    if (Object.keys(found).length) return
    setSending(true)
    setError('')
    try {
      await register(values.nombre, values.email, values.password)
    } catch (err) {
      if (err.data?.campo) setErrors({ [err.data.campo]: err.message })
      else if (err.status === 409) setErrors({ email: err.message })
      else setError(err.message)
      setSending(false)
      return
    }
    try {
      await login(values.email, values.password)
      navigate(location.state?.from || '/cuenta/pedidos', { replace: true })
    } catch {
      // La cuenta sí se creó; si el ingreso automático falla, se ingresa a mano.
      onDone()
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="account__form" onSubmit={submit} noValidate>
      <Field label="Nombre completo" error={errors.nombre}>
        <input value={values.nombre} onChange={set('nombre')} autoComplete="name" maxLength={100} />
      </Field>
      <Field label="Correo" error={errors.email}>
        <input type="email" value={values.email} onChange={set('email')} autoComplete="email" maxLength={120} />
      </Field>
      <Field label="Contraseña" error={errors.password}>
        <input type="password" value={values.password} onChange={set('password')} autoComplete="new-password" maxLength={72} />
      </Field>
      <Field label="Repite la contraseña" error={errors.confirm}>
        <input type="password" value={values.confirm} onChange={set('confirm')} autoComplete="new-password" maxLength={72} />
      </Field>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" disabled={sending}>{sending ? 'Creando cuenta…' : 'Crear cuenta'}</button>
    </form>
  )
}
