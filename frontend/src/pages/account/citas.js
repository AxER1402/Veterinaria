// Apoyo común de la reserva, «Mis citas» y «Mis mascotas».
import { Dog, Cat, Rabbit } from 'lucide-react'

export const CITA_STATUS = {
  pendiente: { label: 'Pendiente de confirmar', tone: 'warn' },
  confirmada: { label: 'Confirmada', tone: 'info' },
  atendida: { label: 'Atendida', tone: 'ok' },
  no_asistio: { label: 'No asistió', tone: 'bad' },
  cancelada: { label: 'Cancelada', tone: 'bad' },
}

export const ESPECIES = [
  { value: 'perro', label: 'Perro', icon: Dog },
  { value: 'gato', label: 'Gato', icon: Cat },
  { value: 'otro', label: 'Otro', icon: Rabbit },
]

// Fecha del calendario del navegador en Y-m-d. No se usa toISOString(): eso da la fecha en UTC
// y después de las 18:00 en Guatemala ya sería «mañana».
export function ymd(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

export function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

// El servidor acepta de hoy a 60 días.
export const MAX_DIAS = 60

const DIA = new Intl.DateTimeFormat('es-GT', { weekday: 'long', day: 'numeric', month: 'long' })
const DIA_CORTO = new Intl.DateTimeFormat('es-GT', { weekday: 'short', day: 'numeric', month: 'short' })

// «2026-10-20» → «martes, 20 de octubre». Se arma a mediodía para que ningún huso cambie el día.
export const formatDay = (fecha, corto = false) => (corto ? DIA_CORTO : DIA).format(new Date(`${fecha}T12:00:00`))

// «2026-10-20T09:30» (hora local de la clínica) → «martes, 20 de octubre · 09:30».
export const formatCita = (inicio) => `${formatDay(inicio.slice(0, 10))} · ${inicio.slice(11, 16)}`
