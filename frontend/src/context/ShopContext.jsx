import { useEffect, useMemo, useReducer, useState } from 'react'
import { reducer, loadState, saveState, cartLines, cartTotals } from './cart'
import { ShopContext } from './useShop'
import { api } from '../api'
import { fromApi } from '../data/shop'

export function ShopProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [catalog, setCatalog] = useState({ products: [], loading: true, error: null })

  useEffect(() => saveState(state), [state])

  useEffect(() => {
    api('/api/catalogo/productos', { auth: false })
      .then((d) => setCatalog({ products: d.productos.map(fromApi), loading: false, error: null }))
      .catch((e) => setCatalog({ products: [], loading: false, error: e.message }))
  }, [])

  const value = useMemo(() => {
    const { products } = catalog
    const lines = cartLines(state.cart, products)
    return {
      products,
      catalogLoading: catalog.loading,
      catalogError: catalog.error,
      findProduct: (slug) => products.find((p) => p.slug === slug),
      lines,
      totals: cartTotals(lines, state.coupon),
      wishlist: state.wishlist,
      coupon: state.coupon,
      drawerOpen,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
      addToCart: (id, variant, qty = 1) => {
        dispatch({ type: 'add', id, variant, qty })
        setDrawerOpen(true)
      },
      setQty: (key, qty) => dispatch({ type: 'setQty', key, qty }),
      removeFromCart: (key) => dispatch({ type: 'remove', key }),
      clearCart: () => dispatch({ type: 'clear' }),
      toggleWish: (id) => dispatch({ type: 'toggleWish', id }),
      isWished: (id) => state.wishlist.includes(id),
      applyCoupon: (coupon) => dispatch({ type: 'setCoupon', coupon }),
    }
  }, [state, drawerOpen, catalog])

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>
}
