import { useCallback, useEffect, useState } from 'react'
import Loading from '../../components/Loading'
import { api } from '../../api'

const ACCIONES = ['LOGIN_CLIENTE_EXITOSO', 'LOGIN_CLIENTE_FALLIDO', 'REGISTRO_CLIENTE', 'PEDIDO_CREADO', 'PAGO_INICIADO', 'PAGO_CONFIRMADO',
  'PAGO_FALLIDO', 'PEDIDO_ESTADO_CAMBIADO', 'PRODUCTO_CREADO', 'PRECIO_MODIFICADO', 'PRODUCTO_AGOTADO', 'EXPORTACION_CLIENTES', 'ACCESO_ADMIN_PANEL',
  'WEBHOOK_STRIPE_RECIBIDO', 'TOKEN_REVOCADO', 'MFA_CONFIGURADO', 'EMAIL_ENVIADO', 'ACCESO_DENEGADO',
  // Módulo de citas (FASE 15)
  'MASCOTA_REGISTRADA', 'MASCOTA_ACTUALIZADA', 'CITA_CREADA', 'CITA_CANCELADA', 'CITA_ESTADO_CAMBIADO', 'TURNO_BLOQUEADO',
  'TURNO_DESBLOQUEADO', 'HISTORIAL_REGISTRADO', 'HISTORIAL_CONSULTADO', 'RECORDATORIO_ENVIADO']
const TONO = { EXITO: 'ok', FALLO: 'warn', FRAUDE: 'bad' }

export default function AdminBitacora() {
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
    <div className="admin-card">
      <div className="admin-card__head">
        <h2>Bitácora de seguridad <small>(solo lectura · append-only)</small></h2>
        <button className="btn btn--dark btn--sm" onClick={verificar}>Verificar integridad</button>
      </div>
      {integridad && (
        <p className={integridad.integra ? 'form-ok' : 'form-alert'}>
          {integridad.integra
            ? `Cadena de hashes íntegra: ${integridad.revisados} registros verificados.`
            : `¡Bitácora alterada! El primer registro que no cuadra es el #${integridad.primer_registro_alterado}.`}
        </p>
      )}
      <div className="admin-filters">
        <select value={filtros.accion} onChange={set('accion')} aria-label="Evento">
          <option value="">Todos los eventos</option>
          {ACCIONES.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select value={filtros.resultado} onChange={set('resultado')} aria-label="Resultado">
          <option value="">Todos los resultados</option>
          <option>EXITO</option><option>FALLO</option><option>FRAUDE</option>
        </select>
        <input type="search" placeholder="Correo del usuario" value={filtros.usuario_email} onChange={set('usuario_email')} aria-label="Correo del usuario" />
      </div>
      {error && <p className="form-alert">{error}</p>}
      {!datos ? <Loading /> : (
        <>
          <p className="summary__hint">{datos.total} eventos</p>
          <div className="table-scroll">
            <table className="admin-table admin-table--log">
              <thead><tr><th>#</th><th>Fecha</th><th>Evento</th><th>Resultado</th><th>Servicio</th><th>Usuario</th><th>IP</th></tr></thead>
              <tbody>
                {datos.eventos.map((e) => (
                  <FilaEvento key={e.id} e={e} abierto={abierto === e.id} onToggle={() => setAbierto(abierto === e.id ? null : e.id)} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-pager">
            <button className="btn btn--dark btn--sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
            <span>Página {pagina} de {paginas}</span>
            <button className="btn btn--dark btn--sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</button>
          </div>
        </>
      )}
    </div>
  )
}

function FilaEvento({ e, abierto, onToggle }) {
  return (
    <>
      <tr className="is-clickable" onClick={onToggle} aria-expanded={abierto}>
        <td className="mono">{e.id}</td>
        <td className="mono">{e.timestamp}</td>
        <td className="mono">{e.accion}</td>
        <td><span className={`status status--${TONO[e.resultado]}`}>{e.resultado}</span></td>
        <td>{e.servicio}</td>
        <td>{e.usuario_email ?? <em>{e.rol}</em>}</td>
        <td className="mono">{e.ip_origen}</td>
      </tr>
      {abierto && (
        <tr className="log-detail">
          <td colSpan={7}>
            <dl>
              {e.pedido_id && <><dt>Pedido</dt><dd className="mono">{e.pedido_id}</dd></>}
              {e.pago_id && <><dt>Pago</dt><dd className="mono">{e.pago_id}</dd></>}
              {e.dato_anterior && <><dt>Antes</dt><dd><code>{JSON.stringify(e.dato_anterior)}</code></dd></>}
              {e.dato_nuevo && <><dt>Después</dt><dd><code>{JSON.stringify(e.dato_nuevo)}</code></dd></>}
              <dt>Navegador</dt><dd>{e.user_agent}</dd>
              <dt>Hash</dt><dd className="mono">{e.hash}</dd>
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}
