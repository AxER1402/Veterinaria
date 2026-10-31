import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import Flotante from './Flotante'
import { addDays, ymd } from '../pages/account/citas'

const DIAS = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do']
const MES = new Intl.DateTimeFormat('es-GT', { month: 'long' })
const MES_CORTO = new Intl.DateTimeFormat('es-GT', { month: 'short' })
const DIA_LARGO = new Intl.DateTimeFormat('es-GT', { dateStyle: 'full' })
const ANIOS_VISIBLES = 12

const leer = (texto) => (texto ? new Date(`${texto}T12:00:00`) : null)
const mostrar = (texto) => texto.split('-').reverse().join('/')
const primerDia = (fecha) => new Date(fecha.getFullYear(), fecha.getMonth(), 1, 12)
const sumarMeses = (fecha, n) => {
  const destino = new Date(fecha.getFullYear(), fecha.getMonth() + n, 1, 12)
  const ultimo = new Date(destino.getFullYear(), destino.getMonth() + 1, 0, 12).getDate()
  destino.setDate(Math.min(fecha.getDate(), ultimo))
  return destino
}

// Reemplaza a <input type="date"> con el mismo uso: value y e.target.value en formato AAAA-MM-DD.
// Con `etiqueta` el botón muestra ese texto en lugar de la fecha (el chip «Otra fecha» de la reserva).
export default function DateInput({ value = '', onChange, min, max, required, disabled, className = '', etiqueta, ...resto }) {
  const [abierto, setAbierto] = useState(false)
  const boton = useRef(null)
  const cerrar = useCallback(() => setAbierto(false), [])
  const cerrarYVolver = () => {
    setAbierto(false)
    boton.current?.focus()
  }

  return (
    <>
      <button ref={boton} type="button" className={etiqueta ? className : `ctl ctl--fecha ${className}`} disabled={disabled} aria-haspopup="dialog" aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)} {...resto}>
        {etiqueta ?? (
          <>
            <span className={`ctl__valor ${value ? '' : 'ctl__valor--vacio'}`}><span>{value ? mostrar(value) : 'dd/mm/aaaa'}</span></span>
            <CalendarDays size={16} className="ctl__icono" aria-hidden="true" />
          </>
        )}
      </button>
      {/* Para que el navegador avise si el formulario se envía sin fecha. */}
      {required && <input className="ctl__requerido" type="date" value={value} required readOnly tabIndex={-1} aria-hidden="true" />}
      {abierto && (
        <Flotante ancla={boton} onCerrar={cerrar} role="dialog" aria-modal="true" aria-label={resto['aria-label'] ?? 'Elegir fecha'}>
          <Calendario value={value} min={min} max={max} required={required} onCerrar={cerrarYVolver}
            onElegir={(v) => {
              cerrarYVolver()
              if (v !== value) onChange?.({ target: { value: v } })
            }} />
        </Flotante>
      )}
    </>
  )
}

function Calendario({ value, min, max, required, onElegir, onCerrar }) {
  const hoy = ymd(new Date())
  const [foco, setFoco] = useState(() => leer(value) ?? leer(hoy > (max ?? hoy) ? max : hoy < (min ?? hoy) ? min : hoy))
  const [vista, setVista] = useState('dias')
  const raiz = useRef(null)
  const permitido = (f) => (!min || f >= min) && (!max || f <= max)
  const mesPermitido = (a, m) => {
    const inicio = ymd(new Date(a, m, 1, 12))
    const fin = ymd(new Date(a, m + 1, 0, 12))
    return (!max || inicio <= max) && (!min || fin >= min)
  }
  const anioPermitido = (a) => (!max || `${a}-01-01` <= max) && (!min || `${a}-12-31` >= min)

  useEffect(() => {
    raiz.current?.querySelector('[data-foco="1"]')?.focus()
  }, [foco, vista])

  const inicio = primerDia(foco)
  const celdas = Array.from({ length: 42 }, (_, i) => addDays(inicio, i - ((inicio.getDay() + 6) % 7)))
  const anioBase = foco.getFullYear() - (foco.getFullYear() % ANIOS_VISIBLES)
  const anio = foco.getFullYear()

  const paso = { dias: 1, meses: 12, anios: ANIOS_VISIBLES * 12 }[vista]
  const puedeIr = (n) => {
    if (vista === 'anios') return Array.from({ length: ANIOS_VISIBLES }, (_, i) => anioBase + n * ANIOS_VISIBLES + i).some(anioPermitido)
    if (vista === 'meses') return anioPermitido(anio + n)
    const d = sumarMeses(foco, n)
    return mesPermitido(d.getFullYear(), d.getMonth())
  }

  const teclaDias = (e) => {
    const destino = {
      ArrowLeft: () => addDays(foco, -1),
      ArrowRight: () => addDays(foco, 1),
      ArrowUp: () => addDays(foco, -7),
      ArrowDown: () => addDays(foco, 7),
      PageUp: () => sumarMeses(foco, -1),
      PageDown: () => sumarMeses(foco, 1),
      Home: () => addDays(foco, -((foco.getDay() + 6) % 7)),
      End: () => addDays(foco, 6 - ((foco.getDay() + 6) % 7)),
    }[e.key]
    if (destino) {
      e.preventDefault()
      setFoco(destino())
    }
  }
  const teclaPanel = (e) => {
    if (e.key === 'Escape') {
      // Esc solo cierra el calendario, no el modal donde esté.
      e.preventDefault()
      e.stopPropagation()
      onCerrar()
    } else if (e.key === 'Tab') {
      const focos = [...raiz.current.querySelectorAll('button:not(:disabled):not([tabindex="-1"])')]
      const i = focos.indexOf(document.activeElement)
      e.preventDefault()
      focos[(i + (e.shiftKey ? -1 : 1) + focos.length) % focos.length]?.focus()
    }
  }

  return (
    <div ref={raiz} className="calendario" onKeyDown={teclaPanel}>
      <div className="calendario__cabeza">
        <button type="button" className="calendario__flecha" disabled={!puedeIr(-1)} onClick={() => setFoco(sumarMeses(foco, -paso))} aria-label="Anterior"><ChevronLeft size={18} /></button>
        <button type="button" className="calendario__titulo" disabled={vista === 'anios'} onClick={() => setVista(vista === 'dias' ? 'meses' : 'anios')} aria-live="polite">
          {vista === 'dias' && `${MES.format(foco)} ${anio}`}
          {vista === 'meses' && anio}
          {vista === 'anios' && `${anioBase} – ${anioBase + ANIOS_VISIBLES - 1}`}
        </button>
        <button type="button" className="calendario__flecha" disabled={!puedeIr(1)} onClick={() => setFoco(sumarMeses(foco, paso))} aria-label="Siguiente"><ChevronRight size={18} /></button>
      </div>

      {vista === 'dias' && (
        <div className="calendario__dias" role="grid" onKeyDown={teclaDias}>
          {DIAS.map((d) => <span key={d} className="calendario__semana" aria-hidden="true">{d}</span>)}
          {celdas.map((d) => {
            const f = ymd(d)
            const esFoco = f === ymd(foco)
            return (
              <button key={f} type="button" role="gridcell" disabled={!permitido(f)} tabIndex={esFoco ? 0 : -1} data-foco={esFoco ? '1' : undefined} aria-selected={f === value} aria-label={DIA_LARGO.format(d)}
                className={`calendario__dia ${d.getMonth() !== foco.getMonth() ? 'is-fuera' : ''} ${f === hoy ? 'is-hoy' : ''} ${f === value ? 'is-elegido' : ''}`}
                onClick={() => onElegir(f)}>
                {d.getDate()}
              </button>
            )
          })}
        </div>
      )}
      {vista === 'meses' && (
        <div className="calendario__grupo">
          {Array.from({ length: 12 }, (_, m) => (
            <button key={m} type="button" className={`calendario__opcion ${m === foco.getMonth() ? 'is-elegido' : ''}`} disabled={!mesPermitido(anio, m)} data-foco={m === foco.getMonth() ? '1' : undefined}
              onClick={() => { setFoco(new Date(anio, m, 1, 12)); setVista('dias') }}>
              {MES_CORTO.format(new Date(2026, m, 1, 12)).replace('.', '')}
            </button>
          ))}
        </div>
      )}
      {vista === 'anios' && (
        <div className="calendario__grupo">
          {Array.from({ length: ANIOS_VISIBLES }, (_, i) => anioBase + i).map((a) => (
            <button key={a} type="button" className={`calendario__opcion ${a === anio ? 'is-elegido' : ''}`} disabled={!anioPermitido(a)} data-foco={a === anio ? '1' : undefined}
              onClick={() => { setFoco(new Date(a, foco.getMonth(), 1, 12)); setVista('meses') }}>
              {a}
            </button>
          ))}
        </div>
      )}

      <div className="calendario__pie">
        <button type="button" className="link-btn" disabled={!permitido(hoy)} onClick={() => onElegir(hoy)}>Hoy</button>
        {value && !required && <button type="button" className="link-btn" onClick={() => onElegir('')}>Borrar</button>}
      </div>
    </div>
  )
}
