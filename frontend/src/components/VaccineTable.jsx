import { VACUNA_STATUS, fechaCorta } from '../pages/account/vacunas'

export default function VaccineTable({ vacunas, lote = false, vacio = 'Todavía no hay vacunas registradas.' }) {
  if (!vacunas.length) return <p className="summary__hint">{vacio}</p>
  return (
    <div className="table-scroll">
      <table className="admin-table vaccine-table">
        <thead>
          <tr><th>Nombre</th><th>Aplicada</th><th>Próxima dosis</th>{lote && <th>Lote</th>}<th>Estado</th></tr>
        </thead>
        <tbody>
          {vacunas.map((v) => (
            <tr key={v.id} className={v.estado === 'renovada' ? 'is-muted-soft' : ''}>
              <td><strong>{v.nombre}</strong>{v.clinica_externa && <small>Aplicada en {v.clinica_externa}</small>}</td>
              <td>{fechaCorta(v.fecha_aplicacion)}</td>
              <td>{fechaCorta(v.proxima_dosis)}</td>
              {lote && <td className="mono">{v.lote || '—'}</td>}
              <td><span className={`status status--${VACUNA_STATUS[v.estado].tone}`}>{VACUNA_STATUS[v.estado].label}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Carné completo: vacunas y desparasitaciones por separado.
export function Carne({ vacunas, lote = false }) {
  return (
    <>
      <h4 className="carne__title">Vacunas</h4>
      <VaccineTable vacunas={vacunas.filter((v) => v.tipo !== 'desparasitacion')} lote={lote} />
      <h4 className="carne__title">Desparasitaciones</h4>
      <VaccineTable vacunas={vacunas.filter((v) => v.tipo === 'desparasitacion')} lote={lote}
        vacio="Todavía no hay desparasitaciones registradas." />
    </>
  )
}
