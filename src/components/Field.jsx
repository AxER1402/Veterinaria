export default function Field({ label, error, full, children }) {
  return (
    <label className={`field ${full ? 'field--full' : ''} ${error ? 'field--error' : ''}`}>
      <span>{label}</span>
      {children}
      {error && <small>{error}</small>}
    </label>
  )
}
