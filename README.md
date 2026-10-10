# Huellitas – Frontend para veterinaria

Sitio web frontend (sin backend) para una veterinaria, hecho con **React + Vite** y empaquetado con **Docker + Nginx**.
El diseño está inspirado en [PetMania](https://petmania.vamtam.com/): paleta amarillo `#FFD100`, azul marino `#002842` y celeste `#E5EEFF`, con tipografías *Fredoka* y *Readex Pro*.

## Páginas

| Ruta          | Contenido                                                                  |
| ------------- | -------------------------------------------------------------------------- |
| `/`           | Portada, sobre nosotros, servicios, por qué elegirnos, testimonios, reserva, sedes, FAQ, galería |
| `/servicios`  | Detalle y precio de cada servicio                                          |
| `/nosotros`   | Historia, estadísticas, valores y testimonios                              |
| `/preguntas`  | Preguntas frecuentes                                                       |
| `/contacto`   | Datos de contacto, formulario de reserva y sedes                           |
| `/tienda`     | Portada de la tienda: destacados, oferta flash, compra por mascota, marcas, consejos, reseñas |
| `/tienda/productos` | Catálogo con búsqueda, filtros (mascota, categoría, marca, ofertas) y orden. Los filtros viven en la URL |
| `/tienda/producto/:slug` | Ficha de producto con variantes, cantidad y productos relacionados |
| `/carrito`    | Carrito con cupones y cálculo de envío                                     |
| `/checkout`   | Datos, entrega (domicilio o retiro), pago y confirmación del pedido        |
| `/favoritos`  | Productos guardados                                                         |

## Ejecutar con Docker (producción)

```bash
docker compose up -d --build web
```

Abre http://localhost:8080. Para detenerlo: `docker compose down`.

Sin docker compose:

```bash
docker build -t huellitas-veterinaria .
docker run -d -p 8080:80 huellitas-veterinaria
```

## Desarrollo

Con Node 20+ instalado:

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # genera /dist
npm run lint
```

O con Docker, con recarga en caliente:

```bash
docker compose --profile dev up dev   # http://localhost:5173
```

## Estructura

```
src/
├── data/content.js     # Contenido del sitio: textos, servicios, sedes, FAQ, imágenes
├── data/shop.js        # Tienda: productos, variantes y precios, categorías, cupones, reseñas
├── context/            # Estado del carrito y favoritos (useReducer + localStorage)
├── components/         # Header, Hero, ServicesGrid, Testimonials, BookingForm, Footer…
├── pages/              # Home, Services, About, FaqPage, Contact, NotFound
├── pages/shop/         # ShopHome, Catalog, ProductDetail, Cart, Checkout, Wishlist
├── App.jsx             # Rutas (react-router-dom)
├── index.css           # Estilos globales y variables de color
└── shop.css            # Estilos de la tienda
Dockerfile              # Build multi-etapa: Node → Nginx
nginx.conf              # Fallback de SPA + caché de assets
```

Para cambiar el nombre, teléfono, servicios o textos, edita `src/data/content.js`.
Los colores se definen como variables CSS al inicio de `src/index.css`.

## Notas

- La tienda es solo de demostración: el carrito y los favoritos se guardan en `localStorage` del navegador y el checkout **no cobra ni envía pedidos**. Cupones de prueba: `HUELLITAS10` (10% en todo) y `FLASH50` (50% en productos NutriHuella). Envío gratis desde $50.
- Para agregar productos, añade un objeto al arreglo `products` en `src/data/shop.js`.
- El formulario de reserva y el newsletter validan los datos y muestran confirmación, pero **no envían nada**: es un proyecto solo frontend. Para conectarlo, reemplaza el `console.info` en `src/components/BookingForm.jsx` por una llamada a tu API o a un servicio como Formspree o EmailJS.
- Las fotos se cargan desde Unsplash (licencia libre). Para producción conviene descargarlas a `public/`.
