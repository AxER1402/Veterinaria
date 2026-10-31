import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Plus, Search, Star } from 'lucide-react'
import Loading from '../../components/Loading'
import { api } from '../../api'
import ProductoForm from './ProductoForm'
import AdminResenas from './AdminResenas'
import { categories, formatPrice } from '../../data/shop'
import MenuAcciones from '../../components/MenuAcciones'
import Select from '../../components/Select'
import Subvistas from './Subvistas'

const normalizar = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export default function AdminCatalogo() {
  const [vista, setVista] = useState('productos')
  return (
    <>
      <Subvistas vistas={[{ id: 'productos', label: 'Productos' }, { id: 'resenas', label: 'Reseñas' }]} activa={vista} onChange={setVista} />
      {vista === 'productos' ? <Productos /> : <AdminResenas />}
    </>
  )
}

function Productos() {
  const [productos, setProductos] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [editando, setEditando] = useState(null) // 'nuevo', un producto o null
  const [buscar, setBuscar] = useState('')
  const [categoria, setCategoria] = useState('')
  const [abierto, setAbierto] = useState(null)

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
      <div className="barra">
        <label className="search admin-search">
          <Search size={18} />
          <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre, marca o SKU" aria-label="Buscar producto" />
        </label>
        <Select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
        </Select>
        <span className="barra__total">{visibles.length} {visibles.length === 1 ? 'producto' : 'productos'}</span>
        <button className="btn btn--primary btn--xs barra__fin" onClick={() => setEditando('nuevo')}><Plus size={16} /> Nuevo producto</button>
      </div>
      {editando && (
        <ProductoForm producto={editando === 'nuevo' ? null : editando} onClose={() => setEditando(null)} onSaved={guardado} />
      )}
      {error && <p className="form-alert" role="alert">{error}</p>}
      {aviso && <p className="form-ok" role="status">{aviso}</p>}
      {visibles.length === 0 ? (
        <div className="vacio"><Search size={32} aria-hidden="true" /><p>Ningún producto coincide con la búsqueda.</p></div>
      ) : (
        <ul className="lista">
          {visibles.map((p) => (
            <ProductoFila key={p.id} producto={p} abierto={abierto === p.id} onAbrir={() => setAbierto(abierto === p.id ? null : p.id)}
              onGuardar={guardarVariante} onAlternar={(campo) => alternar(p, campo)} onEditar={() => setEditando(p)} />
          ))}
        </ul>
      )}
    </>
  )
}

const POCAS = 5

function ProductoFila({ producto: p, abierto, onAbrir, onGuardar, onAlternar, onEditar }) {
  const [ocultar, setOcultar] = useState(false) // confirmación antes de sacarlo de la tienda
  const precios = p.variantes.map((v) => Number(v.precio))
  const min = Math.min(...precios)
  const max = Math.max(...precios)
  const stock = p.variantes.reduce((n, v) => n + Number(v.stock), 0)
  const agotadas = p.variantes.filter((v) => Number(v.stock) === 0).length
  return (
    <li className={`producto ${p.activo ? '' : 'is-apagada'}`}>
      <div className="producto__fila">
        <img src={p.imagen} alt="" loading="lazy" />
        <span className="fila__principal"><strong>{p.nombre}</strong><small>{p.marca} · {p.variantes.length} {p.variantes.length === 1 ? 'presentación' : 'presentaciones'}</small></span>
        <span className="producto__precio">{formatPrice(min)}{max > min && <small>a {formatPrice(max)}</small>}</span>
        <span className="producto__stock">
          {stock === 0 ? <span className="status status--bad">Agotado</span>
            : agotadas > 0 ? <span className="status status--warn">{agotadas} sin stock</span>
              : stock <= POCAS ? <span className="status status--warn">Quedan {stock}</span> : <>{stock} <small>en stock</small></>}
        </span>
        <span className="producto__acciones">
          <button type="button" className={`producto__estrella ${p.destacado ? 'is-activa' : ''}`} aria-pressed={p.destacado} aria-label={`Destacado: ${p.nombre}`} title="Destacado en la tienda" onClick={() => onAlternar('destacado')}>
            <Star size={18} aria-hidden="true" />
          </button>
          <label className="toggle" title={p.activo ? 'Visible en la tienda' : 'Oculto en la tienda'}>
            <input type="checkbox" checked={p.activo} aria-label={`Visible en la tienda: ${p.nombre}`}
              onChange={() => (p.activo ? setOcultar(true) : onAlternar('activo'))} />
            <span />
          </label>
          <button type="button" className="btn btn--ghost btn--xs" aria-expanded={abierto} onClick={onAbrir}>
            Precios <ChevronDown size={14} className={abierto ? 'gira' : ''} aria-hidden="true" />
          </button>
          <MenuAcciones etiqueta={`Más opciones de ${p.nombre}`} items={[{ label: 'Editar producto', onClick: onEditar }]} />
        </span>
      </div>
      {ocultar && (
        <p className="producto__confirmar">
          ¿Ocultar «{p.nombre}» de la tienda?
          <button className="btn btn--dark btn--xs" onClick={() => { setOcultar(false); onAlternar('activo') }}>Sí, ocultar</button>
          <button className="link-btn" onClick={() => setOcultar(false)}>No</button>
        </p>
      )}
      {abierto && (
        <div className="variantes">
          <div className="variantes__cabeza" aria-hidden="true"><span>Presentación</span><span>Precio (Q)</span><span>Antes (Q)</span><span>Stock</span><span /></div>
          {p.variantes.map((v) => <VarianteFila key={v.id} v={v} onGuardar={(c) => onGuardar(v, c)} />)}
        </div>
      )}
    </li>
  )
}

function VarianteFila({ v, onGuardar }) {
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
    <div className={`variante ${Number(v.stock) === 0 ? 'is-agotada' : ''}`}>
      <span className="fila__principal"><strong>{v.etiqueta}</strong><small className="mono">{v.sku}</small></span>
      <label><span>Precio</span><input type="number" min="0.01" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} aria-label={`Precio ${v.sku}`} /></label>
      <label><span>Antes</span><input type="number" min="0" step="0.01" value={antes} placeholder="—" onChange={(e) => setAntes(e.target.value)} aria-label={`Precio anterior ${v.sku}`} /></label>
      <label><span>Stock</span><input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} aria-label={`Stock ${v.sku}`} /></label>
      <button className="btn btn--dark btn--xs" disabled={!sucio} onClick={guardar}>Guardar</button>
    </div>
  )
}
