import { Link } from 'react-router-dom'

// Un dato del panel. Con `to`, toda la tarjeta lleva al detalle.
export default function Stat({ label, value, note, tone, to }) {
  const Tag = to ? Link : 'div'
  return (
    <Tag {...(to ? { to } : {})} className={`stat-tile ${tone ? `stat-tile--${tone}` : ''} ${to ? 'stat-tile--link' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </Tag>
  )
}
