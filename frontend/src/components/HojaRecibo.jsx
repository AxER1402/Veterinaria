import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { formatPrice } from '../data/shop'

// Comprobante para imprimir o guardar como PDF, de una compra o de un cobro en la clínica. No es una
// factura de la SAT: lo dice en la hoja. Va en un portal directo en <body>: al imprimir se oculta lo demás.
export default function HojaRecibo({ titulo, numero, fecha, sede, cliente, detalle, lineas, totales, total, pago, nota, onDone }) {
  useEffect(() => {
    document.body.classList.add('printing')
    window.addEventListener('afterprint', onDone)
    const t = setTimeout(() => window.print(), 50)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', onDone)
      document.body.classList.remove('printing')
    }
  }, [onDone])

  return createPortal(
    <div className="print-sheet hoja-recibo">
      <header>
        <strong>Huellitas</strong>
        <span>{sede}</span>
      </header>
      <h1>{titulo} {numero}</h1>
      <p><b>Fecha:</b> {fecha}<br /><b>Cliente:</b> {cliente}{detalle && <><br />{detalle}</>}</p>
      <table className="hoja-recibo__tabla">
        <thead><tr><th>Concepto</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={i}><td>{l.concepto}</td><td>{l.cantidad}</td><td>{formatPrice(l.precio_unitario)}</td><td>{formatPrice(l.subtotal)}</td></tr>
          ))}
        </tbody>
      </table>
      {totales?.map((t) => <p key={t.label} className="hoja-recibo__fila"><span>{t.label}</span><span>{t.valor}</span></p>)}
      <p className="hoja-recibo__fila hoja-recibo__total"><span>Total</span><span>{formatPrice(total)}</span></p>
      {pago && <p><b>Pago:</b> {pago}</p>}
      {nota && <p>{nota}</p>}
      <p className="hoja-recibo__aviso">Comprobante interno de pago. No es una factura de la SAT.</p>
    </div>,
    document.body,
  )
}
