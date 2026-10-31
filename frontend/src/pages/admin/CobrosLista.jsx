import { useCallback, useEffect, useState } from 'react'
import { Printer, Receipt } from 'lucide-react'
import Loading from '../../components/Loading'
import ReciboCobro from '../../components/ReciboCobro'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { METODOS_PAGO } from '../../data/recibos'
import { formatDate } from '../account/orderStatus'

const ESTADO = { pendiente: { label: 'Pendiente', tone: 'warn' }, pagado: { label: 'Pagado', tone: 'ok' }, anulado: { label: 'Anulado', tone: 'bad' } }

// Cobros de una mascota o de un cliente, en sus fichas. `version` cambia para volver a pedirlos.
export default function CobrosLista({ mascota, cliente, version = 0 }) {
  const [cobros, setCobros] = useState(null)
  const [error, setError] = useState('')
  const [imprimir, setImprimir] = useState(null)
  const cerrar = useCallback(() => setImprimir(null), [])
  const filtro = mascota ? `mascota=${mascota}` : `cliente=${cliente}`

  useEffect(() => {
    api(`/api/citas/admin/cobros/de?${filtro}`).then((d) => setCobros(d.cobros)).catch((e) => setError(e.message))
  }, [filtro, version])

  if (error) return <p className="form-alert" role="alert">{error}</p>
  if (!cobros) return <Loading />
  if (cobros.length === 0) return <div className="vacio"><Receipt size={32} aria-hidden="true" /><p>Sin cobros registrados.</p></div>
  return (
    <>
      <ul className="lista">
        {cobros.map((c) => (
          <li key={c.id} className={`fila fila--cobro ${c.estado === 'anulado' ? 'is-apagada' : ''}`}>
            <span className="fila__principal">
              <strong>{c.lineas[0]?.concepto}{c.lineas.length > 1 && ` y ${c.lineas.length - 1} más`}{!mascota && c.mascota && ` · ${c.mascota}`}</strong>
              <small><span className="mono">{c.recibo}</span> · {formatDate(c.cobrado_at || c.fecha)}{c.metodo && ` · ${METODOS_PAGO[c.metodo]}`}</small>
            </span>
            <strong className="fila__monto">{formatPrice(c.total)}</strong>
            <span className={`status status--${ESTADO[c.estado].tone}`}>{ESTADO[c.estado].label}</span>
            <span className="fila--cobro__acciones">
              {c.estado === 'pagado' && <button className="btn btn--ghost btn--xs" onClick={() => setImprimir(c)}><Printer size={14} aria-hidden="true" /> Recibo</button>}
            </span>
          </li>
        ))}
      </ul>
      {imprimir && <ReciboCobro cobro={imprimir} onDone={cerrar} />}
    </>
  )
}
