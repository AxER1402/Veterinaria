import { Link } from 'react-router-dom'
import LegalPage from '../components/LegalPage'
import { business, locations } from '../data/content'

// Cada dato que se menciona aquí corresponde a lo que la app guarda de verdad (ver docs/06-iso27001.md, A.5.34).
export default function Privacidad() {
  return (
    <LegalPage title="Aviso de privacidad" text="Qué datos tuyos y de tu mascota guardamos, para qué y con quién los compartimos." actualizado="29 de octubre de 2026">
      <h2>Quién es responsable</h2>
      <p>
        {business.name} ({business.tagline.toLowerCase()}), con sede principal en {locations[0].address}, es responsable de los
        datos que nos das al usar este sitio, la tienda y la reserva de citas.
      </p>

      <h2>Qué datos guardamos</h2>
      <ul>
        <li><strong>Tu cuenta:</strong> nombre, correo y teléfono. La contraseña no se guarda: solo un resumen irreversible (hash bcrypt) que sirve para comprobarla, no para recuperarla.</li>
        <li><strong>Tus mascotas:</strong> nombre, especie, raza, fecha de nacimiento, peso y las notas que agregues (por ejemplo, alergias o temperamento).</li>
        <li><strong>Tus citas:</strong> servicio, fecha, el motivo de la consulta, el teléfono de contacto y quién lleva a la mascota.</li>
        <li><strong>Historial clínico:</strong> lo que registra el veterinario en cada consulta (examen, diagnóstico, tratamiento, vacunas, resultados de laboratorio y radiografías).</li>
        <li><strong>Tus pedidos:</strong> productos, dirección de entrega o sede de retiro, y teléfono.</li>
        <li><strong>Pagos:</strong> solo la referencia que nos da la pasarela y el estado del pago. <strong>No vemos ni guardamos los datos de tu tarjeta</strong>: los escribes directamente en Stripe o PayPal.</li>
        <li><strong>Reseñas:</strong> el texto y la calificación que publiques.</li>
        <li><strong>Registros de seguridad:</strong> cuándo entras, qué acciones importantes haces (por ejemplo, un pago o un cambio de contraseña), tu dirección IP y el tipo de navegador. Estos registros no copian contraseñas, datos de tarjeta ni diagnósticos.</li>
      </ul>

      <h2>Para qué los usamos</h2>
      <ul>
        <li>Atender a tu mascota, agendar y recordarte las citas y los refuerzos de vacunas.</li>
        <li>Preparar, entregar y cobrar tus pedidos, y avisarte por correo cuando cambian de estado.</li>
        <li>Proteger tu cuenta y la tienda: detectar accesos sospechosos, fraudes y abusos.</li>
      </ul>
      <p>No vendemos tus datos ni los usamos para publicidad de terceros.</p>

      <h2>Quién puede verlos</h2>
      <ul>
        <li><strong>Nuestro personal</strong>, cada uno solo en lo que necesita: recepción ve citas y datos de contacto; la tienda ve pedidos; el diagnóstico y el tratamiento solo los ven los veterinarios y la administración, y cada vez que alguien abre un historial queda registrado.</li>
        <li><strong>Tu carné de vacunas</strong>, que ves en tu cuenta, no incluye diagnósticos.</li>
        <li><strong>Las reseñas</strong> se publican solo con tu nombre y la inicial del apellido.</li>
      </ul>

      <h2>Servicios externos que usamos</h2>
      <ul>
        <li><strong>Stripe y PayPal</strong>, para cobrar. Reciben los datos de pago que escribes en su formulario y se rigen por sus propias políticas.</li>
        <li><strong>Cloudinary</strong>, para guardar las fotos de los productos y los archivos del historial clínico. Los archivos clínicos son privados: solo se abren con un enlace firmado que vence a los 10 minutos.</li>
        <li><strong>EmailJS</strong>, para enviarte los correos de citas, recordatorios y pedidos.</li>
        <li><strong>Google Maps</strong>, para mostrar dónde están nuestras sedes. Al cargar el mapa, Google recibe tu dirección IP.</li>
        <li><strong>Cloudflare R2</strong>, para guardar copias de seguridad cifradas.</li>
      </ul>

      <h2>Cuánto tiempo los guardamos</h2>
      <ul>
        <li>Los datos de tu cuenta, tus mascotas, citas, historial y pedidos se guardan mientras tengas cuenta con nosotros.</li>
        <li>Las copias de seguridad cifradas se conservan 30 días.</li>
        <li>Los registros de seguridad se conservan 2 años y no se pueden modificar: sirven como evidencia ante un incidente.</li>
      </ul>

      <h2>Cómo los protegemos</h2>
      <ul>
        <li>Todo el sitio funciona con conexión cifrada (HTTPS).</li>
        <li>Puedes activar la verificación en dos pasos en <Link to="/cuenta/seguridad">Mi cuenta → Seguridad</Link>.</li>
        <li>Tu sesión se guarda solo en la pestaña del navegador y se borra al cerrarla.</li>
        <li>Las bases de datos no son accesibles desde internet y cada servicio solo tiene los permisos que necesita.</li>
      </ul>

      <h2>Lo que guarda tu navegador</h2>
      <p>
        No usamos cookies de publicidad ni de seguimiento. Tu navegador guarda tu sesión mientras la pestaña está abierta, y el
        carrito y los favoritos para que no se pierdan entre visitas. Puedes borrarlos desde la configuración de tu navegador.
      </p>

      <h2>Tus derechos</h2>
      <ul>
        <li>Puedes ver y corregir tus datos y los de tus mascotas desde <Link to="/cuenta">Mi cuenta</Link>.</li>
        <li>Puedes pedirnos una copia de tus datos, que corrijamos algo que no puedas cambiar tú o que borremos tu cuenta. Escríbenos desde el correo de tu cuenta. Al borrarla conservaremos solo lo que debamos guardar por ley o por seguridad, como los registros de pagos y de seguridad.</li>
      </ul>

      <h2>Cambios a este aviso</h2>
      <p>Si cambiamos algo importante, lo publicaremos aquí con una nueva fecha de actualización.</p>
    </LegalPage>
  )
}
