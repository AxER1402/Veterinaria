// Pestañas dentro de una sección: una cosa a la vez, en lugar de apilarlo todo en la misma pantalla.
export default function Subvistas({ vistas, activa, onChange }) {
  return (
    <div className="subvistas" role="tablist">
      {vistas.map(({ id, label }) => (
        <button key={id} type="button" role="tab" aria-selected={activa === id} className={activa === id ? 'is-activa' : ''} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  )
}
