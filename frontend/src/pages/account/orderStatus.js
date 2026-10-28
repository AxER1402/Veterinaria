export const STATUS = {
  pendiente_pago: { label: 'Pendiente de pago', tone: 'warn' },
  pagado: { label: 'Pagado', tone: 'info' },
  preparando: { label: 'Preparando', tone: 'info' },
  listo_retiro: { label: 'Listo para retirar', tone: 'ok' },
  enviado: { label: 'En camino', tone: 'info' },
  entregado: { label: 'Entregado', tone: 'ok' },
  cancelado: { label: 'Cancelado', tone: 'bad' },
}

export const shortId = (id) => id.slice(0, 8).toUpperCase()

export const formatDate = (value) =>
  new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value.replace(' ', 'T')))
