import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ShieldCheck, ShieldAlert } from 'lucide-react'
import qrcode from 'qrcode-generator'
import PageHeader from '../../components/PageHeader'
import Field from '../../components/Field'
import Loading from '../../components/Loading'
import { useAuth } from '../../context/useAuth'
import { api } from '../../api'

export default function Security() {
  const { user, checking } = useAuth()
  if (checking) return <Loading />
  if (!user) return <Navigate to="/cuenta" state={{ from: '/cuenta/seguridad' }} replace />

  return (
    <>
      <PageHeader title="Seguridad de la cuenta" text="Verificación en dos pasos con una app de autenticación." />
      <section className="section">
        <div className="container account">
          {user.mfa ? <Desactivar /> : <Activar />}
          <Link to="/cuenta/pedidos" className="link-arrow">← Mis pedidos</Link>
        </div>
      </section>
    </>
  )
}

function Activar() {
  const { setMfa } = useAuth()
  const [config, setConfig] = useState(null)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  // El QR se dibuja en el navegador a partir de la URI otpauth://; el secreto no pasa por servicios externos.
  const qr = useMemo(() => {
    if (!config) return null
    const q = qrcode(0, 'M')
    q.addData(config.uri)
    q.make()
    return q.createDataURL(5, 2)
  }, [config])

  const empezar = async () => {
    setError('')
    try {
      setConfig(await api('/api/auth/mfa/configurar', { method: 'POST' }))
    } catch (e) {
      setError(e.message)
    }
  }

  const confirmar = async (e) => {
    e.preventDefault()
    setSending(true)
    setError('')
    try {
      await api('/api/auth/mfa/activar', { method: 'POST', body: { codigo } })
      setMfa(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  if (!config) {
    return (
      <div className="mfa">
        <p className="mfa__estado"><ShieldAlert size={22} /> La verificación en dos pasos está <strong>desactivada</strong>.</p>
        <p>Con ella, además de la contraseña se pide un código de 6 dígitos que cambia cada 30 segundos en tu teléfono
          (Google Authenticator, Authy, Microsoft Authenticator, 1Password…).</p>
        {error && <p className="form-alert">{error}</p>}
        <button className="btn btn--primary" onClick={empezar}>Activar verificación en dos pasos</button>
      </div>
    )
  }

  return (
    <form className="mfa account__form" onSubmit={confirmar}>
      <p>1. Escanea este código con tu app de autenticación:</p>
      <img className="mfa__qr" src={qr} alt="Código QR para configurar la app de autenticación" width="210" height="210" />
      <p className="account__hint">¿No puedes escanear? Escribe esta clave en la app: <code className="mono">{config.secreto.match(/.{1,4}/g).join(' ')}</code></p>
      <p>2. Escribe el código de 6 dígitos que muestra la app:</p>
      <Field label="Código">
        <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required />
      </Field>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" disabled={sending || codigo.length !== 6}>{sending ? 'Verificando…' : 'Confirmar y activar'}</button>
    </form>
  )
}

function Desactivar() {
  const { setMfa } = useAuth()
  const [values, setValues] = useState({ password: '', codigo: '' })
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setSending(true)
    setError('')
    try {
      await api('/api/auth/mfa/desactivar', { method: 'POST', body: values })
      setMfa(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="mfa account__form" onSubmit={submit}>
      <p className="mfa__estado mfa__estado--ok"><ShieldCheck size={22} /> La verificación en dos pasos está <strong>activa</strong>.</p>
      <p>Para desactivarla, confirma tu contraseña y un código vigente de la app.</p>
      <Field label="Contraseña">
        <input type="password" value={values.password} onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))} autoComplete="current-password" required />
      </Field>
      <Field label="Código de la app">
        <input value={values.codigo} onChange={(e) => setValues((v) => ({ ...v, codigo: e.target.value.replace(/\D/g, '').slice(0, 6) }))} inputMode="numeric" autoComplete="one-time-code" required />
      </Field>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <button className="btn btn--dark btn--block" disabled={sending}>{sending ? 'Desactivando…' : 'Desactivar'}</button>
    </form>
  )
}
