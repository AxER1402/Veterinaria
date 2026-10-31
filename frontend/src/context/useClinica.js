import { createContext, useContext } from 'react'

export const ClinicaContext = createContext(null)

export function useClinica() {
  const ctx = useContext(ClinicaContext)
  if (!ctx) throw new Error('useClinica debe usarse dentro de <ClinicaProvider>')
  return ctx
}
