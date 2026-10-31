import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Modal from '../../components/Modal'
import ImagenProducto from './ImagenProducto'
import { api } from '../../api'
import { pets, categories, brands } from '../../data/shop'
import Select from '../../components/Select'

const ETIQUETAS = ['Nuevo', 'Oferta', 'Más vendido']
const VARIANTE = { etiqueta: '', precio: '', precio_anterior: '', stock: '' }

const CAMPOS = ['nombre', 'marca', 'mascota', 'categoria', 'descripcion', 'imagen_url', 'etiqueta', 'destacado']

// Alta o edición de un producto. El servidor vuelve a validar todo y pone el slug y los SKU (HU-<id>-<n>).
// Al editar, precio y stock de las presentaciones existentes se cambian en la tabla; aquí se agregan nuevas.
export default function ProductoForm({ producto, onClose, onSaved }) {
  const inicial = producto
    ? { ...Object.fromEntries(CAMPOS.map((k) => [k, producto[k] ?? ''])), imagen_public_id: null, activo: producto.activo }
    : { nombre: '', marca: '', mascota: 'perro', categoria: 'alimento', descripcion: '', imagen_url: '', imagen_public_id: null, etiqueta: '', activo: true, destacado: false }
  const [values, setValues] = useState(inicial)
  const [variantes, setVariantes] = useState(producto ? [] : [VARIANTE])
  const dirty = CAMPOS.some((k) => values[k] !== inicial[k]) || variantes.some((v) => v.etiqueta || v.precio || v.stock)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const setVariante = (i, f) => (e) => setVariantes((l) => l.map((v, j) => (j === i ? { ...v, [f]: e.target.value } : v)))
  const variantesBody = () => variantes.filter((v) => !producto || v.etiqueta.trim()).map((v) => ({
    etiqueta: v.etiqueta,
    precio: Number(v.precio),
    precio_anterior: v.precio_anterior === '' ? null : Number(v.precio_anterior),
    stock: Number.parseInt(v.stock, 10),
  }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      const body = { ...values, imagen_url: values.imagen_url.trim(), etiqueta: values.etiqueta.trim() || null }
      let d
      if (producto) {
        // Solo se manda lo que cambió: así la bitácora registra exactamente eso.
        const cambios = Object.fromEntries(CAMPOS.filter((k) => values[k] !== inicial[k]).map((k) => [k, body[k]]))
        if (cambios.imagen_url) cambios.imagen_public_id = values.imagen_public_id
        d = Object.keys(cambios).length ? await api(`/api/catalogo/admin/productos/${producto.id}`, { method: 'PATCH', body: cambios }) : { producto }
        const nuevas = variantesBody()
        if (nuevas.length) d = await api(`/api/catalogo/admin/productos/${producto.id}/variantes`, { method: 'POST', body: { variantes: nuevas } })
      } else {
        d = await api('/api/catalogo/admin/productos', { method: 'POST', body: { ...body, variantes: variantesBody() } })
      }
      onSaved(d.producto)
    } catch (err) {
      setError(err.message)
      setSending(false)
    }
  }

  return (
    <Modal title={producto ? `Editar «${producto.nombre}»` : 'Nuevo producto'} onClose={onClose} wide dirty={dirty && !sending}>
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
            <Select value={values.mascota} onChange={set('mascota')}>
              {pets.map((p) => <option key={p.slug} value={p.slug}>{p.label}</option>)}
            </Select>
          </label>
          <label>Categoría
            <Select value={values.categoria} onChange={set('categoria')}>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </Select>
          </label>
        </div>
        <datalist id="marcas">{brands.map((b) => <option key={b} value={b} />)}</datalist>
        <label>Descripción
          <textarea rows="3" value={values.descripcion} onChange={set('descripcion')} minLength={10} maxLength={2000} required />
        </label>
        <ImagenProducto value={values} onChange={(img) => setValues((v) => ({ ...v, ...img }))} />
        <div className="agenda__form-row agenda__form-row--3">
          <label>Etiqueta (opcional)
            <input list="etiquetas" value={values.etiqueta} onChange={set('etiqueta')} maxLength={40} />
          </label>
          {!producto && <label className="check-row"><input type="checkbox" checked={values.activo} onChange={set('activo')} /> Visible en la tienda</label>}
          <label className="check-row"><input type="checkbox" checked={values.destacado} onChange={set('destacado')} /> Destacado</label>
        </div>
        <datalist id="etiquetas">{ETIQUETAS.map((t) => <option key={t} value={t} />)}</datalist>

        <fieldset className="clinical-form__vaccines">
          <legend>{producto ? 'Presentaciones' : 'Presentaciones (talla, peso, tamaño…)'}</legend>
          {producto && (
            <p className="summary__hint">
              Ya tiene: {producto.variantes.map((v) => v.etiqueta).join(', ')}. Su precio y stock se cambian en la tabla del catálogo.
            </p>
          )}
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
                disabled={!producto && variantes.length === 1} onClick={() => setVariantes((l) => l.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
          {variantes.length + (producto?.variantes.length || 0) < 10 && (
            <button type="button" className="pet-picker__add" onClick={() => setVariantes((l) => [...l, VARIANTE])}>
              <Plus size={16} /> Agregar presentación
            </button>
          )}
        </fieldset>

        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="pet-form__actions">
          <button className="btn btn--dark btn--sm" disabled={sending}>{sending ? 'Guardando…' : producto ? 'Guardar cambios' : 'Crear producto'}</button>
          <button type="button" className="link-btn" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </Modal>
  )
}
