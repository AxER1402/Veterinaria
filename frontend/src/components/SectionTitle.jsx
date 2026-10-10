import { PawIcon } from './Brand'

export default function SectionTitle({ eyebrow, title, text, center = false, light = false }) {
  return (
    <div className={`section-title ${center ? 'section-title--center' : ''} ${light ? 'section-title--light' : ''}`}>
      {eyebrow && (
        <span className="eyebrow">
          <PawIcon size={16} /> {eyebrow}
        </span>
      )}
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </div>
  )
}
