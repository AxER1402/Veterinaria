const img = (id, w = 600) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&h=${w}&q=75`

export const formatPrice = (value) =>
  new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(value)

export const FREE_SHIPPING_FROM = 400
export const SHIPPING_COST = 35

export const pets = [
  { slug: 'perro', label: 'Perros', image: img('photo-1537151625747-768eb6cf92b2', 300) },
  { slug: 'gato', label: 'Gatos', image: img('photo-1514888286974-6c03e2ca1dba', 300) },
  { slug: 'pequenos', label: 'Pequeños', image: img('photo-1425082661705-1834bfd09dca', 300) },
  { slug: 'peces', label: 'Peces', image: img('photo-1646116942588-dc98e6cb8b7b', 300) },
  { slug: 'reptiles', label: 'Reptiles', image: img('photo-1762606774489-94d5316024f6', 300) },
  { slug: 'aves', label: 'Aves', image: img('photo-1685790846266-d094716fd3c9', 300) },
]

export const categories = [
  { slug: 'alimento', label: 'Alimento' },
  { slug: 'snacks', label: 'Snacks y premios' },
  { slug: 'juguetes', label: 'Juguetes' },
  { slug: 'accesorios', label: 'Accesorios' },
]

export const brands = ['NutriHuella', 'Bosque Salvaje', 'Bocadito', 'Gatuno', 'AquaViva', 'PlumaFeliz', 'Roedor Pro', 'Escama']

// Productos, precios, stock y cupones viven en la API (catalogo-service y pedidos-service).
// Convierte un producto de la API al formato que usan los componentes.
export const fromApi = (p) => ({
  id: p.id,
  slug: p.slug,
  name: p.nombre,
  brand: p.marca,
  pet: p.mascota,
  category: p.categoria,
  description: p.descripcion,
  image: p.imagen,
  rating: p.calificacion,
  reviews: p.resenas,
  badge: p.etiqueta,
  featured: p.destacado,
  variants: p.variantes.map((v) => ({
    id: v.id,
    label: v.etiqueta,
    price: v.precio,
    oldPrice: v.precio_anterior,
    available: v.disponible,
    few: v.pocas_unidades,
  })),
})

export const tips = [
  {
    title: 'Cómo enseñar a tu perro a sentarse en 5 pasos',
    excerpt: 'Enseñar a sentarse es uno de los comandos básicos más fáciles y un gran punto de partida para el entrenamiento.',
    image: img('photo-1552053831-71594a27632d', 600),
    tag: 'Entrenamiento',
  },
  {
    title: 'Qué alimento elegir según la edad de tu mascota',
    excerpt: 'Cachorro, adulto o senior: cada etapa tiene necesidades nutricionales distintas. Te explicamos cómo elegir.',
    image: img('photo-1632236568054-12f36ecee2f6', 600),
    tag: 'Nutrición',
  },
  {
    title: 'Mantén a tu gato activo dentro de casa',
    excerpt: 'Juegos, rascadores y rutinas sencillas para que tu gato se mantenga en forma y feliz sin salir de casa.',
    image: img('photo-1708979346185-5f3235e1becd', 600),
    tag: 'Bienestar',
  },
]

export const minPrice = (p) => Math.min(...p.variants.map((v) => v.price))
export const maxPrice = (p) => Math.max(...p.variants.map((v) => v.price))
export const isOnSale = (p) => p.variants.some((v) => v.oldPrice)
