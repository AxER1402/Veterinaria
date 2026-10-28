import { ESPECIES } from '../pages/account/citas'

export default function PetIcon({ especie, ...props }) {
  const Icon = (ESPECIES.find((e) => e.value === especie) || ESPECIES.at(-1)).icon
  return <Icon {...props} />
}
