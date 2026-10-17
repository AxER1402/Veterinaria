// Estado de una vacuna del carné (lo calcula el servidor).
export const VACUNA_STATUS = {
  vigente: { label: 'Vigente', tone: 'ok' },
  por_vencer: { label: 'Vence pronto', tone: 'warn' },
  vencida: { label: 'Vencida', tone: 'bad' },
  sin_refuerzo: { label: 'Sin refuerzo', tone: 'info' },
  renovada: { label: 'Renovada', tone: 'info' },
}

const F = new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'short', year: 'numeric' })
export const fechaCorta = (ymd) => (ymd ? F.format(new Date(`${ymd}T12:00:00`)) : '—')
