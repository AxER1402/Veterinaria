import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Printer } from 'lucide-react'
import ReciboPedido from '../../components/ReciboPedido'
import { PEDIDO_COBRADO } from '../../data/recibos'
import Loading from '../../components/Loading'
import ConfirmDialog from '../../components/ConfirmDialog'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'
import { STATUS, shortId, formatDate } from '../account/orderStatus'

// Solo para mostrar las opciones; la regla que vale es la del servidor (pedidos-service).
const NEXT = {
  pendiente_pago: ['cancelado'],
  pagado: ['preparando', 'cancelado'],
  preparando: ['listo_retiro', 'enviado', 'cancelado'],
  listo_retiro: ['entregado', 'cancelado'],
  enviado: ['entregado'],
  entregado: [],
  cancelado: [],
}
const PASOS_DOMICILIO = ['pendiente_pago', 'pagado', 'preparando', 'enviado', 'entregado']
const PASOS_RETIRO = ['pendiente_pago', 'pagado', 'preparando', 'listo_retiro', 'entregado']
const COBRADOS = ['pagado', 'preparando', 'listo_retiro', 'enviado']
const MOTIVOS_CANCELAR = ['Sin stock', 'El cliente lo pidió', 'Dirección fuera de cobertura', 'Pago no reconocido']

// Ficha del pedido para el personal de tienda: contacto completo, sin el botón de pagar del cliente.
export default function AdminPedido() {
  const { id } = useParams()
  const [pedido, setPedido] = useState(null)
  const [error, setError] = useState('')
  const [dialogo, setDialogo] = useState(null)
  const [referencia, setReferencia] = useState('')
  const [enPasarela, setEnPasarela] = useState(false)

  useEffect(() => {
    api(`/api/pedidos/${id}`).then((d) => setPedido(d.pedido)).catch((e) => setError(e.message))
  }, [id])

  if (error && !pedido) return <div className="admin-card"><p className="form-alert">{error}</p><Link to="/admin/pedidos">Volver a pedidos</Link></div>
  if (!pedido) return <Loading />
  const p = pedido
  const opciones = NEXT[p.estado].filter((n) => !(n === 'enviado' && p.metodo_entrega === 'retiro') && !(n === 'listo_retiro' && p.metodo_entrega === 'domicilio'))

  const cambiar = async (nuevo, comentario) => {
    const d = await api(`/api/pedidos/admin/${p.id}/estado`, { method: 'PATCH', body: { estado: nuevo, comentario } })
    setPedido(d.pedido)
    setDialogo(null)
  }
  const reembolsarPasarela = async () => {
    setError('')
    setEnPasarela(true)
    try {
      setPedido((await api(`/api/pedidos/admin/${p.id}/reembolso/pasarela`, { method: 'POST' })).pedido)
    } catch (err) {
      setError(err.message)
    } finally {
      setEnPasarela(false)
    }
  }
  const reembolsar = async (e) => {
    e.preventDefault()
    setError('')
    try {
      setPedido((await api(`/api/pedidos/admin/${p.id}/reembolso`, { method: 'PATCH', body: { referencia } })).pedido)
      setReferencia('')
    } catch (err) {
      setError(err.message)
    }
  }

  const principales = opciones.filter((n) => n !== 'cancelado')
  const pasos = p.metodo_entrega === 'retiro' ? PASOS_RETIRO : PASOS_DOMICILIO
  const actual = pasos.indexOf(p.estado)

  return (
    <>
      <Link to="/admin/pedidos" className="volver"><ArrowLeft size={16} aria-hidden="true" /> Pedidos</Link>
      <header className="ficha-cabeza">
        <div>
          <h1>Pedido #{shortId(p.id)}</h1>
          <p>{p.contacto.nombre} · {formatDate(p.fecha)}</p>
        </div>
        <span className={`status status--${STATUS[p.estado].tone}`}>{STATUS[p.estado].label}</span>
        <div className="ficha-cabeza__acciones">
          {principales.map((n) => <button key={n} className="btn btn--primary btn--sm" onClick={() => setDialogo(n)}>Pasar a «{STATUS[n].label}»</button>)}
          {opciones.includes('cancelado') && <button className="link-btn link-btn--danger" onClick={() => setDialogo('cancelado')}>Cancelar pedido</button>}
        </div>
      </header>

      {p.estado !== 'cancelado' ? (
        <ol className="pasos" aria-label="Progreso del pedido">
          {pasos.map((e, i) => (
            <li key={e} className={i < actual ? 'is-hecho' : i === actual ? 'is-actual' : ''} aria-current={i === actual ? 'step' : undefined}>
              <span>{i < actual ? <Check size={14} aria-hidden="true" /> : i + 1}</span>{STATUS[e].label}
            </li>
          ))}
        </ol>
      ) : <p className="panel__aviso panel__aviso--mal"><span>Este pedido se canceló.</span></p>}

      {p.reembolso?.estado === 'pendiente' && (
        <form className="pedido__reembolso" onSubmit={reembolsar}>
          <p><strong>Reembolso pendiente.</strong> El pedido se cobró y se canceló: devuelve {formatPrice(p.total)}.</p>
          <button type="button" className="btn btn--dark btn--xs" onClick={reembolsarPasarela} disabled={enPasarela}>
            {enPasarela ? 'Reembolsando…' : 'Reembolsar en la pasarela'}
          </button>
          <span className="summary__hint">o, si lo hiciste a mano, anota la referencia:</span>
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Referencia del reembolso" minLength={3} maxLength={100} required />
          <button className="btn btn--dark btn--xs">Registrar reembolso</button>
        </form>
      )}
      {p.reembolso?.estado === 'hecho' && <p className="form-ok">Reembolso hecho · referencia {p.reembolso.referencia}</p>}
      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="ficha-cuerpo">
        <div className="admin-card">
          <h2>Productos</h2>
          <ul className="pedido__items">
            {p.items.map((i) => (
              <li key={i.variante_id}>
                <span className="fila__principal"><strong>{i.nombre}</strong><small>{i.etiqueta} · {formatPrice(i.precio_unitario)} c/u</small></span>
                <span className="pedido__cant">×{i.cantidad}</span>
                <strong>{formatPrice(i.subtotal)}</strong>
              </li>
            ))}
          </ul>
          <dl className="pedido__totales">
            <div><dt>Subtotal</dt><dd>{formatPrice(p.subtotal)}</dd></div>
            {p.descuento > 0 && <div><dt>Descuento {p.cupon && `(${p.cupon})`}</dt><dd>−{formatPrice(p.descuento)}</dd></div>}
            <div><dt>Envío</dt><dd>{p.envio ? formatPrice(p.envio) : 'Gratis'}</dd></div>
            <div className="pedido__total"><dt>Total</dt><dd>{formatPrice(p.total)}</dd></div>
          </dl>
        </div>
        <div className="ficha-lado">
          <div className="admin-card">
            <h2>Cliente y entrega</h2>
            <dl className="ficha-datos">
              <div><dt>Nombre</dt><dd>{p.contacto.nombre}</dd></div>
              <div><dt>Teléfono</dt><dd><a href={`tel:${p.contacto.telefono}`}>{p.contacto.telefono}</a></dd></div>
              <div><dt>Correo</dt><dd><a href={`mailto:${p.contacto.email}`}>{p.contacto.email}</a></dd></div>
              <div><dt>{p.metodo_entrega === 'retiro' ? 'Retiro en' : 'Envío a'}</dt>
                <dd>{p.metodo_entrega === 'retiro' ? p.sede : <>{p.direccion.direccion}, {p.direccion.ciudad}{p.direccion.notas && ` (${p.direccion.notas})`}</>}</dd></div>
            </dl>
          </div>
          <div className="admin-card">
            <h2>Historial</h2>
            <ol className="timeline">
              {p.historial.map((h, n) => (
                <li key={n}>
                  <strong>{STATUS[h.estado_nuevo]?.label ?? h.estado_nuevo}</strong>
                  <small>{formatDate(h.fecha)}{h.comentario ? ` · ${h.comentario}` : ''}</small>
                </li>
              ))}
            </ol>
            <p className="mono order-id">ID: {p.id}</p>
          </div>
          {PEDIDO_COBRADO.includes(p.estado) && <Comprobante pedido={p} />}
        </div>
      </div>
      {dialogo && (
        <ConfirmDialog title={dialogo === 'cancelado' ? 'Cancelar pedido' : `Pasar a «${STATUS[dialogo].label}»`} onClose={() => setDialogo(null)}
          peligro={dialogo === 'cancelado'} confirmLabel={dialogo === 'cancelado' ? 'Cancelar pedido' : 'Confirmar'}
          motivos={dialogo === 'cancelado' ? MOTIVOS_CANCELAR : null} requiereMotivo={dialogo === 'cancelado'}
          text={dialogo === 'cancelado'
            ? `El stock vuelve al catálogo y el cliente recibe el motivo por correo.${COBRADOS.includes(p.estado) ? ` Ya está cobrado: quedará un reembolso pendiente de ${formatPrice(p.total)}.` : ''}`
            : `#${shortId(p.id)} · ${p.contacto.nombre}. El cliente recibe un correo con el estado nuevo.`}
          onConfirm={(comentario) => cambiar(dialogo, comentario)} />
      )}
    </>
  )
}

// Comprobante que recibió el cliente: imprimirlo, reenviarlo y comprobar el código ante un reclamo.
function Comprobante({ pedido }) {
  const [imprimir, setImprimir] = useState(false)
  const cerrar = useCallback(() => setImprimir(false), [])
  const [codigo, setCodigo] = useState('')
  const [resultado, setResultado] = useState(null) // { ok, texto }
  const [enviando, setEnviando] = useState(false)

  const reenviar = async () => {
    setEnviando(true)
    try {
      await api(`/api/pedidos/admin/${pedido.id}/comprobante/reenviar`, { method: 'POST' })
      setResultado({ ok: true, texto: `Comprobante enviado a ${pedido.contacto.email}.` })
    } catch (e) {
      setResultado({ ok: false, texto: e.message })
    } finally {
      setEnviando(false)
    }
  }
  const comprobar = async (e) => {
    e.preventDefault()
    try {
      const d = await api(`/api/pedidos/admin/${pedido.id}/comprobante/verificar`, { method: 'POST', body: { codigo } })
      setResultado(d.valido ? { ok: true, texto: 'El código es válido: el comprobante es de este pedido.' } : { ok: false, texto: 'El código no corresponde a este pedido.' })
    } catch (err) {
      setResultado({ ok: false, texto: err.message })
    }
  }

  return (
    <div className="admin-card comprobante">
      <h2>Comprobante</h2>
      <div className="comprobante__acciones">
        <button className="btn btn--ghost btn--xs" onClick={() => setImprimir(true)}><Printer size={14} aria-hidden="true" /> Imprimir</button>
        <button className="btn btn--ghost btn--xs" onClick={reenviar} disabled={enviando}>{enviando ? 'Enviando…' : 'Reenviar por correo'}</button>
      </div>
      <form className="comprobante__codigo" onSubmit={comprobar}>
        <label>Comprobar código del cliente
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" maxLength={19} className="mono" />
        </label>
        <button className="btn btn--dark btn--xs" disabled={codigo.length !== 19}>Comprobar</button>
      </form>
      {resultado && <p className={resultado.ok ? 'form-ok' : 'form-alert'} role="status">{resultado.texto}</p>}
      {imprimir && <ReciboPedido pedido={pedido} onDone={cerrar} />}
    </div>
  )
}
