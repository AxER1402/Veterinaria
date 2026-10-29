export function PawIcon({ size = 24, color = 'currentColor', ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill={color} aria-hidden="true" {...props}>
      <ellipse cx="32" cy="42" rx="12" ry="10" />
      <ellipse cx="16" cy="28" rx="5.5" ry="7" />
      <ellipse cx="48" cy="28" rx="5.5" ry="7" />
      <ellipse cx="24" cy="15" rx="5" ry="6.5" />
      <ellipse cx="40" cy="15" rx="5" ry="6.5" />
    </svg>
  )
}

export function Logo({ light = false }) {
  return (
    <span className={`logo ${light ? 'logo--light' : ''}`}>
      <span className="logo__badge">
        <PawIcon size={22} />
      </span>
      <span className="logo__texto">Huellitas</span>
    </span>
  )
}

export function InstagramIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
    </svg>
  )
}

export function FacebookIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M14 8h3V4h-3c-2.8 0-4.5 1.8-4.5 4.6V11H7v4h2.5v9h4v-9h3l.5-4h-3.5V9c0-.6.4-1 1-1z" />
    </svg>
  )
}

export function Stars({ value = 5 }) {
  return (
    <span className="stars" aria-label={`${value} de 5 estrellas`}>
      {'★★★★★'}
    </span>
  )
}
