import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import Loading from '../../components/Loading'
import { api } from '../../api'
import ProductoForm from './ProductoForm'

export default function AdminCatalogo() {
  const [productos, setProductos] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [nuevo, setNuevo] = useState(false)

  useEffect(() => {
    api('/api/catalogo/admin/productos').then((d) => setProductos(d.productos)).catch((e) => setError(e.message))
  }, [])

  const reemplazar = (producto) => setProductos((ps) => ps.map((p) => (p.id === producto.id ? producto : p)))

  const guardarVariante = async (v, cambios) => {
    try {
      const d = await api(`/api/catalogo/admin/variantes/${v.id}`, { method: 'PATCH', body: cambios })
      reemplazar(d.producto)
      setError('')
      setAviso(`Guardado ${v.sku}. Queda registrado en la bitácora.`)
    } catch (e) {
      setAviso('')
      setError(`${v.sku}: ${e.message}`)
    }
  }

  const creado = (producto) => {
    setProductos((ps) => [...ps, producto])
    setNuevo(false)
    setError('')
    setAviso(`Creado «${producto.nombre}» (${producto.variantes.map((v) => v.sku).join(', ')}). Queda registrado en la bitácora.`)
  }

  const alternar = async (p, campo) => {
    try {
      const d = await api(`/api/catalogo/admin/productos/${p.id}`, { method: 'PATCH', body: { [campo]: !p[campo] } })
      reemplazar(d.producto)
    } catch (e) {
      setError(e.message)
    }
  }

  if (!productos) return error ? <p className="form-alert">{error}</p> : <Loading />

  return (
    <div className="admin-card">
      <div className="admin-card__head">
        <h2>Catálogo · precios y stock</h2>
        <button className="btn btn--primary btn--xs" onClick={() => setNuevo(true)}><Plus size={16} /> Nuevo producto</button>
      </div>
      {nuevo && <ProductoForm onClose={() => setNuevo(false)} onCreated={creado} />}
      {error && <p className="form-alert" role="alert">{error}</p>}
      {aviso && <p className="form-ok" role="status">{aviso}</p>}
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th>Producto</th><th>SKU</th><th>Variante</th><th className="num">Precio</th><th className="num">Antes</th><th className="num">Stock</th><th /><th>Activo</th><th>Destacado</th></tr></thead>
          <tbody>
            {productos.flatMap((p) => p.variantes.map((v, i) => (
              <VarianteFila key={v.id} producto={p} v={v} primera={i === 0} filas={p.variantes.length}
                onGuardar={(c) => guardarVariante(v, c)} onAlternar={(campo) => alternar(p, campo)} />
            )))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function VarianteFila({ producto, v, primera, filas, onGuardar, onAlternar }) {
  const [precio, setPrecio] = useState(String(v.precio))
  const [antes, setAntes] = useState(v.precio_anterior === null ? '' : String(v.precio_anterior))
  const [stock, setStock] = useState(String(v.stock))
  const sucio = precio !== String(v.precio) || antes !== (v.precio_anterior === null ? '' : String(v.precio_anterior)) || stock !== String(v.stock)

  const guardar = () => {
    const cambios = {}
    if (precio !== String(v.precio)) cambios.precio = Number(precio)
    if (antes !== (v.precio_anterior === null ? '' : String(v.precio_anterior))) cambios.precio_anterior = antes === '' ? null : Number(antes)
    if (stock !== String(v.stock)) cambios.stock = Number.parseInt(stock, 10)
    onGuardar(cambios)
  }

  return (
    <tr className={v.stock === 0 ? 'is-out' : ''}>
      {primera && <td rowSpan={filas}><strong>{producto.nombre}</strong><small>{producto.marca}</small></td>}
      <td className="mono">{v.sku}</td>
      <td>{v.etiqueta}</td>
      <td className="num"><input type="number" min="0.01" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} aria-label={`Precio ${v.sku}`} /></td>
      <td className="num"><input type="number" min="0" step="0.01" value={antes} placeholder="—" onChange={(e) => setAntes(e.target.value)} aria-label={`Precio anterior ${v.sku}`} /></td>
      <td className="num"><input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} aria-label={`Stock ${v.sku}`} /></td>
      <td><button className="btn btn--dark btn--sm" disabled={!sucio} onClick={guardar}>Guardar</button></td>
      {primera && <td rowSpan={filas}><input type="checkbox" checked={producto.activo} onChange={() => onAlternar('activo')} aria-label={`Activo: ${producto.nombre}`} /></td>}
      {primera && <td rowSpan={filas}><input type="checkbox" checked={producto.destacado} onChange={() => onAlternar('destacado')} aria-label={`Destacado: ${producto.nombre}`} /></td>}
    </tr>
  )
}
