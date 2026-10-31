// Arma y descarga un reporte en PDF. La librería solo se baja al generar el primero.
const NAVY = [0, 40, 66]
const YELLOW = [255, 209, 0]
const GRIS = [95, 107, 118]
const MARGEN = 40

export async function descargarPdf({ titulo, periodo, resumen = [], columnas, filas, archivo, usuario, nota, horizontal = false, datosPersonales = true }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: horizontal ? 'landscape' : 'portrait' })
  const ancho = doc.internal.pageSize.getWidth()
  const alto = doc.internal.pageSize.getHeight()

  doc.setFillColor(...NAVY)
  doc.rect(0, 0, ancho, 64, 'F')
  doc.setFillColor(...YELLOW)
  doc.rect(0, 64, ancho, 4, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('Huellitas', MARGEN, 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Clínica veterinaria y cuidado de mascotas', ancho - MARGEN, 40, { align: 'right' })

  doc.setTextColor(...NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(titulo, MARGEN, 98)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...GRIS)
  const generado = new Intl.DateTimeFormat('es-GT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())
  doc.text([periodo, `Generado el ${generado} por ${usuario}`].filter(Boolean).join('  ·  '), MARGEN, 114)

  let y = 130
  if (resumen.length) {
    const hueco = 8
    const porFila = Math.min(resumen.length, horizontal ? 6 : 4)
    const anchoCaja = (ancho - MARGEN * 2 - hueco * (porFila - 1)) / porFila
    resumen.forEach((r, i) => {
      const x = MARGEN + (i % porFila) * (anchoCaja + hueco)
      const yCaja = y + Math.floor(i / porFila) * 52
      doc.setFillColor(244, 245, 247)
      doc.roundedRect(x, yCaja, anchoCaja, 44, 4, 4, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(...GRIS)
      doc.text(r.label, x + 9, yCaja + 16)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12.5)
      doc.setTextColor(...NAVY)
      doc.text(String(r.valor), x + 9, yCaja + 34)
    })
    y += Math.ceil(resumen.length / porFila) * 52 + 4
  }
  if (nota) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...GRIS)
    doc.text(nota, MARGEN, y + 4)
    y += 14
  }

  autoTable(doc, {
    startY: y,
    margin: { left: MARGEN, right: MARGEN, bottom: 44 },
    head: [columnas.map((c) => c.titulo)],
    body: filas.map((f) => columnas.map((c) => f[c.campo] ?? '')),
    theme: 'plain',
    rowPageBreak: 'avoid',
    didParseCell: ({ section, column, cell }) => {
      if (section === 'head' && columnas[column.index].derecha) cell.styles.halign = 'right'
    },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: NAVY, lineColor: [226, 229, 233], lineWidth: { bottom: 0.5 }, overflow: 'linebreak' },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', lineWidth: 0 },
    alternateRowStyles: { fillColor: [250, 251, 251] },
    columnStyles: Object.fromEntries(columnas.map((c, i) => [i, { halign: c.derecha ? 'right' : 'left', ...(c.ancho ? { cellWidth: c.ancho } : {}) }])),
  })

  const paginas = doc.getNumberOfPages()
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRIS)
    doc.text(datosPersonales ? 'Documento interno. Contiene datos personales: compártelo solo con quien lo necesite.' : 'Documento interno.', MARGEN, alto - 22)
    doc.text(`Página ${p} de ${paginas}`, ancho - MARGEN, alto - 22, { align: 'right' })
  }
  doc.save(archivo)
}
