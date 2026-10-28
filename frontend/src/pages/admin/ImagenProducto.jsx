import { useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { api } from '../../api'

const TIPOS = ['image/jpeg', 'image/png', 'image/webp']
const MAX_MB = 5
const UNSPLASH = /^https:\/\/images\.unsplash\.com\/photo-[\w-]{10,80}(\?\S*)?$/
const CLOUDINARY = /^https:\/\/res\.cloudinary\.com\//

// Foto del producto. El servidor firma la subida (el secreto de Cloudinary no sale de catalogo-service)
// y el navegador la sube directo a Cloudinary. Si Cloudinary no está configurado, queda la URL de Unsplash.
export default function ImagenProducto({ value, onChange }) {
  const input = useRef(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')
  const [manual, setManual] = useState(() => UNSPLASH.test(value.imagen_url))
  const url = value.imagen_url.trim()
  const vista = UNSPLASH.test(url) || CLOUDINARY.test(url) ? url : null

  const subir = async (e) => {
    const archivo = e.target.files[0]
    e.target.value = ''
    if (!archivo) return
    setError('')
    if (!TIPOS.includes(archivo.type)) return setError('Usa una foto JPG, PNG o WebP.')
    if (archivo.size > MAX_MB * 1024 * 1024) return setError(`La foto pesa más de ${MAX_MB} MB.`)
    setSubiendo(true)
    try {
      const f = await api('/api/catalogo/admin/imagenes/firma', { method: 'POST' })
      const datos = new FormData()
      datos.append('file', archivo)
      for (const k of ['api_key', 'timestamp', 'signature', 'folder']) datos.append(k, f[k])
      const res = await fetch(f.upload_url, { method: 'POST', body: datos })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.secure_url) throw new Error(json?.error?.message || 'Cloudinary rechazó la foto')
      onChange({ imagen_url: json.secure_url, imagen_public_id: json.public_id })
    } catch (err) {
      setError(err.status === 503 ? 'La subida de fotos no está configurada: pega una URL de Unsplash.' : err.message)
      if (err.status === 503) setManual(true)
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <div className="product-form__image">
      <div className="product-form__image-fields">
        <span className="product-form__label">Imagen</span>
        <input ref={input} type="file" accept={TIPOS.join(',')} onChange={subir} hidden />
        <button type="button" className="pet-picker__add" onClick={() => input.current.click()} disabled={subiendo}>
          <ImagePlus size={16} /> {subiendo ? 'Subiendo…' : vista ? 'Cambiar foto' : 'Subir foto'}
        </button>
        <small>JPG, PNG o WebP de hasta {MAX_MB} MB. Mejor cuadrada y con fondo claro.</small>
        {manual ? (
          <label>URL de Unsplash
            <input type="url" value={value.imagen_url} placeholder="https://images.unsplash.com/photo-…"
              onChange={(e) => onChange({ imagen_url: e.target.value, imagen_public_id: null })} />
          </label>
        ) : (
          <button type="button" className="link-btn" onClick={() => setManual(true)}>O pegar una URL de Unsplash</button>
        )}
        {error && <small className="field-error" role="alert">{error}</small>}
      </div>
      {vista ? <img src={vista} alt="Vista previa" /> : <span aria-hidden="true" />}
    </div>
  )
}
