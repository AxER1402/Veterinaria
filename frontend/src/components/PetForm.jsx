import { useState } from 'react'
import Field from './Field'
import { api } from '../api'
import { ESPECIES, ymd } from '../pages/account/citas'

const VACIA = { nombre: '', especie: 'perro', raza: '', sexo: '', fecha_nacimiento: '', peso_kg: '', notas: '' }

// Alta o edición de una mascota. En la reserva va en versión corta (nombre, especie y notas):
// lo demás se completa después en «Mis mascotas».
export default function PetForm({ mascota, compact = false, onSaved, onCancel }) {
  const [values, setValues] = useState(() =>
    mascota ? Object.fromEntries(Object.keys(VACIA).map((k) => [k, mascota[k] ?? ''])) : VACIA,
  )
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const set = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    e.stopPropagation() // en la reserva va dentro de otro formulario
    if (!values.nombre.trim()) return setErrors({ nombre: 'Ponle un nombre' })
    setErrors({})
    setError('')
    setSending(true)
    try {
      const body = { ...values, nombre: values.nombre.trim(), peso_kg: values.peso_kg === '' ? '' : Number(values.peso_kg) }
      const d = mascota
        ? await api(`/api/citas/mascotas/${mascota.id}`, { method: 'PATCH', body })
        : await api('/api/citas/mascotas', { method: 'POST', body })
      onSaved(d.mascota)
    } catch (err) {
      if (err.data?.campo) setErrors({ [err.data.campo]: err.message })
      else setError(err.message)
    } finally {
      setSending(false)
    }
  }

  // Un <form> no puede ir dentro de otro: en la reserva se usa un <div> y se envía con el botón.
  const Wrapper = compact ? 'div' : 'form'
  return (
    <Wrapper className="pet-form" {...(compact ? {} : { onSubmit: submit, noValidate: true })}>
      <fieldset className="pet-picker">
        <legend>Especie</legend>
        {ESPECIES.map(({ value, label, icon: Icon }) => (
          <label key={value} className={values.especie === value ? 'active' : ''}>
            <input type="radio" name={`especie-${mascota?.id || 'nueva'}`} value={value} checked={values.especie === value}
              onChange={set('especie')} />
            <Icon size={22} /> {label}
          </label>
        ))}
      </fieldset>
      <div className="form-grid">
        <Field label="Nombre" error={errors.nombre} full={compact}>
          <input value={values.nombre} onChange={set('nombre')} maxLength={60} autoFocus={!mascota} />
        </Field>
        {!compact && (
          <>
            <Field label="Raza (opcional)" error={errors.raza}>
              <input value={values.raza} onChange={set('raza')} maxLength={60} />
            </Field>
            <Field label="Sexo" error={errors.sexo}>
              <select value={values.sexo} onChange={set('sexo')}>
                <option value="">Sin indicar</option>
                <option value="macho">Macho</option>
                <option value="hembra">Hembra</option>
              </select>
            </Field>
            <Field label="Fecha de nacimiento" error={errors.fecha_nacimiento}>
              <input type="date" max={ymd(new Date())} value={values.fecha_nacimiento} onChange={set('fecha_nacimiento')} />
            </Field>
            <Field label="Peso en kg (opcional)" error={errors.peso_kg}>
              <input type="number" min="0.1" max="150" step="0.1" inputMode="decimal" value={values.peso_kg} onChange={set('peso_kg')} />
            </Field>
          </>
        )}
        <Field label="Notas (alergias, temperamento…)" error={errors.notas} full>
          <textarea rows="2" value={values.notas} onChange={set('notas')} maxLength={300} />
        </Field>
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="pet-form__actions">
        <button type={compact ? 'button' : 'submit'} className="btn btn--dark btn--sm" disabled={sending}
          onClick={compact ? submit : undefined}>
          {sending ? 'Guardando…' : mascota ? 'Guardar cambios' : 'Guardar mascota'}
        </button>
        {onCancel && <button type="button" className="link-btn" onClick={onCancel}>Cancelar</button>}
      </div>
    </Wrapper>
  )
}
