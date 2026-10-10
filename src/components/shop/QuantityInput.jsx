import { Minus, Plus } from 'lucide-react'

export default function QuantityInput({ value, onChange, min = 1, small = false }) {
  return (
    <div className={`qty ${small ? 'qty--sm' : ''}`}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Disminuir cantidad">
        <Minus size={16} />
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= 99} aria-label="Aumentar cantidad">
        <Plus size={16} />
      </button>
    </div>
  )
}
