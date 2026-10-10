import { FREE_SHIPPING_FROM, SHIPPING_COST } from '../data/shop'

const STORAGE_KEY = 'huellitas-shop'

export const initialState = { cart: [], wishlist: [], coupon: null }

export function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (!saved) return initialState
    // Versiones anteriores guardaban el cupón como texto; ahora es el objeto que valida la API.
    return { ...initialState, ...saved, coupon: typeof saved.coupon === 'object' ? saved.coupon : null }
  } catch {
    return initialState
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Almacenamiento no disponible (modo privado): el carrito vive solo en memoria.
  }
}

export function reducer(state, action) {
  switch (action.type) {
    case 'add': {
      const key = `${action.id}:${action.variant}`
      const exists = state.cart.find((i) => i.key === key)
      const cart = exists
        ? state.cart.map((i) => (i.key === key ? { ...i, qty: i.qty + action.qty } : i))
        : [...state.cart, { key, id: action.id, variant: action.variant, qty: action.qty }]
      return { ...state, cart }
    }
    case 'setQty':
      return {
        ...state,
        cart: state.cart
          .map((i) => (i.key === action.key ? { ...i, qty: Math.min(99, action.qty) } : i))
          .filter((i) => i.qty > 0),
      }
    case 'remove':
      return { ...state, cart: state.cart.filter((i) => i.key !== action.key) }
    case 'clear':
      return { ...state, cart: [], coupon: null }
    case 'toggleWish':
      return {
        ...state,
        wishlist: state.wishlist.includes(action.id)
          ? state.wishlist.filter((id) => id !== action.id)
          : [...state.wishlist, action.id],
      }
    case 'setCoupon':
      return { ...state, coupon: action.coupon }
    default:
      return state
  }
}

// Vista previa en el navegador: el total que se cobra lo calcula pedidos-service.
// Une cada línea del carrito con los datos del producto y su variante.
export function cartLines(cart, products) {
  return cart
    .map((item) => {
      const product = products.find((p) => p.id === item.id)
      const variant = product?.variants.find((v) => v.label === item.variant)
      if (!product || !variant) return null
      return { ...item, product, variant, total: variant.price * item.qty }
    })
    .filter(Boolean)
}

export function cartTotals(lines, coupon) {
  const subtotal = lines.reduce((sum, l) => sum + l.total, 0)
  const eligible = coupon
    ? lines.filter((l) => !coupon.marca || l.product.brand === coupon.marca).reduce((s, l) => s + l.total, 0)
    : 0
  const discount = coupon ? round(eligible * (coupon.porcentaje / 100)) : 0
  const afterDiscount = subtotal - discount
  const shipping = lines.length === 0 || afterDiscount >= FREE_SHIPPING_FROM ? 0 : SHIPPING_COST
  return {
    subtotal,
    discount,
    shipping,
    total: round(afterDiscount + shipping),
    count: lines.reduce((n, l) => n + l.qty, 0),
    missingForFreeShipping: Math.max(0, FREE_SHIPPING_FROM - afterDiscount),
  }
}

const round = (n) => Math.round(n * 100) / 100
