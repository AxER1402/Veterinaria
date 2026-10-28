// Apoyo de SlotPicker: qué falta elegir y qué se manda según la modalidad del servicio.
// ¿Está completa la elección para poder reservar?
export const eleccionLista = (modalidad, { fecha, hora, salida }) =>
  Boolean(fecha) && (modalidad === 'turno' ? Boolean(hora) : modalidad === 'estadia' ? Boolean(salida) : true)

// Cuerpo de la petición según la modalidad.
export const cuerpoReserva = (modalidad, { fecha, hora, salida }) =>
  modalidad === 'estadia' ? { fecha, salida } : modalidad === 'dia' ? { fecha } : { fecha, hora }
