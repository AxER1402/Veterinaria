import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { CheckCircle2, CreditCard, Store, Truck, Lock } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import { OrderSummary } from './Cart'
import { useShop } from '../../context/useShop'
import { formatPrice } from '../../data/shop'
import { locations } from '../../data/content'
import Field from '../../components/Field'

const initial = { name: '', email: '', phone: '', address: '', city: '', delivery: 'envio', payment: 'tarjeta', notes: '' }

function validate(v) {
  const e = {}
  if (!v.name.trim()) e.name = 'Ingresa tu nombre'
  if (!/^\S+@\S+\.\S+$/.test(v.email)) e.email = 'Correo no válido'
  if (v.phone.replace(/\D/g, '').length < 7) e.phone = 'Teléfono no válido'
  if (v.delivery === 'envio') {
    if (!v.address.trim()) e.address = 'Ingresa tu dirección'
    if (!v.city.trim()) e.city = 'Ingresa tu ciudad'
  }
  return e
}

export default function Checkout() {
  const { lines, totals, clearCart } = useShop()
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState({})
  const [order, setOrder] = useState(null)

  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }))

  if (order) return <OrderConfirmed order={order} />
  if (lines.length === 0) return <Navigate to="/carrito" replace />

  const pickup = values.delivery === 'tienda'
  const summaryTotals = pickup ? { ...totals, shipping: 0, total: Math.round((totals.total - totals.shipping) * 100) / 100, missingForFreeShipping: 0 } : totals

  const submit = (e) => {
    e.preventDefault()
    const found = validate(values)
    setErrors(found)
    if (Object.keys(found).length) return
    // Proyecto solo frontend: aquí se enviaría el pedido a la API / pasarela de pago.
    setOrder({
      number: `HU-${Date.now().toString().slice(-6)}`,
      name: values.name.split(' ')[0],
      email: values.email,
      total: summaryTotals.total,
      pickup,
    })
    clearCart()
  }

  return (
    <>
      <PageHeader title="Finalizar compra" />
      <section className="section">
        <div className="container cart-layout">
          <form id="checkout-form" className="checkout-form" onSubmit={submit} noValidate>
            <h3>1. Datos de contacto</h3>
            <div className="form-grid">
              <Field label="Nombre completo" error={errors.name} full>
                <input value={values.name} onChange={set('name')} autoComplete="name" />
              </Field>
              <Field label="Correo" error={errors.email}>
                <input type="email" value={values.email} onChange={set('email')} autoComplete="email" />
              </Field>
              <Field label="Teléfono" error={errors.phone}>
                <input type="tel" value={values.phone} onChange={set('phone')} autoComplete="tel" />
              </Field>
            </div>

            <h3>2. Entrega</h3>
            <div className="option-cards">
              <OptionCard name="delivery" value="envio" current={values.delivery} onChange={set('delivery')} icon={Truck}
                title="Envío a domicilio" text={totals.shipping ? formatPrice(totals.shipping) : 'Gratis'} />
              <OptionCard name="delivery" value="tienda" current={values.delivery} onChange={set('delivery')} icon={Store}
                title="Retiro en tienda" text={`Gratis · ${locations[0].address}`} />
            </div>
            {!pickup && (
              <div className="form-grid">
                <Field label="Dirección" error={errors.address} full>
                  <input value={values.address} onChange={set('address')} autoComplete="street-address" />
                </Field>
                <Field label="Ciudad" error={errors.city}>
                  <input value={values.city} onChange={set('city')} autoComplete="address-level2" />
                </Field>
                <Field label="Notas de entrega">
                  <input value={values.notes} onChange={set('notes')} placeholder="Opcional" />
                </Field>
              </div>
            )}

            <h3>3. Pago</h3>
            <div className="option-cards">
              <OptionCard name="payment" value="tarjeta" current={values.payment} onChange={set('payment')} icon={CreditCard}
                title="Tarjeta" text="Débito o crédito" />
              <OptionCard name="payment" value="entrega" current={values.payment} onChange={set('payment')} icon={Store}
                title="Pago contra entrega" text="Efectivo o tarjeta al recibir" />
            </div>
            <p className="demo-note">
              <Lock size={14} /> Demostración: no se solicitan ni procesan datos de pago reales.
            </p>
          </form>

          <OrderSummary totals={summaryTotals} lines={lines}>
            <button type="submit" form="checkout-form" className="btn btn--primary btn--block">
              Confirmar pedido · {formatPrice(summaryTotals.total)}
            </button>
          </OrderSummary>
        </div>
      </section>
    </>
  )
}

function OrderConfirmed({ order }) {
  return (
    <section className="section">
      <div className="container order-confirmed">
        <CheckCircle2 size={72} />
        <h1>¡Gracias, {order.name}!</h1>
        <p>
          Tu pedido <strong>{order.number}</strong> por <strong>{formatPrice(order.total)}</strong> fue recibido.
          Te enviaremos la confirmación a <strong>{order.email}</strong>.
        </p>
        <p>{order.pickup ? 'Te avisaremos cuando esté listo para retirar en tienda.' : 'Te avisaremos cuando tu pedido salga a reparto.'}</p>
        <Link to="/tienda" className="btn btn--primary">
          Seguir comprando
        </Link>
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
