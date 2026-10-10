// Google Maps Embed. Con VITE_GOOGLE_MAPS_KEY usa la Maps Embed API oficial (la key es pública por
// diseño y se restringe por dominio en Google Cloud); sin key, el embed básico sin API.
const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY

export default function MapEmbed({ query, title, height = 220 }) {
  const q = encodeURIComponent(query)
  const src = KEY
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(KEY)}&q=${q}&language=es`
    : `https://www.google.com/maps?q=${q}&output=embed&hl=es`
  return (
    <iframe
      className="map-embed"
      title={title}
      src={src}
      height={height}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-popups"
    />
  )
}
