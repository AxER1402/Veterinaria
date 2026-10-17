import { VACUNA_STATUS, fechaCorta } from '../pages/account/vacunas'

export default function VaccineTable({ vacunas, lote = false }) {
  if (!vacunas.length) return <p className="summary__hint">Todavía no hay vacunas registradas.</p>
  return (
    <div className="table-scroll">
      <table className="admin-table vaccine-table">
        <thead>
          <tr><th>Vacuna</th><th>Aplicada</th><th>Próxima dosis</th>{lote && <th>Lote</th>}<th>Estado</th></tr>
        </thead>
        <tbody>
          {vacunas.map((v) => (
            <tr key={v.id} className={v.estado === 'renovada' ? 'is-muted-soft' : ''}>
              <td><strong>{v.nombre}</strong></td>
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
