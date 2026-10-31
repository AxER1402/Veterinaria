// Apoyo común de los recibos de la clínica y los comprobantes de la tienda.
export const METODOS_PAGO = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otro: 'Otro' }

// Un pedido tiene comprobante si se pagó (y no se canceló).
export const PEDIDO_COBRADO = ['pagado', 'preparando', 'listo_retiro', 'enviado', 'entregado']
