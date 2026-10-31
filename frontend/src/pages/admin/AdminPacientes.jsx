import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PawPrint, Search } from 'lucide-react'
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
    <>
      <div className="barra">
        <label className="search admin-search">
          <Search size={18} />
          <input type="search" value={q} placeholder="Mascota, dueño, correo o teléfono" aria-label="Buscar paciente" autoFocus
            onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })} />
        </label>
        {lista && <span className="barra__total">{lista.length} {lista.length === 1 ? 'paciente' : 'pacientes'}</span>}
        <label className="agenda__check barra__fin">
          <input type="checkbox" checked={inactivas} onChange={(e) => setInactivas(e.target.checked)} /> Mostrar inactivas
        </label>
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {!lista ? !error && <Loading /> : lista.length === 0 ? (
        <div className="vacio"><PawPrint size={32} aria-hidden="true" /><p>{q ? `Ningún paciente coincide con «${q}».` : 'Todavía no hay pacientes.'}</p></div>
      ) : (
        <ul className="pacientes">
          {lista.map((p) => (
            <li key={p.id} className={p.activa ? '' : 'is-apagada'}>
              <Link to={`/admin/pacientes/${p.id}`} className="paciente">
                <span className="paciente__cabeza">
                  <span className="cita-fila__icono"><PetIcon especie={p.especie} size={24} /></span>
                  <span className="fila__principal">
                    <strong>{p.nombre}{!p.activa && ' · inactiva'}</strong>
                    <small>{p.raza || 'Sin raza registrada'}</small>
                  </span>
                </span>
                <AlertasClinicas mascota={p} compact />
                <dl className="paciente__datos">
                  <div><dt>Dueño</dt><dd>{p.dueno.nombre || '—'}</dd></div>
                  <div><dt>Última consulta</dt><dd>{p.ultima_consulta ? fechaCorta(p.ultima_consulta) : '—'}</dd></div>
                  {p.proxima_cita && <div className="es-proxima"><dt>Próxima cita</dt><dd>{formatCita(p.proxima_cita)}</dd></div>}
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
