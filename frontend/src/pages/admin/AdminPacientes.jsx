import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import Loading from '../../components/Loading'
import PetIcon from '../../components/PetIcon'
import { api } from '../../api'
import { formatCita } from '../account/citas'
import { fechaCorta } from '../account/vacunas'
import { AlertasClinicas } from './ClinicalRecord'

// Sin acentos ni mayúsculas: «Lucia» encuentra a «Lucía».
const normalizar = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Buscador de pacientes por mascota o dueño. El nombre del dueño sale de su cuenta (auth-service);
// si no está, del contacto que dejó en su última cita.
export default function AdminPacientes() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const [pacientes, setPacientes] = useState(null)
  const [clientes, setClientes] = useState({})
  const [inactivas, setInactivas] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/api/citas/admin/pacientes').then((d) => setPacientes(d.pacientes)).catch((e) => setError(e.message))
    api('/api/auth/admin/clientes')
      .then((d) => setClientes(Object.fromEntries(d.clientes.map((c) => [c.id, c]))))
      .catch(() => {}) // sin la lista se usa el contacto de la última cita
  }, [])

  const lista = useMemo(() => {
    if (!pacientes) return null
    const t = normalizar(q.trim())
    return pacientes
      .map((p) => ({ ...p, dueno: { ...p.dueno, nombre: clientes[p.dueno.id]?.nombre || p.dueno.nombre, email: clientes[p.dueno.id]?.email || p.dueno.email } }))
      .filter((p) => (inactivas || p.activa) && (!t || [p.nombre, p.raza, p.dueno.nombre, p.dueno.email, p.dueno.telefono].some((x) => normalizar(x).includes(t))))
  }, [pacientes, clientes, q, inactivas])

  return (
    <div className="admin-card">
      <div className="admin-card__head">
        <h2>Pacientes {lista && <small>· {lista.length}</small>}</h2>
      </div>
      <div className="admin-filters">
        <label className="search admin-search">
          <Search size={18} />
          <input type="search" value={q} placeholder="Mascota, dueño, correo o teléfono" aria-label="Buscar paciente" autoFocus
            onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })} />
        </label>
        <label className="agenda__check">
          <input type="checkbox" checked={inactivas} onChange={(e) => setInactivas(e.target.checked)} /> Mostrar inactivas
        </label>
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {!lista ? !error && <Loading /> : lista.length === 0 ? (
        <p className="summary__hint">{q ? `Ningún paciente coincide con «${q}».` : 'Todavía no hay pacientes.'}</p>
      ) : (
        <ul className="patients">
          {lista.map((p) => (
            <li key={p.id} className={p.activa ? '' : 'is-muted'}>
              <Link to={`/admin/pacientes/${p.id}`} className="patients__link">
                <span className="cita__icon"><PetIcon especie={p.especie} size={22} /></span>
                <span className="patients__main">
                  <strong>{p.nombre}</strong>{!p.activa && <small> · inactiva</small>}
                  <small>{[p.raza, p.dueno.nombre].filter(Boolean).join(' · ') || 'Sin datos'}</small>
                  <AlertasClinicas mascota={p} compact />
                </span>
                <span className="patients__side">
                  <small>Última consulta: {p.ultima_consulta ? fechaCorta(p.ultima_consulta) : '—'}</small>
                  {p.proxima_cita && <small>Próxima cita: {formatCita(p.proxima_cita)}</small>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
