import {
  Stethoscope,
  Footprints,
  Scissors,
  House,
  GraduationCap,
  Sun,
  Heart,
  Clock,
  Sparkles,
  ShieldCheck,
  Eye,
  Users,
} from 'lucide-react'

const unsplash = (id, w = 800, h) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}${h ? `&h=${h}` : ''}&q=75`

export const business = {
  name: 'Huellitas',
  tagline: 'Clínica veterinaria y cuidado de mascotas',
  phone: '+1-800-356-8933',
  email: 'hola@huellitas.vet',
  hours: 'Lun a Sáb · 8:00 – 20:00',
}

export const navLinks = [
  { to: '/', label: 'Inicio' },
  { to: '/servicios', label: 'Servicios' },
  { to: '/tienda', label: 'Tienda' },
  { to: '/nosotros', label: 'Nosotros' },
  { to: '/preguntas', label: 'Preguntas' },
  { to: '/contacto', label: 'Contacto' },
]

export const images = {
  hero: unsplash('photo-1517849845537-4d257902454a', 900, 1000),
  happyPets: unsplash('photo-1450778869180-41d0601e046e', 900, 900),
  about: unsplash('photo-1587300003388-59208cc962cb', 900, 1000),
  cta: unsplash('photo-1583337130417-3346a1be7dee', 700, 700),
}

export const services = [
  {
    slug: 'veterinaria',
    title: 'Consulta veterinaria',
    icon: Stethoscope,
    short: 'Chequeos, vacunas y diagnóstico con médicos veterinarios certificados.',
    description:
      'Medicina preventiva, vacunación, desparasitación, análisis clínicos y seguimiento personalizado para cada etapa de vida de tu mascota.',
    image: unsplash('photo-1628009368231-7bb7cfcb0def', 700, 520),
    price: 'Desde $35',
  },
  {
    slug: 'guarderia',
    title: 'Guardería',
    icon: Sun,
    short: 'Días llenos de juego, socialización y cuidado mientras trabajas.',
    description:
      'Grupos por tamaño y temperamento, zonas de descanso climatizadas y reportes con fotos durante el día.',
    image: unsplash('photo-1548199973-03cce0bbc87b', 700, 520),
    price: 'Desde $28 / día',
  },
  {
    slug: 'paseos',
    title: 'Paseos',
    icon: Footprints,
    short: 'Paseadores de confianza que recorren tu barrio con tu perro.',
    description:
      'Paseos individuales o en grupos pequeños de 30 o 60 minutos, con seguimiento GPS y notas al finalizar.',
    image: unsplash('photo-1477884213360-7e9d7dcc1e48', 700, 520),
    price: 'Desde $18',
  },
  {
    slug: 'peluqueria',
    title: 'Peluquería',
    icon: Scissors,
    short: 'Baño, corte y spa para que luzca y se sienta increíble.',
    description:
      'Baños con productos hipoalergénicos, cortes de raza, limpieza de oídos, corte de uñas y tratamientos de pelaje.',
    image: unsplash('photo-1560807707-8cc77767d783', 700, 520),
    price: 'Desde $30',
  },
  {
    slug: 'hospedaje',
    title: 'Hospedaje',
    icon: House,
    short: 'Un segundo hogar cómodo y seguro cuando sales de viaje.',
    description:
      'Suites individuales, supervisión 24/7, alimentación según su dieta habitual y videollamadas contigo.',
    image: unsplash('photo-1576201836106-db1758fd1c97', 700, 520),
    price: 'Desde $45 / noche',
  },
  {
    slug: 'entrenamiento',
    title: 'Entrenamiento',
    icon: GraduationCap,
    short: 'Obediencia y buenos hábitos con refuerzo positivo.',
    description:
      'Clases para cachorros, obediencia básica y avanzada, y corrección de conducta con entrenadores certificados.',
    image: unsplash('photo-1552053831-71594a27632d', 700, 520),
    price: 'Desde $40',
  },
]

export const reasons = [
  {
    title: 'Amor por los animales',
    icon: Heart,
    text: 'Entendemos que tu mascota es parte de la familia y merece la mejor atención posible.',
  },
  {
    title: 'Comodidad',
    icon: Clock,
    text: 'Horarios flexibles y reservas en línea para que agendar sea fácil y rápido.',
  },
  {
    title: 'Atención personalizada',
    icon: Sparkles,
    text: 'Nuestro equipo adapta cada cuidado a la edad, raza y necesidades de tu mascota.',
  },
  {
    title: 'Tranquilidad',
    icon: ShieldCheck,
    text: 'Sabemos que dejar a tu compañero puede ser estresante; te mantenemos informado en todo momento.',
  },
  {
    title: 'Transparencia',
    icon: Eye,
    text: 'Precios claros, reportes diarios y puertas abiertas: queremos que confíes plenamente en nosotros.',
  },
  {
    title: 'Trabajo en equipo',
    icon: Users,
    text: 'Veterinarios, técnicos y cuidadores trabajan juntos para darle el mejor cuidado.',
  },
]

export const testimonials = [
  {
    pet: 'Rocky',
    owner: 'Susana',
    text: 'Amables, cercanos y muy profesionales. Lo mejor de todo es que Rocky los adora. Recomiendo Huellitas a cualquiera que busque cuidado para su perro.',
    image: unsplash('photo-1543466835-00a7907e9de1', 200, 200),
  },
  {
    pet: 'Luna',
    owner: 'Victoria',
    text: '¡Gracias Huellitas por cuidar tan bien a Luna! La atención fue excelente y me dejó completamente tranquila. ¡Mil gracias!',
    image: unsplash('photo-1561037404-61cd46aa615b', 200, 200),
  },
  {
    pet: 'Toby',
    owner: 'Andrés',
    text: 'El equipo veterinario detectó a tiempo un problema en la piel de Toby. Explicaron todo con paciencia y el seguimiento fue impecable.',
    image: unsplash('photo-1587300003388-59208cc962cb', 200, 200),
  },
]

export const locations = [
  {
    title: 'Clínica veterinaria y peluquería',
    address: 'Av. Principal 954, Centro',
    map: 'https://maps.google.com/?q=Av.+Principal+954',
  },
  {
    title: 'Guardería y hospedaje – Norte',
    address: 'Calle Los Robles 864, Zona Norte',
    map: 'https://maps.google.com/?q=Calle+Los+Robles+864',
  },
  {
    title: 'Paseadores y cuidadores – Sur',
    address: 'Blvd. Ribereño 180, Zona Sur',
    map: 'https://maps.google.com/?q=Blvd.+Riberenio+180',
  },
]

export const faqs = [
  {
    q: '¿A qué hora puedo dejar y recoger a mi perro?',
    a: 'Para facilitar el juego en grupo pedimos que los perros lleguen antes de las 9:00 a.m. Puedes recogerlo hasta las 8:00 p.m. Llámanos si necesitas un baño antes de la salida.',
  },
  {
    q: '¿Qué debe llevar mi mascota a la guardería?',
    a: 'Solo su collar con placa y su carnet de vacunación al día. Si tiene una dieta especial, trae su alimento en porciones etiquetadas.',
  },
  {
    q: '¿Qué hace mi perro durante el día?',
    a: 'Juego supervisado en grupos por tamaño, paseos, siestas en zonas tranquilas y actividades de enriquecimiento. Te enviamos fotos y un reporte al final del día.',
  },
  {
    q: '¿Qué edad debe tener mi mascota?',
    a: 'Recibimos cachorros desde los 4 meses, siempre que tengan su esquema de vacunas completo. En consulta veterinaria atendemos a mascotas de cualquier edad.',
  },
  {
    q: '¿Atienden emergencias?',
    a: 'Sí. Durante nuestro horario atendemos urgencias sin cita. Fuera de horario, llama a nuestro teléfono y te orientaremos.',
  },
]

export const gallery = [
  'photo-1514888286974-6c03e2ca1dba',
  'photo-1535930891776-0c2dfb7fda1a',
  'photo-1537151625747-768eb6cf92b2',
  'photo-1583511655857-d19b40a7a54e',
  'photo-1592194996308-7b43878e84a6',
  'photo-1543466835-00a7907e9de1',
].map((id) => unsplash(id, 400, 400))

export const stats = [
  { value: '12+', label: 'Años de experiencia' },
  { value: '8,500', label: 'Mascotas felices' },
  { value: '25', label: 'Profesionales' },
  { value: '4.9', label: 'Calificación promedio' },
]
