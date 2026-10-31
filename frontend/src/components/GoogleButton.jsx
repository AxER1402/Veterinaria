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
  // Empieza visible para reservar su lugar: Google tarda casi un segundo y el formulario no debe saltar.
  const [visible, setVisible] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true
    ;(async () => {
      try {
        const { client_id: clientId } = await api('/api/auth/google/config', { auth: false })
        if (!clientId) return setVisible(false)
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
      } catch {
        // Sin botón: el formulario de abajo no depende de Google.
        if (vigente) setVisible(false)
      }
    })()
    return () => {
      vigente = false
    }
  }, [loginGoogle])

  if (!visible) return null

  return (
    <div className="account__google">
      <div className="account__google-lugar">
        <span className="account__google-provisional" aria-hidden="true">Continuar con Google</span>
        <div ref={contenedor} className="account__google-boton" />
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <p className="account__separador"><span>o con tu correo</span></p>
    </div>
  )
}
