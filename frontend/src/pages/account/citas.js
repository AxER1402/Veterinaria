// Apoyo común de la reserva, «Mis citas» y «Mis mascotas».
import { Dog, Cat, Rabbit, Bird, Rat, Turtle, PawPrint } from 'lucide-react'

export const CITA_STATUS = {
  pendiente: { label: 'Pendiente de confirmar', tone: 'warn' },
  confirmada: { label: 'Confirmada', tone: 'info' },
  atendida: { label: 'Atendida', tone: 'ok' },
  no_asistio: { label: 'No asistió', tone: 'bad' },
  cancelada: { label: 'Cancelada', tone: 'bad' },
}

// Una cita que se cerró sola todavía no es una falta: falta que el personal la revise.
export const estadoCita = (c) => (c.por_revisar ? { label: 'Por revisar', tone: 'warn' } : CITA_STATUS[c.estado])

export const ESPECIES = [
  { value: 'perro', label: 'Perro', icon: Dog },
  { value: 'gato', label: 'Gato', icon: Cat },
  { value: 'conejo', label: 'Conejo', icon: Rabbit },
  { value: 'ave', label: 'Ave', icon: Bird },
  { value: 'roedor', label: 'Roedor', icon: Rat },
  { value: 'reptil', label: 'Reptil', icon: Turtle },
  { value: 'otro', label: 'Otro', icon: PawPrint },
]

// Teléfono de la clínica (el servidor también lo manda en /api/citas).

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
const DIA_ANIO = new Intl.DateTimeFormat('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const DIA_CORTO = new Intl.DateTimeFormat('es-GT', { weekday: 'short', day: 'numeric', month: 'short' })

// «2026-10-20» → «martes, 20 de octubre». Se arma a mediodía para que ningún huso cambie el día.
// Con `anio`, o si no es de este año, lleva el año: una cita de noviembre de 2025 no parece futura.
export const formatDay = (fecha, corto = false, anio = false) => {
  const d = new Date(`${fecha}T12:00:00`)
  if (corto) return DIA_CORTO.format(d)
  return (anio || d.getFullYear() !== new Date().getFullYear() ? DIA_ANIO : DIA).format(d)
}

// «2026-10-20T09:30» (hora local de la clínica) → «martes, 20 de octubre · 09:30».
export const formatCita = (inicio, anio = false) => `${formatDay(inicio.slice(0, 10), false, anio)} · ${inicio.slice(11, 16)}`

// Fecha y hora de una cita según su servicio: en hospedaje, entrada y salida; en guardería, solo el día.
export function formatReserva(cita, anio = false) {
  if (cita.fin) return `${formatDay(cita.inicio.slice(0, 10), false, anio)} → ${formatDay(cita.fin.slice(0, 10), false, anio)}`
  if (cita.servicio?.modalidad === 'dia') return `${formatDay(cita.inicio.slice(0, 10), false, anio)} · entrada 08:00`
  return formatCita(cita.inicio, anio)
}

export const noches = (entrada, salida) => Math.round((new Date(`${salida}T12:00:00`) - new Date(`${entrada}T12:00:00`)) / 86400000)

// Edad a partir de la fecha de nacimiento: «8 meses», «3 años».
export function edad(fecha) {
  if (!fecha) return null
  const n = new Date(`${fecha}T12:00:00`)
  const hoy = new Date()
  let meses = (hoy.getFullYear() - n.getFullYear()) * 12 + hoy.getMonth() - n.getMonth()
  if (hoy.getDate() < n.getDate()) meses--
  if (meses < 12) return meses <= 1 ? 'menos de 2 meses' : `${meses} meses`
  const anios = Math.floor(meses / 12)
  return anios === 1 ? '1 año' : `${anios} años`
}
