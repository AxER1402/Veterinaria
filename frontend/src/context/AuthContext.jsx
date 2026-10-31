import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler } from '../api'
import { AuthContext } from './useAuth'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // Si hay token guardado, se valida contra /me antes de dar la sesión por buena.
  const [checking, setChecking] = useState(() => Boolean(getToken()))

  const clear = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(clear)
    if (!getToken()) return
    api('/api/auth/me')
      .then((d) => setUser(d.usuario))
      .catch(clear)
      .finally(() => setChecking(false))
  }, [clear])

  const value = useMemo(
    () => ({
      user,
      checking,
      isAdmin: user?.rol === 'admin',
      // Personal del panel: cada rol ve sus secciones (el servidor vuelve a revisar cada acción).
      isStaff: ['admin', 'veterinario', 'recepcion', 'tienda'].includes(user?.rol),
      setPerfil: (cambios) => setUser((u) => (u ? { ...u, ...cambios } : u)),
      // Devuelve el usuario, o { mfa: true, desafio } si la cuenta tiene verificación en dos pasos.
      login: async (email, password) => {
        const d = await api('/api/auth/login', { method: 'POST', body: { email, password }, auth: false })
        if (d.mfa_requerido) return { mfa: true, desafio: d.desafio }
        setToken(d.token)
        setUser(d.usuario)
        return d.usuario
      },
      verifyMfa: async (desafio, codigo) => {
        const d = await api('/api/auth/login/mfa', { method: 'POST', body: { desafio, codigo }, auth: false })
        setToken(d.token)
        setUser(d.usuario)
        return d.usuario
      },
      loginGoogle: async (credential) => {
        const d = await api('/api/auth/google', { method: 'POST', body: { credential }, auth: false })
        setToken(d.token)
        setUser(d.usuario)
        return d.usuario
      },
      setMfa: (mfa) => setUser((u) => (u ? { ...u, mfa } : u)),
      register: (nombre, email, password) =>
        api('/api/auth/registro', { method: 'POST', body: { nombre, email, password }, auth: false }),
      logout: async () => {
        // Se revoca en el servidor (lista negra en Redis); localmente se borra igual aunque falle.
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
        clear()
      },
    }),
    [user, checking, clear],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
