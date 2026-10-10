import { PawIcon } from './Brand'

export default function Loading({ text = 'Cargando…' }) {
  return (
    <div className="loading" role="status">
      <PawIcon size={40} />
      <span>{text}</span>
    </div>
  )
}
