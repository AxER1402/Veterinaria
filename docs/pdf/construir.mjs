// Genera docs/pdf/SEC-1-Huellitas-Seguridad.pdf a partir de los documentos 01–06 (SEC-1).
// Dependencias (no van en el proyecto): npm i playwright-core@1.46.1 marked@12
//   node docs/pdf/construir.mjs [ruta del Chromium]
// Los diagramas Mermaid se dibujan en el propio Chromium antes de imprimir.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'
import { chromium } from 'playwright-core'

const aqui = dirname(fileURLToPath(import.meta.url))
const docs = join(aqui, '..')
const partes = [
  '01-arquitectura-stride-dfd.md', '02-owasp-top10.md', '03-pci-dss-pagos.md',
  '04-bcp-drp.md', '05-presupuesto-ale-rosi.md', '06-iso27001.md',
]
// El informe del simulacro DRP más reciente, si existe.
let simulacro = null
try {
  simulacro = readdirSync(join(docs, 'simulacros')).filter((f) => f.endsWith('.md')).sort().at(-1) ?? null
} catch {
  // Sin simulacros todavía: el PDF sale sin esa sección.
}

const renderer = new marked.Renderer()
renderer.code = (code, lang) => lang === 'mermaid'
  ? `<pre class="mermaid">${code}</pre>`
  : `<pre><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`
marked.use({ renderer })

const cuerpo = partes.map((f) => `<section class="doc">${marked.parse(readFileSync(join(docs, f), 'utf8'))}</section>`).join('\n')
const zap = marked.parse(readFileSync(join(docs, 'zap', 'README.md'), 'utf8'))
const extra = simulacro ? marked.parse(readFileSync(join(docs, 'simulacros', simulacro), 'utf8')) : ''

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>SEC-1 Huellitas</title>
<style>
  @page { size: Letter; margin: 18mm 16mm 20mm; }
  body { font: 10pt/1.45 "Readex Pro", system-ui, sans-serif; color: #1d2733; }
  h1 { font-size: 18pt; color: #002842; border-bottom: 3px solid #FFD100; padding-bottom: 4px; margin-top: 0; }
  h2 { font-size: 13pt; color: #002842; margin-top: 18px; }
  h3 { font-size: 11pt; color: #002842; }
  .doc { break-before: page; }
  .portada { height: 230mm; display: flex; flex-direction: column; justify-content: center; }
  .portada h1 { font-size: 28pt; border: 0; }
  .portada p { font-size: 12pt; color: #59606d; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 8.2pt; break-inside: auto; table-layout: auto; }
  td, th { overflow-wrap: break-word; hyphens: auto; }
  th { hyphens: manual; white-space: nowrap; }
  td code { word-break: break-word; overflow-wrap: anywhere; }
  th, td { border: 1px solid #d9dde3; padding: 4px 6px; vertical-align: top; text-align: left; }
  th { background: #eef3fb; }
  tr { break-inside: avoid; }
  code { font: 8.4pt ui-monospace, Menlo, monospace; background: #f3f4f6; padding: 0 3px; border-radius: 3px; }
  pre { background: #f6f7f9; padding: 8px; border-radius: 6px; white-space: pre-wrap; font-size: 8pt; break-inside: avoid; }
  pre.mermaid { background: none; text-align: center; }
  blockquote { margin: 8px 0; padding: 6px 10px; border-left: 3px solid #FFD100; background: #fffbea; }
  a { color: #002842; }
</style></head><body>
<div class="portada">
  <h1>Huellitas — E-Commerce distribuido<br>Documento de seguridad (SEC-1)</h1>
  <p>Auditoría y Seguridad de Sistemas · Proyecto 2</p>
  <p>STRIDE y DFD · OWASP Top 10 con referencias al código · PCI-DSS · BCP/DRP · ALE/ROSI · ISO 27001 · OWASP ZAP</p>
  <p>Generado el ${new Date().toLocaleDateString('es-GT', { dateStyle: 'long' })}</p>
</div>
${cuerpo}
<section class="doc">${extra}</section>
<section class="doc">${zap}</section>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs'
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', flowchart: { useMaxWidth: true }, sequence: { useMaxWidth: true } })
  await mermaid.run({ querySelector: '.mermaid' })
  document.body.dataset.listo = '1'
</script></body></html>`

writeFileSync(join(aqui, 'SEC-1.html'), html)
const browser = await chromium.launch({ executablePath: process.argv[2] || `${process.env.HOME}/.cache/ms-playwright/chromium-1140/chrome-linux/chrome` })
const page = await browser.newPage()
await page.goto('file://' + join(aqui, 'SEC-1.html'))
await page.waitForSelector('body[data-listo="1"]', { timeout: 60000 })
await page.pdf({ path: join(aqui, 'SEC-1-Huellitas-Seguridad.pdf'), format: 'Letter', printBackground: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:7pt;width:100%;text-align:center;color:#888">Huellitas · SEC-1 · <span class="pageNumber"></span>/<span class="totalPages"></span></div>' })
await browser.close()
console.log('PDF: docs/pdf/SEC-1-Huellitas-Seguridad.pdf')
