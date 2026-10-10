import { useEffect, useState } from 'react'

// Cuenta regresiva hasta la medianoche: la oferta flash se "renueva" cada día.
function timeLeft() {
  const now = new Date()
  const end = new Date(now)
  end.setHours(24, 0, 0, 0)
  const s = Math.max(0, Math.floor((end - now) / 1000))
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
}

export default function Countdown() {
  const [t, setT] = useState(timeLeft)

  useEffect(() => {
    const id = setInterval(() => setT(timeLeft()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="countdown" role="timer">
      {['Horas', 'Min', 'Seg'].map((label, i) => (
        <div key={label}>
          <strong>{String(t[i]).padStart(2, '0')}</strong>
          <small>{label}</small>
        </div>
      ))}
    </div>
  )
}
