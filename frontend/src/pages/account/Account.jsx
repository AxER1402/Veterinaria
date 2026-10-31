import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CalendarHeart, Eye, EyeOff, Lock, Mail, Package, ShieldCheck, Syringe, User } from 'lucide-react'
import Field from '../../components/Field'
import GoogleButton from '../../components/GoogleButton'
import Loading from '../../components/Loading'
import { useAuth } from '../../context/useAuth'
import { images } from '../../data/content'

const VENTAJAS = [
  { icon: CalendarHeart, texto: 'Reserva y cambia tus citas' },
  { icon: Syringe, texto: 'Consulta el carné de tus mascotas' },
  { icon: Package, texto: 'Sigue tus pedidos de la tienda' },
]

export default function Account() {
  const { user, checking } = useAuth()
  const location = useLocation()
  const [tab, setTab] = useState('ingresar')
  const from = location.state?.from || '/cuenta/citas'

  if (checking) return <Loading />
  if (user) return <Navigate to={from} replace />

  return (
    <section className="auth">
      <div className="auth__tarjeta">
        <aside className="auth__panel">
          <span className="shop-hero__face" aria-hidden="true">▼・ᴥ・▼</span>
          <p className="auth__lema">Todo sobre tu mascota, <span className="highlight">en un solo lugar</span></p>
          <ul className="auth__ventajas">
            {VENTAJAS.map(({ icon: Icon, texto }) => (
              <li key={texto}><Icon size={20} aria-hidden="true" /> {texto}</li>
            ))}
          </ul>
          <div className="auth__foto" aria-hidden="true">
            <div className="shop-hero__circle" />
            <img src={images.hero} alt="" />
          </div>
        </aside>

        <div className="auth__contenido">
          <h1>{tab === 'ingresar' ? 'Qué bueno verte' : 'Crea tu cuenta'}</h1>
          <p className="auth__sub">{tab === 'ingresar' ? 'Ingresa para ver tus citas, mascotas y pedidos.' : 'Es gratis y solo toma un minuto.'}</p>
          <div className="account__tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'ingresar'} className={tab === 'ingresar' ? 'active' : ''} onClick={() => setTab('ingresar')}>
              Ingresar
            </button>
            <button role="tab" aria-selected={tab === 'registro'} className={tab === 'registro' ? 'active' : ''} onClick={() => setTab('registro')}>
              Crear cuenta
            </button>
          </div>
          <GoogleButton />
          {tab === 'ingresar' ? <LoginForm from={from} /> : <RegisterForm onDone={() => setTab('ingresar')} />}
        </div>
      </div>
    </section>
  )
}

// Campo con ícono a la izquierda; las contraseñas llevan además un botón para mostrarla.
function Entrada({ icon: Icon, children }) {
  return (
    <span className="entrada">
      <Icon size={18} className="entrada__icono" aria-hidden="true" />
      {children}
    </span>
  )
}

function EntradaPassword({ value, onChange, autoComplete, required }) {
  const [ver, setVer] = useState(false)
  return (
    <Entrada icon={Lock}>
      <input type={ver ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} required={required} maxLength={72} />
      <button type="button" className="entrada__ver" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={ver}>
        {ver ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </Entrada>
  )
}

function LoginForm({ from }) {
  const { login, verifyMfa } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState({ email: '', password: '' })
  const [desafio, setDesafio] = useState(null)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSending(true)
    setError('')
    try {
      if (desafio) {
        await verifyMfa(desafio, codigo)
        return navigate(from, { replace: true })
      }
      const r = await login(values.email, values.password)
      if (r.mfa) {
        setDesafio(r.desafio)
        return
      }
      navigate(from, { replace: true })
    } catch (err) {
      setError(err.message)
      // El desafío dura 5 min: si venció, se vuelve a pedir la contraseña.
      if (desafio && err.status === 401 && /Token|Desafío/i.test(err.message)) setDesafio(null)
    } finally {
      setSending(false)
    }
  }

  if (desafio) {
    return (
      <form className="account__form" onSubmit={submit}>
        <p>Tu cuenta tiene verificación en dos pasos. Escribe el código de 6 dígitos de tu app de autenticación.</p>
        <Field label="Código de verificación">
          <Entrada icon={ShieldCheck}>
            <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric"
              autoComplete="one-time-code" pattern="\d{6}" required autoFocus />
          </Entrada>
        </Field>
        {error && <p className="form-alert" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" disabled={sending || codigo.length !== 6}>{sending ? 'Verificando…' : 'Verificar'}</button>
        <button type="button" className="link-btn" onClick={() => { setDesafio(null); setCodigo(''); setError('') }}>Volver</button>
      </form>
    )
  }

  return (
    <form className="account__form" onSubmit={submit}>
      <Field label="Correo">
        <Entrada icon={Mail}>
          <input type="email" value={values.email} onChange={set('email')} autoComplete="email" placeholder="tu@correo.com" required maxLength={120} />
        </Entrada>
      </Field>
      <Field label="Contraseña">
        <EntradaPassword value={values.password} onChange={set('password')} autoComplete="current-password" required />
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
        <Entrada icon={User}>
          <input value={values.nombre} onChange={set('nombre')} autoComplete="name" maxLength={100} />
        </Entrada>
      </Field>
      <Field label="Correo" error={errors.email}>
        <Entrada icon={Mail}>
          <input type="email" value={values.email} onChange={set('email')} autoComplete="email" placeholder="tu@correo.com" maxLength={120} />
        </Entrada>
      </Field>
      <Field label="Contraseña" error={errors.password}>
        <EntradaPassword value={values.password} onChange={set('password')} autoComplete="new-password" />
      </Field>
      <Field label="Repite la contraseña" error={errors.confirm}>
        <EntradaPassword value={values.confirm} onChange={set('confirm')} autoComplete="new-password" />
      </Field>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" disabled={sending}>{sending ? 'Creando cuenta…' : 'Crear cuenta'}</button>
      <p className="account__hint">Mínimo 8 caracteres, con letras y números. Al crear tu cuenta aceptas los <Link to="/terminos">Términos</Link> y el <Link to="/privacidad">Aviso de privacidad</Link>.</p>
    </form>
  )
}
