import { Link } from 'react-router-dom'
import LegalPage from '../components/LegalPage'
import { business } from '../data/content'

// Las cifras salen de las reglas del sistema: CitasController (horario, 60 días, 1 h, 2 h, 3 faltas),
// Totales.php (envío Q35, gratis desde Q400) y PEDIDO_VENCE_HORAS (2 h). Si cambian allá, cambiar aquí.
export default function Terminos() {
  return (
    <LegalPage title="Términos y condiciones" text="Las reglas para reservar citas y comprar en la tienda de Huellitas." actualizado="29 de octubre de 2026">
      <h2>Aceptación</h2>
      <p>
        Al crear una cuenta, reservar una cita o hacer un pedido en este sitio aceptas estos términos y nuestro{' '}
        <Link to="/privacidad">aviso de privacidad</Link>. Si no estás de acuerdo, no uses el sitio.
      </p>

      <h2>Tu cuenta</h2>
      <ul>
        <li>Los datos que registres deben ser verdaderos, sobre todo tu teléfono y tu correo: los usamos para confirmar citas y pedidos.</li>
        <li>Cuida tu contraseña. Te recomendamos activar la verificación en dos pasos.</li>
        <li>Podemos suspender una cuenta si detectamos fraude, abuso o un uso que ponga en riesgo a otros clientes o al sitio.</li>
      </ul>

      <h2>Citas</h2>
      <ul>
        <li>Atendemos de lunes a sábado, de 8:00 a 20:00. Puedes reservar hasta con 60 días de anticipación y al menos 1 hora antes del turno.</li>
        <li>Cada mascota puede tener hasta 3 citas pendientes, y cada cuenta hasta 10.</li>
        <li>Puedes cambiar o cancelar una cita desde <Link to="/cuenta/citas">Mis citas</Link> hasta 2 horas antes. Después, llámanos.</li>
        <li>Si faltas a 3 citas en 3 meses sin avisar, las siguientes tendrás que agendarlas por teléfono.</li>
        <li>Los servicios se pagan en la sede, al momento de la atención.</li>
        <li>Para guardería y hospedaje tu mascota debe tener las vacunas al día. El hospedaje se reserva por un máximo de 30 noches.</li>
        <li>Si es una urgencia, no reserves en línea: llámanos al <a href={`tel:${business.tel}`}>{business.phone}</a>.</li>
      </ul>

      <h2>Compras en la tienda</h2>
      <ul>
        <li>Los precios están en quetzales. El total final lo calcula el sistema al confirmar el pedido, con los precios, descuentos y existencias de ese momento.</li>
        <li>Puedes recibir tu pedido a domicilio (Q35, gratis en compras desde Q400 después de descuentos) o retirarlo sin costo en una de nuestras sedes.</li>
        <li>Un pedido que no se paga en 2 horas se cancela solo y los productos vuelven al inventario.</li>
        <li>Mientras el pedido esté pendiente de pago puedes cancelarlo desde <Link to="/cuenta/pedidos">Mis pedidos</Link>. Una vez pagado, escríbenos.</li>
        <li>Los cupones de descuento tienen sus propias condiciones (algunos vencen o aplican solo a ciertas marcas), uno por pedido, y no se pueden cambiar por dinero.</li>
      </ul>

      <h2>Pagos</h2>
      <ul>
        <li>Aceptamos tarjeta (procesada por Stripe) y PayPal. Los datos de tu tarjeta nunca pasan por nuestros servidores.</li>
        <li>PayPal cobra en dólares, al tipo de cambio que se muestra antes de pagar (referencia del Banco de Guatemala). Tu banco puede aplicar sus propias comisiones.</li>
        <li>Un pedido se considera pagado cuando la pasarela nos confirma el cobro, no cuando cierras su ventana.</li>
        <li>Los reembolsos se hacen al mismo medio con el que pagaste. El tiempo en que se reflejan depende de tu banco o de PayPal.</li>
      </ul>

      <h2>Cambios y devoluciones</h2>
      <p>
        Si un producto llega dañado, incompleto o no es el que pediste, escríbenos con el número de pedido y una foto. Respetamos
        los derechos que te da la Ley de Protección al Consumidor y Usuario (Decreto 006-2003).
      </p>

      <h2>Reseñas</h2>
      <ul>
        <li>Solo puede opinar quien compró el producto.</li>
        <li>Se publican con tu nombre y la inicial del apellido. Podemos ocultar las que tengan insultos, datos personales, publicidad o que no hablen del producto.</li>
      </ul>

      <h2>Información del sitio</h2>
      <p>
        Los textos y consejos de este sitio son informativos y no reemplazan una consulta veterinaria. Las fotos de productos
        son de referencia; la presentación puede variar.
      </p>

      <h2>Cambios a estos términos</h2>
      <p>
        Podemos actualizar estos términos. La versión vigente es la publicada aquí, con su fecha de actualización. Las citas y
        pedidos ya confirmados se rigen por los términos vigentes cuando los hiciste.
      </p>
    </LegalPage>
  )
}
