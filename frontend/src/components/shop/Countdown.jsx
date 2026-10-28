import { useEffect, useState } from 'react'

// Cuenta regresiva hasta `hasta` (vencimiento real del cupón). Pasado ese momento se queda en cero.
function timeLeft(hasta) {
  const s = Math.max(0, Math.floor((new Date(hasta) - new Date()) / 1000))
  return [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60]
}

export default function Countdown({ hasta }) {
  const [t, setT] = useState(() => timeLeft(hasta))

  useEffect(() => {
    const id = setInterval(() => setT(timeLeft(hasta)), 1000)
    return () => clearInterval(id)
  }, [hasta])

  return (
    <div className="countdown" role="timer">
      {['Días', 'Horas', 'Min', 'Seg'].map((label, i) => (
        <div key={label}>
          <strong>{String(t[i]).padStart(2, '0')}</strong>
          <small>{label}</small>
        </div>
      ))}
    </div>
  )
}
