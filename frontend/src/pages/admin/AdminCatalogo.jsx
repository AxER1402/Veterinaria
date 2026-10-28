import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Search } from 'lucide-react'
import Loading from '../../components/Loading'
import { api } from '../../api'
import ProductoForm from './ProductoForm'
import AdminResenas from './AdminResenas'
import { categories } from '../../data/shop'

const normalizar = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export default function AdminCatalogo() {
  const [productos, setProductos] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [editando, setEditando] = useState(null) // 'nuevo', un producto o null
  const [buscar, setBuscar] = useState('')
  const [categoria, setCategoria] = useState('')

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

  const guardado = (producto) => {
    const existia = productos.some((p) => p.id === producto.id)
    setProductos((ps) => (existia ? ps.map((p) => (p.id === producto.id ? producto : p)) : [...ps, producto]))
    setEditando(null)
    setError('')
    setAviso(existia ? `Guardado «${producto.nombre}». Queda registrado en la bitácora.`
      : `Creado «${producto.nombre}» (${producto.variantes.map((v) => v.sku).join(', ')}). Queda registrado en la bitácora.`)
  }

  const visibles = useMemo(() => {
    const t = normalizar(buscar.trim())
    return (productos || []).filter((p) => (!categoria || p.categoria === categoria)
      && (!t || [p.nombre, p.marca, ...p.variantes.map((v) => v.sku)].some((x) => normalizar(x).includes(t))))
  }, [productos, buscar, categoria])

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
    <>
    <div className="admin-card">
      <div className="admin-card__head">
        <h2>Catálogo · precios y stock</h2>
        <button className="btn btn--primary btn--xs" onClick={() => setEditando('nuevo')}><Plus size={16} /> Nuevo producto</button>
      </div>
      <div className="admin-filters">
        <label className="search admin-search">
          <Search size={18} />
          <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre, marca o SKU" aria-label="Buscar producto" />
        </label>
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
        </select>
      </div>
      {editando && (
        <ProductoForm producto={editando === 'nuevo' ? null : editando} onClose={() => setEditando(null)} onSaved={guardado} />
      )}
      {error && <p className="form-alert" role="alert">{error}</p>}
      {aviso && <p className="form-ok" role="status">{aviso}</p>}
      {visibles.length === 0 && <p className="summary__hint">Ningún producto coincide con la búsqueda.</p>}
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th>Producto</th><th>SKU</th><th>Variante</th><th className="num">Precio</th><th className="num">Antes</th><th className="num">Stock</th><th /><th>Activo</th><th>Destacado</th></tr></thead>
          <tbody>
            {visibles.flatMap((p) => p.variantes.map((v, i) => (
              <VarianteFila key={v.id} producto={p} v={v} primera={i === 0} filas={p.variantes.length}
                onGuardar={(c) => guardarVariante(v, c)} onAlternar={(campo) => alternar(p, campo)} onEditar={() => setEditando(p)} />
            )))}
          </tbody>
        </table>
      </div>
    </div>
    <AdminResenas />
    </>
  )
}

function VarianteFila({ producto, v, primera, filas, onGuardar, onAlternar, onEditar }) {
  const [ocultar, setOcultar] = useState(false) // confirmación antes de sacarlo de la tienda
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
      {primera && (
        <td rowSpan={filas} className="catalog__product">
          <img src={producto.imagen} alt="" loading="lazy" />
          <span>
            <strong>{producto.nombre}</strong><small>{producto.marca}</small>
            <button className="link-btn" onClick={onEditar}><Pencil size={13} /> Editar</button>
          </span>
        </td>
      )}
      <td className="mono">{v.sku}</td>
      <td>{v.etiqueta}</td>
      <td className="num"><input type="number" min="0.01" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} aria-label={`Precio ${v.sku}`} /></td>
      <td className="num"><input type="number" min="0" step="0.01" value={antes} placeholder="—" onChange={(e) => setAntes(e.target.value)} aria-label={`Precio anterior ${v.sku}`} /></td>
      <td className="num"><input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} aria-label={`Stock ${v.sku}`} /></td>
      <td><button className="btn btn--dark btn--sm" disabled={!sucio} onClick={guardar}>Guardar</button></td>
      {primera && (
        <td rowSpan={filas}>
          {ocultar ? (
            <span className="catalog__confirm">
              ¿Ocultar de la tienda?
              <button className="btn btn--dark btn--xs" onClick={() => { setOcultar(false); onAlternar('activo') }}>Sí</button>
              <button className="link-btn" onClick={() => setOcultar(false)}>No</button>
            </span>
          ) : (
            <input type="checkbox" checked={producto.activo} aria-label={`Activo: ${producto.nombre}`}
              onChange={() => (producto.activo ? setOcultar(true) : onAlternar('activo'))} />
          )}
        </td>
      )}
      {primera && <td rowSpan={filas}><input type="checkbox" checked={producto.destacado} onChange={() => onAlternar('destacado')} aria-label={`Destacado: ${producto.nombre}`} /></td>}
    </tr>
  )
}
