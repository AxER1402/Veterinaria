import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { business } from '../data/content'
import { resumenHorario } from '../data/horarios'
import { ClinicaContext } from './useClinica'

// Sedes, horarios, teléfono y precios: se administran en el panel y el sitio los lee de aquí.
export function ClinicaProvider({ children }) {
  const [datos, setDatos] = useState(null)

  const recargar = useCallback(() => {
    api('/api/citas/sedes', { auth: false }).then(setDatos).catch(() => {})
  }, [])
  useEffect(recargar, [recargar])

  const valor = useMemo(() => {
    const telefono = datos?.telefono || business.phone
    const sedes = datos?.sedes || []
    return {
      cargando: !datos,
      sedes,
      servicios: datos?.servicios || [],
      telefono,
      tel: `tel:${telefono.replace(/[^+\d]/g, '')}`,
      horario: sedes[0] ? resumenHorario(sedes[0].horarios) : business.hours,
      recargar,
    }
  }, [datos, recargar])

  return <ClinicaContext.Provider value={valor}>{children}</ClinicaContext.Provider>
}
