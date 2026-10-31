# Cabeceras de seguridad (A05). Van en un archivo aparte porque un add_header dentro de un
# location anula todos los del server: cada location que agregue cabeceras debe incluir este.
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(self \"https://js.stripe.com\" \"https://www.paypal.com\")" always;
add_header Cross-Origin-Opener-Policy "same-origin-allow-popups" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;
# 'unsafe-inline' solo para atributos style (React); las hojas y scripts solo de orígenes listados.
add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://js.stripe.com https://www.paypal.com https://www.sandbox.paypal.com https://accounts.google.com/gsi/client; style-src 'self'; style-src-elem 'self' https://js.stripe.com https://www.paypal.com https://accounts.google.com/gsi/style; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://images.unsplash.com https://res.cloudinary.com https://*.stripe.com https://www.paypalobjects.com https://*.paypal.com; connect-src 'self' https://api.cloudinary.com https://api.stripe.com https://www.paypal.com https://www.sandbox.paypal.com https://accounts.google.com/gsi/; frame-src https://www.google.com https://js.stripe.com https://hooks.stripe.com https://www.paypal.com https://www.sandbox.paypal.com https://accounts.google.com/gsi/; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests" always;
