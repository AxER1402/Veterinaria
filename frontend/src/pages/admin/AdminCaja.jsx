import { useCallback, useEffect, useState } from 'react'
import { Plus, Printer, Receipt } from 'lucide-react'
import ConfirmDialog from '../../components/ConfirmDialog'
import DateInput from '../../components/DateInput'
import Loading from '../../components/Loading'
import MenuAcciones from '../../components/MenuAcciones'
import ReciboCobro from '../../components/ReciboCobro'
import { METODOS_PAGO } from '../../data/recibos'
import { api } from '../../api'
import { useAuth } from '../../context/useAuth'
import { formatPrice } from '../../data/shop'
import { formatDate } from '../account/orderStatus'
import { ymd } from '../account/citas'
import CobroForm from './CobroForm'
import Stat from './Stat'

const ESTADO = { pendiente: { label: 'Pendiente', tone: 'warn' }, pagado: { label: 'Pagado', tone: 'ok' }, anulado: { label: 'Anulado', tone: 'bad' } }
const MOTIVOS_ANULAR = ['Se cobró de más', 'Error de digitación', 'El cliente no pagó']

// Caja de la clínica: lo cobrado en el día, por método, y lo que falta cobrar. No incluye la tienda en línea.
export default function AdminCaja() {
  const { user } = useAuth()
  const hoy = ymd(new Date())
  const [dia, setDia] = useState(hoy)
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const [pagar, setPagar] = useState(null)
  const [anular, setAnular] = useState(null)
  const [imprimir, setImprimir] = useState(null)
  const cerrarImpresion = useCallback(() => setImprimir(null), [])

  const cargar = useCallback(() => {
    api(`/api/citas/admin/cobros?desde=${dia}&hasta=${dia}`).then((d) => { setDatos({ ...d, dia }); setError('') }).catch((e) => setError(e.message))
  }, [dia])
  useEffect(cargar, [cargar])
  const vigente = datos?.dia === dia ? datos : null

  return (
    <>
      <div className="barra">
        <DateInput value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Día" />
        {dia !== hoy && <button className="btn btn--ghost btn--xs" onClick={() => setDia(hoy)}>Hoy</button>}
        <button className="btn btn--primary btn--xs barra__fin" onClick={() => setNuevo(true)}><Plus size={16} /> Nuevo cobro</button>
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {aviso && <p className="form-ok" role="status">{aviso}</p>}
      {!vigente ? !error && <Loading /> : (
        <>
          <div className="stat-tiles">
            <Stat label="Recibido" value={formatPrice(vigente.total)} />
            {Object.entries(METODOS_PAGO).filter(([k]) => k !== 'otro' || vigente.por_metodo.otro > 0).map(([k, v]) => <Stat key={k} label={v} value={formatPrice(vigente.por_metodo[k])} />)}
            <Stat label="Por cobrar" value={formatPrice(vigente.pendiente)} tone={vigente.pendiente > 0 ? 'warn' : undefined} />
          </div>
          {vigente.cobros.length === 0 ? (
            <div className="vacio"><Receipt size={32} aria-hidden="true" /><p>No hay cobros este día.</p></div>
          ) : (
            <ul className="lista caja">
              {vigente.cobros.map((c) => (
                <li key={c.id} className={`fila fila--cobro ${c.estado === 'anulado' ? 'is-apagada' : ''}`}>
                  <span className="fila__principal">
                    <strong>{c.cliente.nombre}{c.mascota && ` · ${c.mascota}`}</strong>
                    <small><span className="mono">{c.recibo}</span> · {formatDate(c.cobrado_at || c.fecha)}{c.metodo && ` · ${METODOS_PAGO[c.metodo]}`}</small>
                    {c.motivo_anulacion && <small>Anulado: {c.motivo_anulacion}</small>}
                  </span>
                  <strong className="fila__monto">{formatPrice(c.total)}</strong>
                  <span className={`status status--${ESTADO[c.estado].tone}`}>{ESTADO[c.estado].label}</span>
                  <span className="fila--cobro__acciones">
                    {c.estado === 'pendiente' && <button className="btn btn--dark btn--xs" onClick={() => setPagar(c)}>Cobrar</button>}
                    {c.estado === 'pagado' && <button className="btn btn--ghost btn--xs" onClick={() => setImprimir(c)}><Printer size={14} aria-hidden="true" /> Recibo</button>}
                    {c.estado !== 'anulado' && (c.estado === 'pendiente' || user.rol === 'admin') && (
                      <MenuAcciones etiqueta={`Más opciones de ${c.recibo}`} items={[{ label: 'Anular cobro', onClick: () => setAnular(c), peligro: true }]} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {nuevo && <CobroForm onClose={() => setNuevo(false)} onDone={(c) => { setNuevo(false); setAviso(`${c.recibo} guardado por ${formatPrice(c.total)}.`); cargar() }} />}
      {pagar && <PagarDialogo cobro={pagar} onClose={() => setPagar(null)} onDone={(c) => { setPagar(null); setAviso(`${c.recibo} cobrado.`); cargar() }} />}
      {anular && (
        <ConfirmDialog title={`Anular ${anular.recibo}`} onClose={() => setAnular(null)} peligro confirmLabel="Anular cobro" motivos={MOTIVOS_ANULAR} requiereMotivo
          text={`${anular.cliente.nombre} · ${formatPrice(anular.total)}. El cobro no se borra: queda anulado, con su motivo en la bitácora.`}
          onConfirm={async (motivo) => {
            await api(`/api/citas/admin/cobros/${anular.id}/anular`, { method: 'POST', body: { motivo } })
            setAnular(null)
            setAviso(`${anular.recibo} anulado.`)
            cargar()
          }} />
      )}
      {imprimir && <ReciboCobro cobro={imprimir} onDone={cerrarImpresion} />}
    </>
  )
}

function PagarDialogo({ cobro, onClose, onDone }) {
  const [metodo, setMetodo] = useState('efectivo')
  const [referencia, setReferencia] = useState('')
  return (
    <ConfirmDialog title={`Cobrar ${cobro.recibo}`} onClose={onClose} confirmLabel={`Cobrar ${formatPrice(cobro.total)}`}
      text={`${cobro.cliente.nombre}${cobro.mascota ? ` · ${cobro.mascota}` : ''}`}
      onConfirm={async () => onDone((await api(`/api/citas/admin/cobros/${cobro.id}/pagar`, { method: 'POST', body: { metodo, referencia: referencia.trim() } })).cobro)}>
      <div className="clinical-form cobro">
        <div className="cobro__metodos" role="group" aria-label="Cómo pagó">
          {Object.entries(METODOS_PAGO).map(([k, v]) => (
            <button key={k} type="button" className={`chip ${metodo === k ? 'chip--active' : ''}`} aria-pressed={metodo === k} onClick={() => setMetodo(k)}>{v}</button>
          ))}
        </div>
        {metodo !== 'efectivo' && <label>Referencia (opcional)<input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={60} /></label>}
      </div>
    </ConfirmDialog>
  )
}
