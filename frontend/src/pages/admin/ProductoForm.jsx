import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Modal from '../../components/Modal'
import { api } from '../../api'
import { pets, categories, brands } from '../../data/shop'

const ETIQUETAS = ['Nuevo', 'Oferta', 'Más vendido']
const VARIANTE = { etiqueta: '', precio: '', precio_anterior: '', stock: '' }
const UNSPLASH = /^https:\/\/images\.unsplash\.com\/photo-[\w-]{10,80}(\?\S*)?$/

// Alta de producto. El servidor vuelve a validar todo y pone el slug y los SKU (HU-<id>-<n>).
export default function ProductoForm({ onClose, onCreated }) {
  const [values, setValues] = useState({
    nombre: '', marca: '', mascota: 'perro', categoria: 'alimento', descripcion: '',
    imagen_url: '', etiqueta: '', activo: true, destacado: false,
  })
  const [variantes, setVariantes] = useState([VARIANTE])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const setVariante = (i, f) => (e) => setVariantes((l) => l.map((v, j) => (j === i ? { ...v, [f]: e.target.value } : v)))
  const imagenValida = UNSPLASH.test(values.imagen_url.trim())

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      const d = await api('/api/catalogo/admin/productos', {
        method: 'POST',
        body: {
          ...values,
          imagen_url: values.imagen_url.trim(),
          etiqueta: values.etiqueta.trim() || null,
          variantes: variantes.map((v) => ({
            etiqueta: v.etiqueta,
            precio: Number(v.precio),
            precio_anterior: v.precio_anterior === '' ? null : Number(v.precio_anterior),
            stock: Number.parseInt(v.stock, 10),
          })),
        },
      })
      onCreated(d.producto)
    } catch (err) {
      setError(err.message)
      setSending(false)
    }
  }

  return (
    <Modal title="Nuevo producto" onClose={onClose} wide>
      <p className="modal__sub">Precios en quetzales. El producto queda registrado en la bitácora.</p>
      <form className="clinical-form" onSubmit={submit}>
        <label>Nombre
          <input value={values.nombre} onChange={set('nombre')} minLength={3} maxLength={150} required />
        </label>
        <div className="agenda__form-row agenda__form-row--3">
          <label>Marca
            <input list="marcas" value={values.marca} onChange={set('marca')} minLength={2} maxLength={60} required />
          </label>
          <label>Mascota
            <select value={values.mascota} onChange={set('mascota')}>
              {pets.map((p) => <option key={p.slug} value={p.slug}>{p.label}</option>)}
            </select>
          </label>
          <label>Categoría
            <select value={values.categoria} onChange={set('categoria')}>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <datalist id="marcas">{brands.map((b) => <option key={b} value={b} />)}</datalist>
        <label>Descripción
          <textarea rows="3" value={values.descripcion} onChange={set('descripcion')} minLength={10} maxLength={2000} required />
        </label>
        <div className="product-form__image">
          <label>Imagen
            <input type="url" value={values.imagen_url} onChange={set('imagen_url')} placeholder="https://images.unsplash.com/photo-…" required />
            <small>En Unsplash: clic derecho sobre la foto → «Copiar dirección de la imagen».</small>
          </label>
          {imagenValida ? <img src={values.imagen_url.trim()} alt="Vista previa" /> : <span aria-hidden="true" />}
        </div>
        <div className="agenda__form-row agenda__form-row--3">
          <label>Etiqueta (opcional)
            <input list="etiquetas" value={values.etiqueta} onChange={set('etiqueta')} maxLength={40} />
          </label>
          <label className="check-row"><input type="checkbox" checked={values.activo} onChange={set('activo')} /> Visible en la tienda</label>
          <label className="check-row"><input type="checkbox" checked={values.destacado} onChange={set('destacado')} /> Destacado</label>
        </div>
        <datalist id="etiquetas">{ETIQUETAS.map((t) => <option key={t} value={t} />)}</datalist>

        <fieldset className="clinical-form__vaccines">
          <legend>Presentaciones (talla, peso, tamaño…)</legend>
          {variantes.map((v, i) => (
            <div key={i} className="variant-row">
              <label>Presentación
                <input value={v.etiqueta} onChange={setVariante(i, 'etiqueta')} placeholder="2 kg, M, Única…" maxLength={40} required />
              </label>
              <label>Precio (Q)
                <input type="number" min="0.01" max="99999.99" step="0.01" inputMode="decimal" value={v.precio} onChange={setVariante(i, 'precio')} required />
              </label>
              <label>Precio antes (Q)
                <input type="number" min="0.01" max="99999.99" step="0.01" inputMode="decimal" value={v.precio_anterior} onChange={setVariante(i, 'precio_anterior')} placeholder="—" />
              </label>
              <label>Stock
                <input type="number" min="0" max="100000" step="1" inputMode="numeric" value={v.stock} onChange={setVariante(i, 'stock')} required />
              </label>
              <button type="button" className="icon-btn icon-btn--ghost" aria-label={`Quitar presentación ${i + 1}`}
                disabled={variantes.length === 1} onClick={() => setVariantes((l) => l.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
          {variantes.length < 10 && (
            <button type="button" className="pet-picker__add" onClick={() => setVariantes((l) => [...l, VARIANTE])}>
              <Plus size={16} /> Agregar presentación
            </button>
          )}
        </fieldset>

        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="pet-form__actions">
          <button className="btn btn--dark btn--sm" disabled={sending}>{sending ? 'Guardando…' : 'Crear producto'}</button>
          <button type="button" className="link-btn" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </Modal>
  )
}
