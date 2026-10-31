import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/useAuth'

const SCRIPT = 'https://accounts.google.com/gsi/client'
const ANCHO_MAX = 400 // el que permite Google

let script
function cargarScript() {
  script ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT
    s.async = true
    s.onload = resolve
    s.onerror = () => {
      script = null
      reject(new Error('No se pudo cargar Google'))
    }
    document.head.appendChild(s)
  })
  return script
}

// «Continuar con Google» para clientes. Solo aparece si el servidor tiene GOOGLE_CLIENT_ID; si Google
// no carga, sigue disponible el formulario con correo y contraseña.
export default function GoogleButton() {
  const { loginGoogle } = useAuth()
  const contenedor = useRef(null)
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true
    ;(async () => {
      try {
        const { client_id: clientId } = await api('/api/auth/google/config', { auth: false })
        if (!clientId) return
        await cargarScript()
        if (!vigente) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            setError('')
            loginGoogle(credential).catch((e) => setError(e.message))
          },
        })
        window.google.accounts.id.renderButton(contenedor.current, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          locale: 'es',
          width: Math.min(contenedor.current.offsetWidth, ANCHO_MAX),
        })
        setVisible(true)
      } catch {
        // Sin botón: el formulario de abajo no depende de Google.
      }
    })()
    return () => {
      vigente = false
    }
  }, [loginGoogle])

  return (
    <div className="account__google">
      <div ref={contenedor} className="account__google-boton" />
      {error && <p className="form-alert" role="alert">{error}</p>}
      {visible && <p className="account__separador"><span>o con tu correo</span></p>}
    </div>
  )
}
