import { Dog, Cat, Rabbit } from 'lucide-react'

const ICONOS = { perro: Dog, gato: Cat }

export default function PetIcon({ especie, ...props }) {
  const Icon = ICONOS[especie] || Rabbit
  return <Icon {...props} />
}
