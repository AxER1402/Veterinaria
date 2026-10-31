import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { CheckCircle2, CreditCard, Store, Truck, Lock, LogIn, Wallet } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import { OrderSummary } from './Cart'
import { useShop } from '../../context/useShop'
import { useAuth } from '../../context/useAuth'
import { formatPrice } from '../../data/shop'
import { api } from '../../api'
import Field from '../../components/Field'
import Loading from '../../components/Loading'
import MapEmbed from '../../components/MapEmbed'
import PaymentPanel from '../../components/shop/PaymentPanel'
import Select from '../../components/Select'

function validate(v) {
  const e = {}
  if (v.nombre.trim().length < 2) e.nombre = 'Ingresa tu nombre'
  if (v.telefono.replace(/\D/g, '').length < 7) e.telefono = 'Teléfono no válido'
  if (v.metodo_entrega === 'domicilio') {
    if (v.direccion.trim().length < 5) e.direccion = 'Ingresa tu dirección'
    if (v.ciudad.trim().length < 2) e.ciudad = 'Ingresa tu ciudad'
  } else if (!v.sede) e.sede = 'Elige una sede'
  return e
}

// El servidor devuelve los totales con otros nombres; se adaptan al resumen del carrito.
const fromServer = (t) => ({ subtotal: t.subtotal, discount: t.descuento, shipping: t.envio, total: t.total, missingForFreeShipping: 0 })

export default function Checkout() {
  const { lines, coupon, clearCart, catalogLoading } = useShop()
  const { user, checking } = useAuth()
  const location = useLocation()
  const [order, setOrder] = useState(null)

  if (order) return <OrderConfirmed order={order.pedido} metodo={order.metodo} />
  if (catalogLoading || checking) return <Loading />
  if (lines.length === 0) return <Navigate to="/carrito" replace />
  if (!user) return <LoginRequired from={location.pathname} />

  return <CheckoutForm user={user} lines={lines} coupon={coupon} onDone={(pedido, metodo) => { setOrder({ pedido, metodo }); clearCart() }} />
}

function CheckoutForm({ user, lines, coupon, onDone }) {
  const [values, setValues] = useState({
    nombre: user.nombre, telefono: user.telefono || '', metodo_entrega: 'domicilio', direccion: '', ciudad: '', notas: '', sede: '',
  })
  const { setPerfil } = useAuth()
  // Solo se ofrecen los métodos que tienen claves en pagos-service (null mientras carga).
  const [metodos, setMetodos] = useState(null)
  const [metodo, setMetodo] = useState('')
  const [errors, setErrors] = useState({})
  const [sedes, setSedes] = useState([])
  const [quote, setQuote] = useState(null)
  const [problem, setProblem] = useState('')
  const [sending, setSending] = useState(false)

  const items = lines.map((l) => ({ variante_id: l.variant.id, cantidad: l.qty }))
  const itemsKey = JSON.stringify(items)
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }))

  useEffect(() => {
    api('/api/pedidos/sedes', { auth: false }).then((d) => setSedes(d.sedes)).catch(() => setSedes([]))
    api('/api/pedidos/metodos-pago', { auth: false })
      .then((d) => { setMetodos(d.metodos); setMetodo(d.metodos[0] || '') })
      .catch(() => setMetodos([]))
  }, [])

  // Cada cambio de carrito, cupón o entrega vuelve a pedir el total al servidor (es el que se cobra).
  useEffect(() => {
    let current = true
    api('/api/pedidos/cotizar', {
      method: 'POST',
      auth: false,
      body: { items: JSON.parse(itemsKey), cupon: coupon?.codigo, metodo_entrega: values.metodo_entrega },
    })
      .then((d) => {
        if (!current) return
        setQuote(d)
        const out = d.lineas.find((l) => !l.disponible)
        setProblem(out ? `No hay suficiente stock de ${out.nombre} (${out.etiqueta}). Ajusta la cantidad en el carrito.` : '')
      })
      .catch((e) => current && setProblem(e.message))
    return () => {
      current = false
    }
  }, [itemsKey, coupon?.codigo, values.metodo_entrega])

  const submit = async (e) => {
    e.preventDefault()
    const found = validate(values)
    setErrors(found)
    if (Object.keys(found).length) return
    setSending(true)
    setProblem('')
    try {
      const body = { items, cupon: coupon?.codigo, nombre: values.nombre, telefono: values.telefono, metodo_entrega: values.metodo_entrega }
      if (values.metodo_entrega === 'retiro') body.sede = values.sede
      else Object.assign(body, { direccion: values.direccion, ciudad: values.ciudad, notas: values.notas })
      const d = await api('/api/pedidos', { method: 'POST', body })
      // El teléfono queda en el perfil para la próxima compra o reserva.
      if (values.telefono.trim() !== (user.telefono || '')) {
        api('/api/auth/perfil', { method: 'PATCH', body: { telefono: values.telefono.trim() } })
          .then((p) => setPerfil({ telefono: p.usuario.telefono }))
          .catch(() => {})
      }
      onDone(d.pedido, metodo)
    } catch (err) {
      if (err.data?.campo) setErrors({ [err.data.campo]: err.message })
      else setProblem(err.message)
    } finally {
      setSending(false)
    }
  }

  const pickup = values.metodo_entrega === 'retiro'
  const totals = quote ? fromServer(quote.totales) : null

  return (
    <>
      <PageHeader compact title="Finalizar compra" />
      <section className="section">
        <div className="container cart-layout">
          <form id="checkout-form" className="checkout-form" onSubmit={submit} noValidate>
            <h3>1. Datos de contacto</h3>
            <div className="form-grid">
              <Field label="Nombre completo" error={errors.nombre} full>
                <input value={values.nombre} onChange={set('nombre')} autoComplete="name" maxLength={100} />
              </Field>
              <Field label="Correo">
                <input type="email" value={user.email} readOnly />
              </Field>
              <Field label="Teléfono" error={errors.telefono}>
                <input type="tel" value={values.telefono} onChange={set('telefono')} autoComplete="tel" maxLength={20} />
              </Field>
            </div>

            <h3>2. Entrega</h3>
            <div className="option-cards">
              <OptionCard name="metodo_entrega" value="domicilio" current={values.metodo_entrega} onChange={set('metodo_entrega')} icon={Truck}
                title="Envío a domicilio" text="Gratis desde Q400" />
              <OptionCard name="metodo_entrega" value="retiro" current={values.metodo_entrega} onChange={set('metodo_entrega')} icon={Store}
                title="Retiro en sede" text="Gratis" />
            </div>
            {pickup ? (
              <div className="form-grid">
                <Field label="Sede" error={errors.sede} full>
                  <Select value={values.sede} onChange={set('sede')}>
                    <option value="">Elige una sede…</option>
                    {sedes.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
                {values.sede && (
                  <div className="field--full">
                    <MapEmbed query={`${values.sede.split(' · ')[1]}, Ciudad de Guatemala`} title="Mapa de la sede elegida" />
                  </div>
                )}
              </div>
            ) : (
              <div className="form-grid">
                <Field label="Dirección" error={errors.direccion} full>
                  <input value={values.direccion} onChange={set('direccion')} autoComplete="street-address" maxLength={200} />
                </Field>
                <Field label="Ciudad" error={errors.ciudad}>
                  <input value={values.ciudad} onChange={set('ciudad')} autoComplete="address-level2" maxLength={80} />
                </Field>
                <Field label="Notas de entrega" error={errors.notas}>
                  <input value={values.notas} onChange={set('notas')} placeholder="Opcional" maxLength={200} />
                </Field>
              </div>
            )}

            <h3>3. Pago</h3>
            {metodos === null ? <p className="summary__hint">Revisando los medios de pago…</p> : metodos.length === 0 ? (
              <p className="form-alert form-alert--soft">
                El pago en línea no está disponible en este momento. Puedes confirmar el pedido y pagarlo después desde «Mis pedidos»;
                lo apartamos por unas horas.
              </p>
            ) : (
              <div className="option-cards">
                {metodos.includes('stripe') && (
                  <OptionCard name="pago" value="stripe" current={metodo} onChange={() => setMetodo('stripe')} icon={CreditCard}
                    title="Tarjeta" text="Débito o crédito, en quetzales" />
                )}
                {metodos.includes('paypal') && (
                  <OptionCard name="pago" value="paypal" current={metodo} onChange={() => setMetodo('paypal')} icon={Wallet}
                    title="PayPal" text="Se cobra en dólares al tipo de cambio del día" />
                )}
              </div>
            )}
            <p className="demo-note">
              <Lock size={14} /> El pago lo procesa directamente {metodo === 'paypal' ? 'PayPal' : metodo === 'stripe' ? 'Stripe' : 'la pasarela'}: Huellitas no recibe ni guarda los datos de tu tarjeta o cuenta.
            </p>
            {problem && <p className="form-alert" role="alert">{problem}</p>}
          </form>

          {totals ? (
            <OrderSummary totals={totals} lines={lines}>
              <button type="submit" form="checkout-form" className="btn btn--primary btn--block" disabled={sending || Boolean(problem && quote?.lineas.some((l) => !l.disponible))}>
                {sending ? 'Creando pedido…' : `Confirmar pedido · ${formatPrice(totals.total)}`}
              </button>
              <p className="summary__hint">El total lo calcula el servidor con los precios vigentes.</p>
            </OrderSummary>
          ) : (
            <aside className="summary"><Loading text="Calculando total…" /></aside>
          )}
        </div>
      </section>
    </>
  )
}

function LoginRequired({ from }) {
  return (
    <>
      <PageHeader compact title="Finalizar compra" />
      <section className="section">
        <div className="container empty-state">
          <LogIn size={56} />
          <h3>Inicia sesión para terminar tu compra</h3>
          <p>Tu carrito se conserva. Así podrás ver el estado de tu pedido en «Mis pedidos».</p>
          <Link to="/cuenta" state={{ from }} className="btn btn--primary">
            Iniciar sesión o crear cuenta
          </Link>
        </div>
      </section>
    </>
  )
}

function OrderConfirmed({ order: initial, metodo }) {
  const [order, setOrder] = useState(initial)
  const paid = order.estado !== 'pendiente_pago'
  return (
    <section className="section">
      <div className="container order-confirmed">
        <CheckCircle2 size={72} />
        <h1>{paid ? '¡Pago confirmado' : '¡Pedido recibido'}, {order.contacto.nombre.split(' ')[0]}!</h1>
        <p>
          Tu pedido <strong className="mono">{order.id.slice(0, 8).toUpperCase()}</strong> por <strong>{formatPrice(order.total)}</strong>{' '}
          {paid ? <>está <strong>pagado</strong>. Te enviamos el comprobante a <strong>{order.contacto.email}</strong>.</> : <>quedó registrado. Solo falta el pago.</>}
        </p>
        {!paid && <PaymentPanel order={order} onPaid={setOrder} inicial={metodo} />}
        <p>{order.metodo_entrega === 'retiro' ? `Lo retiras en: ${order.sede}.` : 'Te avisaremos cuando salga a reparto.'}</p>
        <div className="order-confirmed__actions">
          <Link to={`/cuenta/pedidos/${order.id}`} className="btn btn--primary">Ver mi pedido</Link>
          <Link to="/tienda" className="btn btn--dark">Seguir comprando</Link>
        </div>
      </div>
    </section>
  )
}

function OptionCard({ name, value, current, onChange, icon: Icon, title, text }) {
  return (
    <label className={`option-card ${current === value ? 'active' : ''}`}>
      <input type="radio" name={name} value={value} checked={current === value} onChange={onChange} />
      <Icon size={24} />
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
    </label>
  )
}
