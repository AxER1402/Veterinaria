// Horarios de las sedes: el servidor manda los 7 días (1 = lunes … 7 = domingo; sin «abre» = cerrado).
export const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// Horas cada 30 minutos del día, para los selectores.
export const HORAS_DIA = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)

const hora = (h) => h.replace(/^0/, '')

// «Lun a Vie · 8:00 – 20:00, Sáb · 9:00 – 13:00»: une los días seguidos con el mismo horario.
export function gruposHorario(horarios) {
  const grupos = []
  for (const h of horarios) {
    if (!h.abre) continue
    const ultimo = grupos.at(-1)
    if (ultimo && ultimo.abre === h.abre && ultimo.cierra === h.cierra && ultimo.hasta === h.dia - 1) ultimo.hasta = h.dia
    else grupos.push({ desde: h.dia, hasta: h.dia, abre: h.abre, cierra: h.cierra })
  }
  return grupos.map((g) => ({
    dias: g.desde === g.hasta ? DIAS[g.desde - 1] : `${DIAS[g.desde - 1]} a ${DIAS[g.hasta - 1]}`,
    horas: `${hora(g.abre)} – ${hora(g.cierra)}`,
  }))
}

export const resumenHorario = (horarios) => gruposHorario(horarios).map((g) => `${g.dias} · ${g.horas}`).join(', ')

// Horas entre la apertura más temprana y el cierre más tardío de las sedes activas.
export function horasDeSedes(sedes) {
  const abiertos = sedes.flatMap((s) => s.horarios).filter((h) => h.abre)
  const abre = abiertos.length ? abiertos.reduce((m, h) => (h.abre < m ? h.abre : m), '23:30') : '08:00'
  const cierra = abiertos.length ? abiertos.reduce((m, h) => (h.cierra > m ? h.cierra : m), '00:00') : '20:00'
  return HORAS_DIA.filter((h) => h >= abre && h <= cierra)
}

export const abreDomingo = (sedes) => sedes.some((s) => s.horarios.some((h) => h.dia === 7 && h.abre))

// Etiqueta corta de una sede a partir de su código («centro» → «Centro»).
export const sedeCorta = (codigo) => {
  const t = (codigo || '').replace(/-/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
