import { useEffect, useRef, useState } from 'react'
import { CreditCard, Lock } from 'lucide-react'
import { api } from '../../api'
import { formatPrice } from '../../data/shop'

// Los SDK se cargan desde los dominios oficiales (permitidos en la CSP del gateway).
// Stripe no permite SRI ni copias locales de Stripe.js, por eso no se empaqueta.
const scripts = {}
function loadScript(src) {
  scripts[src] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = resolve
    s.onerror = () => {
      delete scripts[src]
      reject(new Error('No se pudo cargar la pasarela de pago'))
    }
    document.head.appendChild(s)
  })
  return scripts[src]
}

/** Espera a que el webhook firmado de Stripe marque el pedido como pagado. */
async function waitPaid(id, tries = 15) {
  for (let i = 0; i < tries; i++) {
    const { pedido } = await api(`/api/pedidos/${id}`)
    if (pedido.estado !== 'pendiente_pago') return pedido
    await new Promise((r) => setTimeout(r, 2000))
  }
  return null
}

export default function PaymentPanel({ order, onPaid }) {
  const [method, setMethod] = useState(null)
  const [error, setError] = useState('')

  return (
    <div className="payment">
      <h3>Pagar {formatPrice(order.total)}</h3>
      {!method && (
        <div className="payment__methods">
          <button className="btn btn--primary" onClick={() => { setError(''); setMethod('stripe') }}>
            <CreditCard size={18} /> Tarjeta
          </button>
          <button className="btn btn--paypal" onClick={() => { setError(''); setMethod('paypal') }}>
            PayPal
          </button>
        </div>
      )}
      {method === 'stripe' && <StripeForm order={order} onPaid={onPaid} onError={(m) => { setError(m); setMethod(null) }} />}
      {method === 'paypal' && <PayPalButtons order={order} onPaid={onPaid} onError={(m) => { setError(m); setMethod(null) }} />}
      {error && <p className="form-alert" role="alert">{error}</p>}
      <p className="demo-note">
        <Lock size={14} /> Los datos de tu tarjeta van directo a Stripe o PayPal. Huellitas no los ve ni los guarda.
      </p>
    </div>
  )
}

// Los callbacks van por ref: si fueran dependencias del efecto, cada render iniciaría otro pago.
function useLatest(value) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}

function StripeForm({ order, onPaid, onError }) {
  const mountRef = useRef(null)
  const onErrorRef = useLatest(onError)
  const stripeRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { pago } = await api(`/api/pedidos/${order.id}/pago`, { method: 'POST', body: { metodo: 'stripe' } })
        await loadScript('https://js.stripe.com/v3/')
        if (cancelled) return
        const stripe = window.Stripe(pago.publishable_key, { locale: 'es' })
        const elements = stripe.elements({ clientSecret: pago.client_secret, appearance: { theme: 'stripe' } })
        elements.create('payment').mount(mountRef.current)
        stripeRef.current = { stripe, elements }
        setReady(true)
      } catch (e) {
        if (!cancelled) onErrorRef.current(e.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [order.id, onErrorRef])

  const pay = async (e) => {
    e.preventDefault()
    const { stripe, elements } = stripeRef.current
    setStatus('Procesando…')
    const { error } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: `${window.location.origin}/cuenta/pedidos/${order.id}` },
    })
    if (error) {
      setStatus('')
      return onError(error.message)
    }
    setStatus('Pago recibido. Confirmando con el banco…')
    const paid = await waitPaid(order.id).catch(() => null)
    if (paid) onPaid(paid)
    else setStatus('Tu pago se está confirmando. Revisa «Mis pedidos» en unos minutos.')
  }

  return (
    <form onSubmit={pay} className="payment__form">
      <div ref={mountRef} />
      {!ready && <p className="summary__hint">Cargando formulario seguro de Stripe…</p>}
      <button className="btn btn--primary btn--block" disabled={!ready || Boolean(status)}>
        {status || `Pagar ${formatPrice(order.total)}`}
      </button>
    </form>
  )
}

// PayPal no acepta quetzales: cobra en dólares al tipo de cambio de pagos-service.
function PayPalButtons({ order, onPaid, onError }) {
  const mountRef = useRef(null)
  const onPaidRef = useLatest(onPaid)
  const onErrorRef = useLatest(onError)
  const [cobro, setCobro] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { pago } = await api(`/api/pedidos/${order.id}/pago`, { method: 'POST', body: { metodo: 'paypal' } })
        await loadScript(`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(pago.client_id)}&currency=USD&intent=capture&locale=es_ES`)
        if (cancelled) return
        setCobro(pago)
        window.paypal
          .Buttons({
            createOrder: () => pago.orden_id,
            onApprove: async () => {
              const d = await api(`/api/pedidos/${order.id}/pago/paypal/capturar`, { method: 'POST', body: { orden_id: pago.orden_id } })
              onPaidRef.current(d.pedido)
            },
            onError: () => onErrorRef.current('PayPal no pudo completar el pago'),
          })
          .render(mountRef.current)
      } catch (e) {
        if (!cancelled) onErrorRef.current(e.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [order.id, onPaidRef, onErrorRef])

  return (
    <>
      {cobro && (
        <p className="summary__hint">
          PayPal cobra en dólares: <strong>US${cobro.monto_cobro}</strong> (Q{Number(cobro.tipo_cambio).toFixed(2)} por dólar).
        </p>
      )}
      <div ref={mountRef} className="payment__paypal" />
    </>
  )
}
