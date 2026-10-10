import { useEffect, useMemo, useReducer, useState } from 'react'
import { reducer, loadState, saveState, cartLines, cartTotals } from './cart'
import { ShopContext } from './useShop'

export function ShopProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => saveState(state), [state])

  const value = useMemo(() => {
    const lines = cartLines(state.cart)
    return {
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
      applyCoupon: (code) => dispatch({ type: 'setCoupon', code }),
    }
  }, [state, drawerOpen])

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>
}
