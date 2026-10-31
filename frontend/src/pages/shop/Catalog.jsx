import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, SlidersHorizontal, X, PackageSearch } from 'lucide-react'
import PageHero from '../../components/PageHero'
import { images } from '../../data/content'
import ProductCard from '../../components/shop/ProductCard'
import { pets, categories, brands, minPrice, isOnSale } from '../../data/shop'
import { useShop } from '../../context/useShop'
import Loading from '../../components/Loading'
import Select from '../../components/Select'

const sorts = {
  relevancia: { label: 'Relevancia', fn: (a, b) => Number(!!b.featured) - Number(!!a.featured) },
  'precio-asc': { label: 'Precio: menor a mayor', fn: (a, b) => minPrice(a) - minPrice(b) },
  'precio-desc': { label: 'Precio: mayor a menor', fn: (a, b) => minPrice(b) - minPrice(a) },
  valoracion: { label: 'Mejor valorados', fn: (a, b) => b.rating - a.rating },
}

export default function Catalog() {
  const [params, setParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { products, catalogLoading, catalogError } = useShop()

  const pet = params.get('mascota') || ''
  const category = params.get('categoria') || ''
  const brand = params.get('marca') || ''
  const query = params.get('q') || ''
  const sale = params.get('oferta') === '1'
  const sort = sorts[params.get('orden')] ? params.get('orden') : 'relevancia'

  const update = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products
      .filter((p) => !pet || p.pet === pet)
      .filter((p) => !category || p.category === category)
      .filter((p) => !brand || p.brand === brand)
      .filter((p) => !sale || isOnSale(p))
      .filter((p) => !q || `${p.name} ${p.brand} ${p.description}`.toLowerCase().includes(q))
      .sort(sorts[sort].fn)
  }, [products, pet, category, brand, sale, query, sort])
  // Las marcas conocidas más las de productos nuevos que el admin haya creado.
  const brandList = useMemo(() => [...new Set([...brands, ...products.map((p) => p.brand)])], [products])

  const activeCount = [pet, category, brand, sale].filter(Boolean).length
  const petLabel = pets.find((p) => p.slug === pet)?.label

  return (
    <>
      <PageHero
        compacto
        cara="▼・ᴥ・▼"
        title={petLabel ? <>Productos para <span className="highlight">{petLabel.toLowerCase()}</span></> : <>Todo para <span className="highlight">tu mascota</span></>}
        text="Elegidos por nuestros veterinarios para cada tipo de mascota."
        image={images.cta}
        alt="Bulldog francés con sudadera amarilla"
        tag={catalogLoading ? null : <><strong>{results.length}</strong> {results.length === 1 ? 'producto' : 'productos'}</>}
      />
      <section className="section section--catalogo">
        <div className="container catalog">
          <aside className={`filters ${filtersOpen ? 'filters--open' : ''}`}>
            <div className="filters__header">
              <h3>Filtros</h3>
              <button onClick={() => setFiltersOpen(false)} aria-label="Cerrar filtros">
                <X />
              </button>
            </div>

            <FilterGroup title="Mascota">
              <Chip active={!pet} onClick={() => update('mascota', '')}>Todas</Chip>
              {pets.map((p) => (
                <Chip key={p.slug} active={pet === p.slug} onClick={() => update('mascota', p.slug)}>
                  {p.label}
                </Chip>
              ))}
            </FilterGroup>

            <FilterGroup title="Categoría">
              <Chip active={!category} onClick={() => update('categoria', '')}>Todas</Chip>
              {categories.map((c) => (
                <Chip key={c.slug} active={category === c.slug} onClick={() => update('categoria', c.slug)}>
                  {c.label}
                </Chip>
              ))}
            </FilterGroup>

            <FilterGroup title="Marca">
              <Select value={brand} onChange={(e) => update('marca', e.target.value)} className="select">
                <option value="">Todas las marcas</option>
                {brandList.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </Select>
            </FilterGroup>

            <label className="toggle">
              <input type="checkbox" checked={sale} onChange={(e) => update('oferta', e.target.checked ? '1' : '')} />
              <span /> Solo ofertas
            </label>

            {activeCount > 0 && (
              <button className="btn btn--outline btn--block" onClick={() => setParams({}, { replace: true })}>
                Limpiar filtros
              </button>
            )}
            <button className="btn btn--primary btn--block filters__apply" onClick={() => setFiltersOpen(false)}>
              Ver {results.length} productos
            </button>
          </aside>

          <div className="catalog__main">
            <div className="toolbar">
              <label className="search">
                <Search size={18} />
                <input
                  type="search"
                  placeholder="Buscar productos…"
                  value={query}
                  onChange={(e) => update('q', e.target.value)}
                  aria-label="Buscar productos"
                />
              </label>
              <button className="btn btn--outline btn--sm filters-toggle" onClick={() => setFiltersOpen(true)}>
                <SlidersHorizontal size={16} /> Filtros {activeCount > 0 && `(${activeCount})`}
              </button>
              <Select value={sort} onChange={(e) => update('orden', e.target.value)} className="select" aria-label="Ordenar">
                {Object.entries(sorts).map(([key, s]) => (
                  <option key={key} value={key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <p className="toolbar__count">
              {results.length} {results.length === 1 ? 'producto' : 'productos'}
            </p>

            {catalogLoading ? (
              <Loading />
            ) : catalogError ? (
              <div className="empty-state">
                <PackageSearch size={56} />
                <h3>No pudimos cargar el catálogo</h3>
                <p>{catalogError}. Intenta de nuevo en unos minutos.</p>
              </div>
            ) : results.length ? (
              <div className="products-grid products-grid--3">
                {results.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <PackageSearch size={56} />
                <h3>No encontramos productos</h3>
                <p>Prueba con otra búsqueda o quita algunos filtros.</p>
                <button className="btn btn--primary" onClick={() => setParams({}, { replace: true })}>
                  Ver todos los productos
                </button>
              </div>
            )}
          </div>
        </div>
        {filtersOpen && <div className="filters-overlay" onClick={() => setFiltersOpen(false)} />}
      </section>
    </>
  )
}

function FilterGroup({ title, children }) {
  return (
    <div className="filter-group">
      <h4>{title}</h4>
      <div className="filter-group__items">{children}</div>
    </div>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button className={`chip ${active ? 'chip--active' : ''}`} onClick={onClick} aria-pressed={active}>
      {children}
    </button>
  )
}
