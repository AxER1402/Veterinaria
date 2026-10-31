import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Search, ShieldCheck } from 'lucide-react'
import Loading from '../../components/Loading'
import { api } from '../../api'
import Select from '../../components/Select'
import Stat from './Stat'

const ACCIONES = ['LOGIN_CLIENTE_EXITOSO', 'LOGIN_CLIENTE_FALLIDO', 'REGISTRO_CLIENTE', 'PEDIDO_CREADO', 'PAGO_INICIADO', 'PAGO_CONFIRMADO',
  'PAGO_FALLIDO', 'PEDIDO_ESTADO_CAMBIADO', 'PRODUCTO_CREADO', 'PRODUCTO_ACTUALIZADO', 'PRECIO_MODIFICADO', 'PRODUCTO_AGOTADO', 'EXPORTACION_CLIENTES', 'ACCESO_ADMIN_PANEL',
  'WEBHOOK_STRIPE_RECIBIDO', 'TOKEN_REVOCADO', 'MFA_CONFIGURADO', 'EMAIL_ENVIADO', 'ACCESO_DENEGADO',
  // Módulo de citas (FASE 15)
  'MASCOTA_REGISTRADA', 'MASCOTA_ACTUALIZADA', 'CITA_CREADA', 'CITA_CANCELADA', 'CITA_ESTADO_CAMBIADO', 'TURNO_BLOQUEADO',
  'TURNO_DESBLOQUEADO', 'HISTORIAL_REGISTRADO', 'HISTORIAL_CONSULTADO', 'HISTORIAL_CORREGIDO', 'RECORDATORIO_ENVIADO', 'REPORTE_GENERADO', 'SEDE_ACTUALIZADA', 'SEDE_ELIMINADA', 'SERVICIO_ACTUALIZADO', 'COBRO_REGISTRADO', 'COBRO_PAGADO', 'COBRO_ANULADO']
const TONO = { EXITO: 'ok', FALLO: 'warn', FRAUDE: 'bad' }
const RESULTADO = { EXITO: 'Correcto', FALLO: 'Fallido', FRAUDE: 'Fraude' }
// «CITA_CREADA» → «Cita creada». Los nombres técnicos siguen en el detalle de cada registro.
const legible = (accion) => accion.charAt(0) + accion.slice(1).toLowerCase().replaceAll('_', ' ')

export default function AdminBitacora() {
  return (
    <>
      <Estado />
      <Registros />
    </>
  )
}

// Si la cadena de registros sigue íntegra y cuántos hay.
function Estado() {
  const [data, setData] = useState(null)
  useEffect(() => {
    Promise.all([api('/api/auditoria/resumen'), api('/api/auditoria/integridad')])
      .then(([auditoria, integridad]) => setData({ auditoria, integridad }))
      .catch(() => setData(false))
  }, [])
  if (!data) return data === false ? <p className="form-alert">No se pudo leer la bitácora.</p> : <Loading />
  const { auditoria, integridad } = data
  const fraudes = auditoria.por_evento.filter((e) => e.resultado === 'FRAUDE').reduce((n, e) => n + Number(e.total), 0)
  return (
    <div className="stat-tiles">
      <Stat label="Acciones registradas" value={auditoria.total} note={`${fraudes} marcadas como fraude`} tone={fraudes ? 'bad' : undefined} />
      <Stat label="Estado de la bitácora" value={integridad.integra ? 'Íntegra' : 'ALTERADA'} tone={integridad.integra ? 'ok' : 'bad'}
        note={integridad.integra ? `${integridad.revisados} registros verificados` : `Primer registro alterado: #${integridad.primer_registro_alterado}`} />
    </div>
  )
}

function Registros() {
  const [filtros, setFiltros] = useState({ accion: '', resultado: '', usuario_email: '' })
  const [pagina, setPagina] = useState(1)
  const [datos, setDatos] = useState(null)
  const [abierto, setAbierto] = useState(null)
  const [integridad, setIntegridad] = useState(null)
  const [error, setError] = useState('')

  const cargar = useCallback(() => {
    const q = new URLSearchParams({ limite: '50', pagina: String(pagina) })
    Object.entries(filtros).forEach(([k, v]) => v && q.set(k, v))
    api(`/api/auditoria/eventos?${q}`).then(setDatos).catch((e) => setError(e.message))
  }, [filtros, pagina])

  useEffect(cargar, [cargar])

  const set = (k) => (e) => { setPagina(1); setFiltros((f) => ({ ...f, [k]: e.target.value })) }
  const verificar = () => api('/api/auditoria/integridad').then(setIntegridad).catch((e) => setError(e.message))
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.limite)) : 1

  return (
    <>
      <div className="barra">
        <Select value={filtros.accion} onChange={set('accion')} aria-label="Evento">
          <option value="">Todos los eventos</option>
          {ACCIONES.map((a) => <option key={a} value={a}>{legible(a)}</option>)}
        </Select>
        <Select value={filtros.resultado} onChange={set('resultado')} aria-label="Resultado">
          <option value="">Todos los resultados</option>
          {Object.entries(RESULTADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <label className="search admin-search">
          <Search size={18} />
          <input type="search" placeholder="Correo del usuario" value={filtros.usuario_email} onChange={set('usuario_email')} aria-label="Correo del usuario" />
        </label>
        <button className="btn btn--ghost btn--xs barra__fin" onClick={verificar}><ShieldCheck size={14} aria-hidden="true" /> Verificar ahora</button>
      </div>
      {integridad && (
        <p className={integridad.integra ? 'form-ok' : 'form-alert'}>
          {integridad.integra
            ? `Registros íntegros: se verificaron ${integridad.revisados}.`
            : `¡Bitácora alterada! El primer registro que no cuadra es el #${integridad.primer_registro_alterado}.`}
        </p>
      )}
      {error && <p className="form-alert">{error}</p>}
      {!datos ? <Loading /> : (
        <>
          <p className="barra__total barra__total--lista">{datos.total} {datos.total === 1 ? 'registro' : 'registros'}</p>
          <ul className="lista">
            {datos.eventos.map((e) => (
              <FilaEvento key={e.id} e={e} abierto={abierto === e.id} onToggle={() => setAbierto(abierto === e.id ? null : e.id)} />
            ))}
          </ul>
          {paginas > 1 && (
            <div className="pager">
              <button className="link-btn" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>← Anterior</button>
              <span>Página {pagina} de {paginas}</span>
              <button className="link-btn" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente →</button>
            </div>
          )}
        </>
      )}
    </>
  )
}

function FilaEvento({ e, abierto, onToggle }) {
  return (
    <li className={`evento ${abierto ? 'is-abierto' : ''}`}>
      <button type="button" className="evento__fila" onClick={onToggle} aria-expanded={abierto}>
        <span className={`evento__punto evento__punto--${TONO[e.resultado]}`} title={RESULTADO[e.resultado]} />
        <span className="fila__principal">
          <strong>{legible(e.accion)}</strong>
          <small>{e.usuario_email ?? e.rol} · {e.servicio}</small>
        </span>
        {e.resultado !== 'EXITO' && <span className={`status status--${TONO[e.resultado]}`}>{RESULTADO[e.resultado]}</span>}
        <span className="evento__hora mono">{e.timestamp}</span>
        <ChevronDown size={16} className={abierto ? 'gira' : ''} aria-hidden="true" />
      </button>
      {abierto && (
        <dl className="evento__detalle">
          <dt>Registro</dt><dd className="mono">#{e.id} · {e.accion}</dd>
          <dt>IP</dt><dd className="mono">{e.ip_origen}</dd>
          {e.pedido_id && <><dt>Pedido</dt><dd className="mono">{e.pedido_id}</dd></>}
          {e.pago_id && <><dt>Pago</dt><dd className="mono">{e.pago_id}</dd></>}
          {e.dato_anterior && <><dt>Antes</dt><dd><code>{JSON.stringify(e.dato_anterior)}</code></dd></>}
          {e.dato_nuevo && <><dt>Después</dt><dd><code>{JSON.stringify(e.dato_nuevo)}</code></dd></>}
          <dt>Navegador</dt><dd>{e.user_agent}</dd>
          <dt>Hash</dt><dd className="mono">{e.hash}</dd>
        </dl>
      )}
    </li>
  )
}
